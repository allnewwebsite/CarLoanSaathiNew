import { countRecords, createRecord, getRecord, queryRecords, runRecordTransaction, updateRecord, upsertRecord } from "./firestore.service.js";
import { assertLeadMutable } from "../utils/archive.js";
import { createNotification } from "./notification.service.js";
import { getEligiblePartners } from "./partner.service.js";
import { getWorkflowSettings } from "./settings.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "./timeline.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "./audit.service.js";
import { countOpenExecutiveLeads } from "./leadQuery.service.js";
import { queryExecutiveSummaryProjection, removeLeadExecutiveProjection, syncExecutiveSummaryProjectionSoon, syncLeadProjectionSoon } from "./projection.service.js";
import { publishRealtimeEvent, REALTIME_EVENTS } from "./realtime.service.js";
import { LEAD_STATUSES } from "../utils/status.constants.js";
import { logInfo } from "./logger.service.js";
import { syncBankAnalyticsAggregate } from "./bankAnalyticsAggregate.service.js";

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

function normalizedBranch(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\b(branch|br|city|district)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function fuzzySameBranch(left, right) {
  const a = normalizedBranch(left);
  const b = normalizedBranch(right);
  if (!a || !b) return true;
  return a === b || a.includes(b) || b.includes(a);
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
  return record.bankBranchLocation || record.branchLocation || record.branchCity || record.branch || record.bankLocation || record.city || record.operatingCity || record.bankBranchCity || record.branchId || "";
}

function sameBranchExecutive(lead = {}, executive = {}) {
  const leadIfsc = lead.assignedBankIfsc || lead.bankIfsc || lead.ifscCode || "";
  const executiveIfsc = executive.bankIfsc || executive.ifsc || executive.ifscCode || executive.branchIfsc || "";
  const executiveBranch = branchValue(executive);
  const executiveBankAliases = [executive.bankId, executive.bankPartnerId, executive.partnerId, executive.branchId].filter(Boolean);
  if (leadIfsc && executiveIfsc) return sameText(leadIfsc, executiveIfsc);
  if (leadIfsc && executiveBankAliases.some((value) => sameText(value, leadIfsc))) return true;
  if (leadIfsc && sameText(executiveBranch, leadIfsc)) return true;
  const leadBranch = lead.branchId || lead.bankBranchId || lead.bankBranchCity || lead.branchCity || lead.branchLocation || lead.bankBranchLocation || lead.routingCity || lead.city || "";
  if (executiveIfsc && sameText(leadBranch, executiveIfsc)) return true;
  return fuzzySameBranch(leadBranch, executiveBranch);
}

function sameExecutive(left = {}, right = {}) {
  const rightKeys = new Set(executiveIdentityKeys(right));
  return executiveIdentityKeys(left).some((key) => rightKeys.has(key));
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

function uniqueByIdentity(records = []) {
  const seen = new Set();
  return records.filter((record) => {
    const key = executiveIdentityKeys(record)[0] || record.id || JSON.stringify(record);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function queryBankExecutiveCandidates(lead = {}, options = {}) {
  const bankValues = [
    options.bankId,
    options.bankIfsc,
    lead.bankId,
    lead.assignedPartnerId,
    lead.assignedBankIfsc,
    lead.bankIfsc,
    lead.ifscCode,
    lead.assignedBankName,
    lead.bankName,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const values = [...new Set(bankValues)];
  const fields = ["bankId", "bankPartnerId", "partnerId", "bankIfsc", "ifsc", "ifscCode", "bankName"];
  const queries = values.flatMap((value) => fields.map((field) => queryRecords("loanExecutives", {
    where: [{ field, value }],
    orderBy: "createdAt",
    direction: "desc",
    limit: 100,
    maxLimit: 100,
  }).catch(() => ({ data: [] }))));
  if (!queries.length) {
    queries.push(queryRecords("loanExecutives", {
      orderBy: "createdAt",
      direction: "desc",
      limit: 100,
      maxLimit: 100,
    }).catch(() => ({ data: [] })));
  }
  const pages = await Promise.all(queries);
  return uniqueByIdentity(pages.flatMap((page) => page.data || []));
}

async function resolveTargetExecutive({ lead, targetExecutiveId, bankId = "", bankIfsc = "" }) {
  const requested = String(targetExecutiveId || "").trim();
  if (!requested) return null;
  const direct = await getRecord("loanExecutives", requested).catch(() => null);
  if (direct) return direct;
  const lower = requested.toLowerCase();
  const executives = await queryBankExecutiveCandidates(lead, { bankId, bankIfsc });
  return executives.find((executive) => executiveIdentityKeys(executive).includes(lower)) || null;
}

function bankMatchesExecutive(lead, executive, options = {}) {
  return sameText(executive.bankId, lead.bankId)
    || sameText(executive.bankId, options.bankId)
    || sameText(executive.bankId, options.bankIfsc)
    || sameText(executive.bankPartnerId, lead.bankId)
    || sameText(executive.bankPartnerId, options.bankId)
    || sameText(executive.bankPartnerId, lead.assignedPartnerId)
    || sameText(executive.bankIfsc, lead.assignedBankIfsc)
    || sameText(executive.bankIfsc, lead.bankIfsc)
    || sameText(executive.bankIfsc, options.bankIfsc)
    || sameText(executive.ifsc, lead.assignedBankIfsc)
    || sameText(executive.ifsc, lead.ifscCode)
    || sameText(executive.ifsc, options.bankIfsc)
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
    actorRole: "user",
    metadata: { fromPartnerId: active?.partnerId || lead.assignedPartnerId, reason },
    leadSnapshot: lead,
  });
  await writeAuditLog({
    actionType: AUDIT_ACTIONS.EXECUTIVE_REASSIGNED,
    actorId: requestedBy,
    actorRole: "user",
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
      actor: { email: requestedBy, role: "user" },
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
  const executives = await queryBankExecutiveCandidates(lead, { bankId: options.bankId, bankIfsc: options.bankIfsc });
  const previousExecutive = executives.find((item) => sameExecutive(currentExecutive, item)) || {
    ...currentExecutive,
    bankId: lead.bankId || lead.assignedPartnerId || "",
  };
  const reassignmentDiagnostics = executives.map((executive) => {
    const sameBank = bankMatchesExecutive(lead, executive, options);
    const sameBranch = sameBranchExecutive(lead, executive);
    const active = activeExecutive(executive);
    const current = sameExecutive(currentExecutive, executive);
    const reasons = [];
    if (!sameBank) reasons.push("bank mismatch");
    if (!sameBranch) reasons.push(`branch/IFSC mismatch (${branchValue(executive) || "missing branch"} / ${executive.bankIfsc || executive.ifsc || executive.ifscCode || "missing IFSC"})`);
    if (!active) reasons.push("inactive/deleted/suspended");
    if (current) reasons.push("current owner");
    return {
      id: executive.id || executive.email || executive.officialEmail || "",
      name: executive.name || executive.fullName || executive.email || executive.officialEmail || "",
      mobile: executive.mobile || "",
      branch: branchValue(executive) || "",
      ifsc: executive.bankIfsc || executive.ifsc || executive.ifscCode || "",
      eligible: sameBank && sameBranch && active && !current,
      reason: reasons.join(", ") || "eligible",
    };
  });
  const eligible = executives.filter((executive) => {
    const sameBank = bankMatchesExecutive(lead, executive, options);
    return sameBank && sameBranchExecutive(lead, executive) && activeExecutive(executive) && !sameExecutive(currentExecutive, executive);
  });
  logInfo("CASE_REASSIGNMENT_EXECUTIVE_FILTER", {
    leadId,
    caseId: lead.caseId || leadId,
    caseBranch: lead.bankBranchCity || lead.branchCity || lead.branchLocation || lead.bankBranchLocation || lead.routingCity || lead.city || "",
    caseIfsc: lead.assignedBankIfsc || lead.bankIfsc || lead.ifscCode || "",
    currentExecutive: currentExecutive.name || currentExecutive.email || currentExecutive.id || "",
    foundExecutives: executives.length,
    filteredExecutives: reassignmentDiagnostics,
    eligibleExecutives: reassignmentDiagnostics.filter((item) => item.eligible).map((item) => item.name || item.id),
  });

  if (!eligible.length) {
    const error = new Error("No active same-branch executive available");
    error.status = 400;
    throw error;
  }

  let executive = null;
  if (options.newExecutiveId) {
    const requestedExecutive = await resolveTargetExecutive({ lead, targetExecutiveId: options.newExecutiveId, bankId: options.bankId, bankIfsc: options.bankIfsc });
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
    assertLeadMutable(latestLead);
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
  await syncBankAnalyticsAggregate(updated);
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
    actor: { email: requestedBy, role: "bank-manager" },
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
