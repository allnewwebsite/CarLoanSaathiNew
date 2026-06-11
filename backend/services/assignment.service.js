import { countRecords, createRecord, getRecord, queryRecords, runRecordTransaction, updateRecord, upsertRecord } from "./firestore.service.js";
import { createNotification } from "./notification.service.js";
import { getEligiblePartners } from "./partner.service.js";
import { createSlaLog, expireAssignment } from "./sla.service.js";
import { getWorkflowSettings } from "./settings.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "./timeline.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "./audit.service.js";
import { countOpenExecutiveLeads } from "./leadQuery.service.js";
import { queryExecutiveSummaryProjection, removeLeadExecutiveProjection, syncExecutiveSummaryProjectionSoon, syncLeadProjectionSoon } from "./projection.service.js";
import { publishRealtimeEvent, REALTIME_EVENTS } from "./realtime.service.js";
import { LEAD_STATUSES } from "../utils/status.constants.js";

function queueIdForLead(lead) {
  return `${routingCityForLead(lead) || "all"}:${lead.selectedBrand || "all"}:${lead.preferredBank || "all"}`.toLowerCase();
}

function routingCityForLead(lead) {
  return lead.dealershipCity || lead.routingCity || lead.dealerCity || lead.branchCity || lead.city;
}

function sameText(left, right) {
  const a = String(left || "").trim().toLowerCase();
  const b = String(right || "").trim().toLowerCase();
  return Boolean(a && b && a === b);
}

