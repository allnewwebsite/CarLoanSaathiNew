import { createRecord, getRecord, queryRecords, updateRecord, upsertRecord } from "./firestore.service.js";
import { createNotification } from "./notification.service.js";
import { getEligiblePartners } from "./partner.service.js";
import { createSlaLog, expireAssignment } from "./sla.service.js";
import { getWorkflowSettings } from "./settings.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "./timeline.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "./audit.service.js";
import { countOpenExecutiveLeads } from "./leadQuery.service.js";
import { LEAD_STATUSES } from "../utils/status.constants.js";

function queueIdForLead(lead) {
  return `${routingCityForLead(lead) || "all"}:${lead.selectedBrand || "all"}:${lead.preferredBank || "all"}`.toLowerCase();
}

function routingCityForLead(lead) {
  return lead.dealershipCity || lead.routingCity || lead.dealerCity || lead.branchCity || lead.city;
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
    await updateRecord("leads", lead.id, {
      matchedDealerships: matchingDealerships.map((dealer) => ({
        dealershipName: dealer.dealershipName,
        dealershipEmail: dealer.loginEmail || dealer.officialDealershipEmail,
        city: dealer.city,
      })),
      distributionCity: routingCity,
      routingCity,
    });
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

  await updateRecord("leads", lead.id, {
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

  await updateRecord("leads", leadId, {
    assignmentStatus: "retrieved",
    assignedPartnerId: null,
    bankPartner: null,
  });

  const freshLead = await getRecord("leads", leadId);
  const assignment = await assignLeadRoundRobin(freshLead, { excludePartnerIds: excluded, reason });

  await createNotification({
    type: "executive-reassigned",
    title: "Lead reassigned",
    message: `Lead ${leadId} reassigned because ${reason}`,
    leadId,
    admin: true,
    priority: "high",
    meta: { reason, leadId },
  });

  return assignment;
}

export async function reassignLeadToNextBranchExecutive(leadId, reason = "manager-reassignment", requestedBy = "bank-manager") {
  const lead = await getRecord("leads", leadId);
  if (!lead) {
    const error = new Error("Lead not found");
    error.status = 404;
    throw error;
  }

  const branchCity = lead.bankBranchCity || lead.branchCity || lead.routingCity || lead.dealershipCity || lead.city;
  const currentExecutive = lead.assignedExecutiveId || lead.assignedExecutiveEmail;
  const executivesPage = await queryRecords("loanExecutives", {
    where: lead.bankId ? [{ field: "bankId", value: lead.bankId }] : [],
    orderBy: "createdAt",
    direction: "desc",
    limit: 100,
    maxLimit: 100,
  });
  const executives = executivesPage.data;
  const eligible = executives.filter((executive) => {
    const executiveCity = executive.branchCity || executive.city || executive.operatingCity;
    const sameCity = !branchCity || !executiveCity || executiveCity === branchCity;
    const sameBank = executive.bankPartnerId === lead.assignedPartnerId
      || executive.bankName === lead.bankPartner
      || executive.bankName === lead.preferredBank
      || executive.branchId === lead.branchId;
    const active = executive.active !== false && executive.paused !== true && executive.status !== "inactive";
    return sameCity && sameBank && active && executive.id !== currentExecutive && executive.email !== currentExecutive;
  });

  if (!eligible.length) {
    const error = new Error("No active same-branch executive available");
    error.status = 400;
    throw error;
  }

  const workload = new Map(await Promise.all(
    eligible.map(async (item) => [item.id, await countOpenExecutiveLeads(item.id)])
  ));
  const executive = eligible.sort((a, b) => (workload.get(a.id) || 0) - (workload.get(b.id) || 0))[0];
  const now = new Date().toISOString();
  const responseDeadlineAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const updated = await updateRecord("leads", leadId, {
    assignedExecutiveId: executive.id,
    assignedExecutiveEmail: executive.email || null,
    assignedExecutiveName: executive.name || executive.fullName || executive.email,
    assignedExecutiveMobile: executive.mobile || null,
    assignmentStatus: "pending",
    status: LEAD_STATUSES.NEW,
    assignmentTimestamp: now,
    slaAcceptDeadlineAt: responseDeadlineAt,
    assignmentHistory: [...(lead.assignmentHistory || []), {
      executiveId: executive.id,
      executiveName: executive.name || executive.fullName || executive.email,
      executiveMobile: executive.mobile || null,
      branchCity,
      timestamp: now,
      reason,
      requestedBy,
    }],
  });

  const assignmentsPage = await queryRecords("leadAssignments", {
    where: [{ field: "leadId", value: leadId }, { field: "status", op: "in", value: ["pending", "accepted", "in-progress"] }],
    orderBy: "createdAt",
    direction: "desc",
    limit: 5,
    maxLimit: 5,
  });
  const activeAssignment = assignmentsPage.data[0];
  if (activeAssignment) {
    await updateRecord("leadAssignments", activeAssignment.id, {
      executiveId: executive.id,
      executiveName: executive.name || executive.fullName || executive.email,
      executiveMobile: executive.mobile || null,
      status: "pending",
      assignmentTimestamp: now,
      responseDeadlineAt,
    });
  }

  await createRecord("reassignmentLogs", {
    leadId,
    fromExecutiveId: currentExecutive || null,
    toExecutiveId: executive.id,
    branchCity,
    reason,
    requestedBy,
    status: "reassigned",
    createdAt: now,
  });
  await addTimelineEvent({
    leadId,
    eventType: TIMELINE_EVENTS.LEAD_REASSIGNED,
    title: "Executive Reassigned",
    description: `Lead reassigned to ${executive.name || executive.fullName || executive.email}`,
    actorName: requestedBy,
    actorRole: "bank-manager",
    metadata: { fromExecutiveId: currentExecutive || null, toExecutiveId: executive.id, branchCity, reason },
  });
  await createNotification({
    type: "executive-reassigned",
    title: "Lead reassigned",
    message: `Lead ${leadId} reassigned to ${executive.name || executive.fullName || executive.email}`,
    leadId,
    recipientRole: "loan-executive",
    recipientId: executive.id,
    phoneNumber: executive.mobile,
    meta: { reason, branchCity },
  });

  return updated;
}

export async function processSlaBreaches() {
  const settings = await getWorkflowSettings();
  if (settings.slaEngineEnabled === false) return [];
  const assignmentsPage = await queryRecords("leadAssignments", {
    where: [{ field: "status", op: "in", value: ["pending", "accepted", "in-progress"] }],
    orderBy: "assignmentTimestamp",
    direction: "asc",
    limit: Number(process.env.SLA_ENGINE_BATCH_SIZE || 100),
    maxLimit: 100,
  });
  const assignments = assignmentsPage.data;
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