function executiveIdentityKeys(executive = {}) {
  return [
    executive.id,
    executive.sourceId,
    executive.executiveId,
    executive.email,
    executive.officialEmail,
    executive.mobile,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
}

function normalizedStatus(value = "") {
  return String(value || "").trim().toLowerCase();
}

function activeExecutive(executive = {}) {
  const status = normalizedStatus(executive.status || executive.accountStatus);
  return Boolean(
    executive
    && executive.active !== false
    && executive.accountActive !== false
    && executive.accountApproved !== false
    && executive.deleted !== true
    && executive.removed !== true
    && executive.paused !== true
    && executive.suspended !== true
    && !["inactive", "deleted", "removed", "suspended", "disabled"].includes(status)
  );
}

function branchValue(record = {}) {
  return record.bankIfsc || record.ifsc || record.ifscCode || record.branchIfsc || record.branchId || record.bankBranchCity || record.branchCity || record.branchLocation || record.city || "";
}

function sameBranchExecutive(lead = {}, executive = {}) {
  const leadIfsc = lead.assignedBankIfsc || lead.bankIfsc || lead.ifscCode || "";
  const executiveIfsc = executive.bankIfsc || executive.ifsc || executive.ifscCode || executive.branchIfsc || "";
  if (leadIfsc && executiveIfsc && !sameText(leadIfsc, executiveIfsc)) return false;
  const leadBranch = lead.branchId || lead.bankBranchId || lead.bankBranchCity || lead.branchCity || lead.branchLocation || lead.bankBranchLocation || lead.routingCity || lead.city || "";
  const executiveBranch = branchValue(executive);
  return !leadBranch || !executiveBranch || sameText(leadBranch, executiveBranch);
}

function sameExecutive(left = {}, right = {}) {
  const rightKeys = new Set(executiveIdentityKeys(right));
  return executiveIdentityKeys(left).some((key) => rightKeys.has(key));
}

async function resolveTargetExecutive({ lead, targetExecutiveId }) {
  const requested = String(targetExecutiveId || "").trim();
  if (!requested) return null;
  const direct = await getRecord("loanExecutives", requested).catch(() => null);
  if (direct) return direct;
  const lower = requested.toLowerCase();
  const executives = (await queryRecords("loanExecutives", {
    where: lead.bankId ? [{ field: "bankId", value: lead.bankId }] : [],
    orderBy: "createdAt",
    direction: "desc",
    limit: 100,
    maxLimit: 100,
  })).data;
  return executives.find((executive) => executiveIdentityKeys(executive).includes(lower)) || null;
}

async function refreshExecutiveSummary(executive = {}) {
  const executiveId = executive.id || executive.email || executive.officialEmail || "";
  if (!executiveId) return null;
  const [totalAssignedCases, currentActiveCases] = await Promise.all([
    countRecords("leads", { where: [{ field: "assignedExecutiveId", value: executiveId }] }).catch(() => Number(executive.totalAssignedCases || 0)),
    countOpenExecutiveLeads(executiveId).catch(() => Number(executive.currentActiveCases || 0)),
  ]);
  return syncExecutiveSummaryProjectionSoon(executive, { totalAssignedCases, currentActiveCases });
}

function bankMatchesExecutive(lead, executive) {
  return sameText(executive.bankId, lead.bankId)
    || sameText(executive.bankPartnerId, lead.bankId)
    || sameText(executive.bankPartnerId, lead.assignedPartnerId)
    || sameText(executive.bankIfsc, lead.assignedBankIfsc)
    || sameText(executive.bankIfsc, lead.bankIfsc)
    || sameText(executive.ifsc, lead.assignedBankIfsc)
    || sameText(executive.ifsc, lead.ifscCode)
    || sameText(executive.bankName, lead.assignedBankName)
    || sameText(executive.bankName, lead.selectedBankName)
    || sameText(executive.bankName, lead.bankName)
    || sameText(executive.bankName, lead.bankPartner)
    || sameText(executive.bankName, lead.preferredBank)
    || sameText(executive.branchId, lead.branchId);
}

function nextPartnerIndex(queue, partners) {
  if (!queue?.lastAssignedPartner) return 0;
  const current = partners.findIndex((partner) => partner.id === queue.lastAssignedPartner || partner.name === queue.lastAssignedPartner);
  if (current < 0) return 0;
  return (current + 1) % partners.length;
}

async function selectBranchExecutive({ lead, partner, city }) {
  const executivesPage = await queryRecords("loanExecutives", {
    where: partner.bankId || partner.id ? [{ field: "bankId", value: partner.bankId || partner.id }] : [],
    orderBy: "createdAt",
    direction: "desc",
    limit: 100,
    maxLimit: 100,
  });
  const executives = executivesPage.data;
  const eligible = executives.filter((executive) => {
    const executiveCity = executive.branchCity || executive.city || executive.operatingCity;
    const sameBranchCity = !city || !executiveCity || executiveCity === city;
    const sameBank = executive.bankPartnerId === partner.id
      || executive.bankPartnerId === partner.email
      || executive.bankName === partner.bankName
      || executive.bankName === partner.name
      || executive.branchId === partner.branchId;
    return sameBank && sameBranchCity && executive.active !== false && executive.paused !== true && executive.status !== "inactive";
  });

  if (!eligible.length) return null;

  const queueId = `executive:${partner.id || partner.email}:${city || "all"}`.toLowerCase();
  const queue = await getRecord("partnerQueues", queueId);
  const index = queue?.lastAssignedExecutive
    ? Math.max(0, (eligible.findIndex((executive) => executive.id === queue.lastAssignedExecutive) + 1) % eligible.length)
    : 0;
  const executive = eligible[index];

  await upsertRecord("partnerQueues", queueId, {
    queueKey: queueId,
    lastAssignedExecutive: executive.id,
    lastAssignedLead: lead.id,
    lastAssignedAt: new Date().toISOString(),
  });

  return executive;
}

async function projectedExecutiveWorkload(bankId, eligible = []) {
  if (!bankId || !eligible.length) return null;
  const summaries = await queryExecutiveSummaryProjection({ bankId, query: { limit: 100 } }).catch(() => null);
  if (!summaries?.length) return null;
  const byKey = new Map();
  for (const summary of summaries) {
    const count = Number(summary.currentActiveCases || 0);
    executiveIdentityKeys(summary).forEach((key) => byKey.set(key, count));
  }
  const workload = new Map();
  for (const executive of eligible) {
    const key = executiveIdentityKeys(executive).find((value) => byKey.has(value));
    if (key) workload.set(executive.id, byKey.get(key));
  }
  return workload;
}

export async function assignLeadRoundRobin(lead, { excludePartnerIds = [], reason = "new-lead" } = {}) {
  // Legacy assignment engine has been disabled in favor of dealership-selected branch routing.
  return null;

  const settings = await getWorkflowSettings();
  if (settings.roundRobinEnabled === false) return null;
  const routingCity = routingCityForLead(lead);

  const dealershipsPage = routingCity ? await queryRecords("dealerships", {
    where: [{ field: "city", value: routingCity }],
    orderBy: "createdAt",
    direction: "desc",
    limit: 25,
    maxLimit: 25,
  }) : { data: [] };
  const matchingDealerships = dealershipsPage.data.filter((dealer) => dealer.status !== "Rejected" && dealer.active !== false);
  const partners = (await getEligiblePartners(lead)).filter((partner) => !excludePartnerIds.includes(partner.id));
  if (!partners.length) {
    await createRecord("reassignmentLogs", {
      leadId: lead.id,
      reason,
      status: "queued",
      message: "No eligible bank partner found",
    });
    await createNotification({
      type: "assignment-queued",
      title: "Lead waiting for partner",
      message: `No eligible bank partner found for lead ${lead.caseId || lead.id}`,
      leadId: lead.id,
      admin: true,
    });
    const updatedLead = await updateRecord("leads", lead.id, {
      matchedDealerships: matchingDealerships.map((dealer) => ({
        dealershipName: dealer.dealershipName,
        dealershipEmail: dealer.loginEmail || dealer.officialDealershipEmail,
        city: dealer.city,
      })),
      distributionCity: routingCity,
      routingCity,
    });
    syncLeadProjectionSoon(updatedLead);
    return null;
  }

  const queueId = queueIdForLead(lead);
  const queue = await getRecord("partnerQueues", queueId);
  const partner = partners[nextPartnerIndex(queue, partners)];
  const now = new Date().toISOString();
  const responseDeadlineAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const executive = await selectBranchExecutive({ lead, partner, city: routingCity });

  const assignment = await createRecord("leadAssignments", {
    leadId: lead.id,
    partnerId: partner.id,
    partnerName: partner.name || partner.bankName,
    branchCity: routingCity,
    executiveId: executive?.id || null,
    executiveName: executive?.name || executive?.fullName || null,
    executiveMobile: executive?.mobile || null,
    status: "pending",
    reason,
    assignmentTimestamp: now,
    responseDeadlineAt,
  });

  const historyEntry = {
    assignmentId: assignment.id,
    partnerId: partner.id,
    partnerName: partner.name || partner.bankName,
    branchCity: routingCity,
    executiveId: executive?.id || null,
    executiveName: executive?.name || executive?.fullName || null,
    executiveMobile: executive?.mobile || null,
    timestamp: now,
    reason,
  };

  const assignedLead = await updateRecord("leads", lead.id, {
    status: LEAD_STATUSES.NEW,
    assignedPartnerId: partner.id,
    bankId: partner.bankId || partner.id,
    bankPartner: partner.name || partner.bankName,
    assignedBankName: partner.name || partner.bankName,
    assignedBankIfsc: partner.ifsc || partner.bankIfsc || partner.ifscCode || null,
    preferredBank: partner.bankName || partner.name || lead.preferredBank,
    assignmentStatus: "pending",
    branchCity: routingCity,
    bankBranchCity: routingCity,
    assignedExecutiveId: executive?.id || null,
    assignedExecutiveEmail: executive?.email || executive?.officialEmail || null,
    assignedExecutiveName: executive?.name || executive?.fullName || null,
    assignedExecutiveMobile: executive?.mobile || null,
    lastAssignedPartner: partner.id,
    assignmentTimestamp: now,
    slaAcceptDeadlineAt: responseDeadlineAt,
    assignmentHistory: [...(lead.assignmentHistory || []), historyEntry],
    distributionCity: routingCity,
    routingCity,
    matchedDealerships: matchingDealerships.map((dealer) => ({
      dealershipName: dealer.dealershipName,
      dealershipEmail: dealer.loginEmail || dealer.officialDealershipEmail,
      city: dealer.city,
    })),
  });
  syncLeadProjectionSoon(assignedLead);

  await upsertRecord("partnerQueues", queueId, {
    queueKey: queueId,
    lastAssignedPartner: partner.id,
    lastAssignedLead: lead.id,
    lastAssignedAt: now,
  });

  await createSlaLog({ lead, assignment, status: "pending" });
  await writeAuditLog({
    actionType: AUDIT_ACTIONS.LEAD_ASSIGNED,
    actorId: "assignment-engine",
    actorRole: "system",
    newValue: {
      partnerId: partner.id,
      partnerName: partner.name || partner.bankName,
      executiveId: executive?.id || null,
      executiveName: executive?.name || executive?.fullName || null,
      executiveMobile: executive?.mobile || null,
    },
    leadId: lead.id,
    meta: {
      caseId: lead.caseId,
      dealershipId: lead.dealershipId || lead.dealershipEmail || lead.dealerEmail,
      bankId: partner.bankId || partner.id,
        assignedExecutiveId: executive?.id || null,
        assignedExecutiveMobile: executive?.mobile || null,
    },
  });
  await createRecord("slaTracking", {
    leadId: lead.id,
    assignmentId: assignment.id,
    partnerId: partner.id,
    executiveId: executive?.id || null,
    branchCity: routingCity,
    status: "pending",
    acceptDeadlineAt: responseDeadlineAt,
    startedAt: now,
  });
  await addTimelineEvent({
    leadId: lead.id,
    eventType: TIMELINE_EVENTS.LEAD_SENT_TO_BANK,
    title: "Lead Sent To Bank",
    description: `Lead sent to ${partner.name || partner.bankName}`,
    actorName: "Assignment Engine",
    actorRole: "system",
    branchId: partner.branchId || null,
    dealershipId: lead.dealershipEmail || lead.dealerEmail || null,
    metadata: { partnerId: partner.id, bankName: partner.name || partner.bankName, routingCity },
  });
  await addTimelineEvent({
    leadId: lead.id,
    eventType: TIMELINE_EVENTS.BRANCH_ASSIGNED,
    title: "Branch Assigned",
    description: `${partner.name || partner.bankName} ${routingCity || ""} branch assigned`,
    actorName: "Assignment Engine",
    actorRole: "system",
    branchId: partner.branchId || null,
    dealershipId: lead.dealershipEmail || lead.dealerEmail || null,
    metadata: { partnerId: partner.id, bankName: partner.name || partner.bankName, routingCity },
  });
  if (executive) {
    await addTimelineEvent({
      leadId: lead.id,
      eventType: TIMELINE_EVENTS.EXECUTIVE_ASSIGNED,
      title: "Executive Assigned",
      description: `Assigned to ${executive.name || executive.fullName}`,
      actorName: "Assignment Engine",
      actorRole: "system",
      branchId: partner.branchId || null,
      dealershipId: lead.dealershipEmail || lead.dealerEmail || null,
      metadata: { executiveId: executive.id, executiveName: executive.name || executive.fullName, executiveMobile: executive.mobile || null, routingCity },
    });
  }
  await addTimelineEvent({
    leadId: lead.id,
    eventType: TIMELINE_EVENTS.SLA_STARTED,
    title: "SLA Started",
    description: "1 hour acceptance SLA started",
    actorName: "Assignment Engine",
    actorRole: "system",
    branchId: partner.branchId || null,
    dealershipId: lead.dealershipEmail || lead.dealerEmail || null,
    metadata: { acceptDeadlineAt: responseDeadlineAt, assignmentId: assignment.id },
  });
  await addTimelineEvent({
    leadId: lead.id,
    eventType: TIMELINE_EVENTS.LEAD_SENT_TO_BANK,
    title: "Assigned to Bank",
    description: `Lead assigned to ${partner.name || partner.bankName}${executive ? ` / ${executive.name || executive.fullName}` : ""}`,
    actor: "assignment-engine",
    type: "assignment",
    meta: { assignmentId: assignment.id, partnerId: partner.id },
  });
  await createNotification({
    type: "new-lead-assigned",
    title: "New lead assigned",
    message: `Lead ${lead.caseId || lead.id} assigned to ${partner.name || partner.bankName}`,
    leadId: lead.id,
    partnerId: partner.id,
    bankId: partner.bankId || partner.id,
    assignedExecutiveId: executive?.id || null,
    recipientRole: executive ? "loan-executive" : "bank-manager",
    recipientId: executive?.id || partner.id,
    phoneNumber: executive?.mobile || partner.mobile,
    meta: {
      caseId: lead.caseId,
      customerName: lead.fullName,
      dealershipName: lead.dealershipName,
      bankName: partner.name || partner.bankName,
      executiveName: executive?.name || executive?.fullName,
      executiveMobile: executive?.mobile || null,
      loanAmount: lead.loanAmount,
    },
  });

  return assignment;
}

export async function retrieveAndReassignLead(leadId, reason = "manual-reassignment", requestedBy = "system") {
  const settings = await getWorkflowSettings();
  if (settings.autoReassignmentEnabled === false) return null;

  const lead = await getRecord("leads", leadId);
  if (!lead) {
    const error = new Error("Lead not found");
    error.status = 404;
    throw error;
  }

  const assignmentsPage = await queryRecords("leadAssignments", {
    where: [{ field: "leadId", value: leadId }, { field: "status", op: "in", value: ["pending", "accepted", "in-progress"] }],
    orderBy: "createdAt",
    direction: "desc",
    limit: 5,
    maxLimit: 5,
  });
  const active = assignmentsPage.data[0];
  const excluded = [];

  if (active) {
    excluded.push(active.partnerId);
    await expireAssignment({ lead, assignment: active, reason });
  }

  await createRecord("reassignmentLogs", {
    leadId,
    fromPartnerId: active?.partnerId || lead.assignedPartnerId,
    reason,
    requestedBy,
    status: "retrieved",
  });
  await addTimelineEvent({
    leadId,
    eventType: TIMELINE_EVENTS.LEAD_REASSIGNED,
    title: "Lead Reassigned",
    description: `Lead retrieved for reassignment: ${reason}`,
    actorName: requestedBy,
    actorRole: requestedBy === "sla-engine" ? "system" : "user",
    metadata: { fromPartnerId: active?.partnerId || lead.assignedPartnerId, reason },
    leadSnapshot: lead,
  });
  await writeAuditLog({
    actionType: AUDIT_ACTIONS.EXECUTIVE_REASSIGNED,
    actorId: requestedBy,
    actorRole: requestedBy === "sla-engine" ? "system" : "user",
    oldValue: active?.partnerId || lead.assignedPartnerId || null,
    newValue: reason,
    leadId,
    meta: { caseId: lead.caseId, dealershipId: lead.dealershipId, bankId: lead.bankId },
  });

  const retrievedLead = await updateRecord("leads", leadId, {
    assignmentStatus: "retrieved",
    assignedPartnerId: null,
    bankPartner: null,
  });
  syncLeadProjectionSoon(retrievedLead);

  const freshLead = await getRecord("leads", leadId);
  const assignment = await assignLeadRoundRobin(freshLead, { excludePartnerIds: excluded, reason });
  const reassignedLead = await getRecord("leads", leadId);
  if (reassignedLead) {
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.EXECUTIVE_REASSIGNED,
      lead: reassignedLead,
      actor: { email: requestedBy, role: requestedBy === "sla-engine" ? "system" : "user" },
      data: { reason },
    });
  }

  await createNotification({
    type: "executive-reassigned",
    title: "Lead reassigned",
    message: `Lead ${leadId} reassigned because ${reason}`,
    leadId,
    admin: true,
    priority: "high",
    meta: {
      reason,
      leadId,
      caseId: freshLead.caseId,
      customerName: freshLead.fullName || freshLead.customerName,
      dealershipId: freshLead.dealershipId,
      bankId: freshLead.bankId,
      assignedExecutiveId: freshLead.assignedExecutiveId,
    },
    dealershipId: freshLead.dealershipId || null,
    bankId: freshLead.bankId || null,
    assignedExecutiveId: freshLead.assignedExecutiveId || null,
    leadSnapshot: freshLead,
  });

  return assignment;
}

export async function reassignLeadToNextBranchExecutive(leadId, reason = "manager-reassignment", requestedBy = "bank-manager", options = {}) {
  const lead = await getRecord("leads", leadId);
  if (!lead) {
    const error = new Error("Lead not found");
    error.status = 404;
    throw error;
  }

  const branchCity = lead.bankBranchCity || lead.branchCity || lead.routingCity || lead.dealershipCity || lead.city;
  const currentExecutive = {
    id: lead.assignedExecutiveId || null,
    email: lead.assignedExecutiveEmail || null,
    name: lead.assignedExecutiveName || null,
    mobile: lead.assignedExecutiveMobile || lead.executiveMobile || null,
  };
  const executivesPage = await queryRecords("loanExecutives", {
    where: lead.bankId ? [{ field: "bankId", value: lead.bankId }] : [],
    orderBy: "createdAt",
    direction: "desc",
    limit: 100,
    maxLimit: 100,
  });
  const executives = executivesPage.data;
  const previousExecutive = executives.find((item) => sameExecutive(currentExecutive, item)) || {
    ...currentExecutive,
    bankId: lead.bankId || lead.assignedPartnerId || "",
  };
  const eligible = executives.filter((executive) => {
    const sameBank = bankMatchesExecutive(lead, executive);
    return sameBank && sameBranchExecutive(lead, executive) && activeExecutive(executive) && !sameExecutive(currentExecutive, executive);
  });

  if (!eligible.length) {
    const error = new Error("No active same-branch executive available");
    error.status = 400;
    throw error;
  }

  let executive = null;
  if (options.newExecutiveId) {
    const requestedExecutive = await resolveTargetExecutive({ lead, targetExecutiveId: options.newExecutiveId });
    if (!requestedExecutive || !eligible.some((item) => sameExecutive(item, requestedExecutive))) {
      const error = new Error("Select an active same-branch executive");
      error.status = 400;
      error.code = "INVALID_REASSIGNMENT_TARGET";
      throw error;
    }
    executive = requestedExecutive;
  } else {
    const workload = await projectedExecutiveWorkload(lead.bankId || lead.assignedPartnerId, eligible) || new Map();
    const missing = eligible.filter((item) => !workload.has(item.id));
    if (missing.length) {
      const liveCounts = await Promise.all(missing.map(async (item) => [item.id, await countOpenExecutiveLeads(item.id)]));
      liveCounts.forEach(([id, count]) => workload.set(id, count));
    }
    executive = eligible.sort((a, b) => (workload.get(a.id) || 0) - (workload.get(b.id) || 0))[0];
  }
  const now = new Date().toISOString();
  const responseDeadlineAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const executiveName = executive.name || executive.fullName || executive.email;
  const executiveEmail = executive.email || executive.officialEmail || executive.id || null;
  const executiveMobile = executive.mobile || null;
  const previousExecutiveKeys = [lead.assignedExecutiveId, lead.assignedExecutiveEmail].filter(Boolean);
  const historyEntry = {
    transferredFrom: {
      executiveId: currentExecutive.id,
      executiveEmail: currentExecutive.email,
      executiveName: currentExecutive.name,
      executiveMobile: currentExecutive.mobile,
    },
    transferredTo: {
      executiveId: executive.id,
      executiveEmail,
      executiveName,
      executiveMobile,
    },
    transferredBy: requestedBy,
    dateTime: now,
    timestamp: now,
    reason,
    branchCity,
    bankIfsc: lead.assignedBankIfsc || lead.bankIfsc || lead.ifscCode || executive.bankIfsc || executive.ifsc || null,
  };

  const updated = await runRecordTransaction(async (transaction) => {
    const latestLead = await transaction.get("leads", leadId);
    if (!latestLead) {
      const error = new Error("Lead not found");
      error.status = 404;
      throw error;
    }
    const freshCurrent = {
      id: latestLead.assignedExecutiveId || null,
      email: latestLead.assignedExecutiveEmail || null,
      mobile: latestLead.assignedExecutiveMobile || latestLead.executiveMobile || null,
    };
    if (sameExecutive(freshCurrent, executive)) {
      const error = new Error("Cannot transfer case to the same executive");
      error.status = 400;
      error.code = "SAME_EXECUTIVE_REASSIGNMENT";
      throw error;
    }
    const leadPatch = {
      assignedExecutiveId: executive.id,
      assignedExecutiveEmail: executiveEmail,
      assignedExecutiveName: executiveName,
      assignedExecutiveMobile: executiveMobile,
      executiveMobile,
      assignmentStatus: "pending",
      status: LEAD_STATUSES.NEW,
      assignmentTimestamp: now,
      assignedAt: now,
      assignedByManager: requestedBy,
      reassignedAt: now,
      reassignedBy: requestedBy,
      reassignmentReason: reason,
      slaAcceptDeadlineAt: responseDeadlineAt,
      assignmentHistory: [...(latestLead.assignmentHistory || []), historyEntry],
    };
    transaction.update("leads", leadId, leadPatch);
    const activeAssignmentPage = await queryRecords("leadAssignments", {
      where: [{ field: "leadId", value: leadId }, { field: "status", op: "in", value: ["pending", "accepted", "in-progress"] }],
      orderBy: "createdAt",
      direction: "desc",
      limit: 5,
      maxLimit: 5,
    });
    const activeAssignment = activeAssignmentPage.data[0];
    if (activeAssignment) {
      transaction.update("leadAssignments", activeAssignment.id, {
        previousExecutiveId: freshCurrent.id,
        previousExecutiveEmail: freshCurrent.email,
        executiveId: executive.id,
        assignedExecutiveId: executive.id,
        executiveEmail,
        assignedExecutiveEmail: executiveEmail,
        executiveName,
        assignedExecutiveName: executiveName,
        executiveMobile,
        assignedExecutiveMobile: executiveMobile,
        status: "pending",
        reassignedAt: now,
        reassignedBy: requestedBy,
        reason,
        assignmentTimestamp: now,
        responseDeadlineAt,
      });
    } else {
      const assignmentId = `assignment-${leadId}-${Date.now()}`;
      transaction.set("leadAssignments", assignmentId, {
        id: assignmentId,
        leadId,
        partnerId: latestLead.assignedPartnerId || latestLead.bankId || null,
        partnerName: latestLead.assignedBankName || latestLead.selectedBankName || latestLead.bankPartner || latestLead.bankName || null,
        bankId: latestLead.bankId || null,
        branchCity,
        executiveId: executive.id,
        assignedExecutiveId: executive.id,
        executiveEmail,
        assignedExecutiveEmail: executiveEmail,
        executiveName,
        assignedExecutiveName: executiveName,
        executiveMobile,
        assignedExecutiveMobile: executiveMobile,
        status: "pending",
        reason,
        assignmentTimestamp: now,
        responseDeadlineAt,
        createdAt: now,
      });
    }
    const logId = `reassignment-${leadId}-${Date.now()}`;
    transaction.set("reassignmentLogs", logId, {
      id: logId,
      leadId,
      caseId: latestLead.caseId || leadId,
      fromExecutiveId: freshCurrent.id,
      fromExecutiveEmail: freshCurrent.email,
      toExecutiveId: executive.id,
      toExecutiveEmail: executiveEmail,
      toExecutiveName: executiveName,
      toExecutiveMobile: executiveMobile,
      bankId: latestLead.bankId || null,
      bankIfsc: historyEntry.bankIfsc,
      branchCity,
      reason,
      requestedBy,
      status: "reassigned",
      createdAt: now,
    });
    return { ...latestLead, ...leadPatch, updatedAt: now };
  });
  syncLeadProjectionSoon(updated);
  await Promise.all(previousExecutiveKeys.map((key) => removeLeadExecutiveProjection({ leadId, executiveId: key })));
  await Promise.all([
    refreshExecutiveSummary(executive),
    refreshExecutiveSummary(previousExecutive),
  ]);
  await addTimelineEvent({
    leadId,
    eventType: TIMELINE_EVENTS.LEAD_REASSIGNED,
    title: "Case Reassigned",
    description: `Case reassigned from ${currentExecutive.name || currentExecutive.email || "previous executive"} to ${executiveName}`,
    actorName: requestedBy,
    actorRole: "bank-manager",
    metadata: { ...historyEntry, fromExecutiveId: currentExecutive.id || currentExecutive.email || null, toExecutiveId: executive.id },
    leadSnapshot: updated,
  });
  await createNotification({
    type: "executive-reassigned",
    title: "Lead reassigned",
    message: `Lead ${updated.caseId || leadId} reassigned to ${executiveName}`,
    leadId,
    recipientRole: "loan-executive",
    recipientId: executive.id,
    phoneNumber: executiveMobile,
    meta: {
      reason,
      branchCity,
      caseId: updated.caseId,
      customerName: updated.fullName || updated.customerName,
      dealershipId: updated.dealershipId,
      bankId: updated.bankId,
      assignedExecutiveId: updated.assignedExecutiveId,
    },
    dealershipId: updated.dealershipId || null,
    bankId: updated.bankId || null,
    assignedExecutiveId: updated.assignedExecutiveId || null,
    leadSnapshot: updated,
  });

  publishRealtimeEvent({
    eventType: REALTIME_EVENTS.EXECUTIVE_REASSIGNED,
    lead: updated,
    actor: { email: requestedBy, role: requestedBy === "sla-engine" ? "system" : "bank-manager" },
    data: {
      reason,
      fromExecutiveId: currentExecutive.id || currentExecutive.email || "",
      toExecutiveId: executive.id,
      previousExecutiveId: currentExecutive.id || currentExecutive.email || "",
      assignedExecutiveId: executive.id,
      recipientId: executive.id,
    },
  });

  return updated;
}

export async function processSlaBreaches() {
  const settings = await getWorkflowSettings();
  if (settings.slaEngineEnabled === false) return [];
  const batchLimit = Math.min(Math.max(Number(process.env.SLA_ENGINE_BATCH_SIZE || 30), 1), 60);
  const assignmentPages = await Promise.all(["pending", "accepted", "in-progress"].map((status) => queryRecords("leadAssignments", {
    where: [{ field: "status", value: status }],
    orderBy: "status",
    direction: "asc",
    limit: Math.ceil(batchLimit / 3),
    maxLimit: 25,
    fields: ["id", "leadId", "status", "assignmentTimestamp", "createdAt", "partnerId", "partnerName", "executiveId", "executiveEmail", "executiveName"],
  }).catch(() => ({ data: [] }))));
  const assignments = assignmentPages
    .flatMap((page) => page.data || [])
    .sort((left, right) => String(left.assignmentTimestamp || left.createdAt || "").localeCompare(String(right.assignmentTimestamp || right.createdAt || "")))
    .slice(0, batchLimit);
  const now = Date.now();
  const expired = assignments.filter((assignment) => {
    if (!["pending", "accepted", "in-progress"].includes(assignment.status)) return false;
    const assignedAt = new Date(assignment.assignmentTimestamp || assignment.createdAt).getTime();
    const limitMinutes = assignment.status === "pending"
      ? Number(settings.slaAcceptMinutes)
      : Number(settings.idleReassignMinutes);
    return now - assignedAt > limitMinutes * 60 * 1000;
  });

  const results = [];
  for (const assignment of expired) {
    const reason = assignment.status === "pending" ? "sla-acceptance-expired" : "lead-idle-timeout";
    const next = await retrieveAndReassignLead(assignment.leadId, reason, "sla-engine");
    results.push({ leadId: assignment.leadId, previousAssignmentId: assignment.id, nextAssignmentId: next?.id || null });
  }
  return results;
}
