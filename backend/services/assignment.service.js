import { createRecord, getRecord, queryRecords, runRecordTransaction, updateRecord, upsertRecord } from "./firestore.service.js";
import { assertLeadMutable } from "../utils/deadCase.js";
import { createNotification } from "./notification.service.js";
import { getEligiblePartners } from "./partner.service.js";
import { getWorkflowSettings } from "./settings.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "./timeline.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "./audit.service.js";
import { countOpenExecutiveLeads } from "./leadQuery.service.js";
import { leadOwnershipProjectionPlan, syncLeadProjectionSoon } from "./projection.service.js";
import { publishRealtimeEvent, REALTIME_EVENTS } from "./realtime.service.js";
import { LEAD_STATUSES } from "../utils/status.constants.js";
import { logError, logInfo } from "./logger.service.js";
import { clearCachedTags, clearCachedValue } from "./ttlCache.service.js";
import { AUTOMATION_POLICY, addMilliseconds, assignmentAutomationPatch } from "./automationPolicy.service.js";
import {
  activeExecutive,
  bankMatchesExecutive,
  branchValue,
  projectedExecutiveWorkload,
  queryBankExecutiveCandidates,
  refreshExecutiveSummary,
  resolveTargetExecutive,
  sameBranchExecutive,
  sameExecutive,
} from "./assignmentExecutive.service.js";

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

  const activeAssignmentPage = await queryRecords("leadAssignments", {
    where: [{ field: "leadId", value: leadId }, { field: "status", op: "in", value: ["pending", "accepted", "in-progress"] }],
    orderBy: "createdAt",
    direction: "desc",
    limit: 5,
    maxLimit: 5,
  });
  const activeAssignment = activeAssignmentPage.data[0];

  const transferResult = await runRecordTransaction(async (transaction) => {
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
      name: latestLead.assignedExecutiveName || null,
      mobile: latestLead.assignedExecutiveMobile || latestLead.executiveMobile || null,
    };
    if (sameExecutive(freshCurrent, executive)) {
      const error = new Error("Cannot transfer case to the same executive");
      error.status = 400;
      error.code = "SAME_EXECUTIVE_REASSIGNMENT";
      throw error;
    }
    const completedHistoryEntry = {
      ...historyEntry,
      transferredFrom: {
        executiveId: freshCurrent.id,
        executiveEmail: freshCurrent.email,
        executiveName: freshCurrent.name,
        executiveMobile: freshCurrent.mobile,
      },
    };
    const leadPatch = {
      assignedExecutiveId: executive.id,
      assignedExecutiveEmail: executiveEmail,
      assignedExecutiveName: executiveName,
      assignedExecutiveMobile: executiveMobile,
      executiveMobile,
      ownerId: executive.id,
      ...assignmentAutomationPatch(now),
      status: LEAD_STATUSES.NEW,
      assignmentTimestamp: now,
      assignedAt: now,
      assignedByManager: requestedBy,
      reassignedAt: now,
      reassignedBy: requestedBy,
      reassignmentReason: reason,
      assignmentHistory: [...(latestLead.assignmentHistory || []), completedHistoryEntry],
    };
    transaction.update("leads", leadId, leadPatch);
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
        ownerId: executive.id,
        status: "pending",
        ownershipStatus: "PENDING",
        accepted: false,
        acceptanceDueAt: addMilliseconds(now, AUTOMATION_POLICY.acceptanceSlaMs),
        acceptedAt: null,
        acceptedBy: null,
        acceptedExecutiveId: null,
        slaRunning: true,
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
        ownerId: executive.id,
        status: "pending",
        ownershipStatus: "PENDING",
        accepted: false,
        acceptanceDueAt: addMilliseconds(now, AUTOMATION_POLICY.acceptanceSlaMs),
        acceptedAt: null,
        acceptedBy: null,
        acceptedExecutiveId: null,
        slaRunning: true,
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
    const nextLead = { ...latestLead, ...leadPatch, updatedAt: now };
    const previousPlan = leadOwnershipProjectionPlan(latestLead);
    const nextPlan = leadOwnershipProjectionPlan(nextLead);
    const nextExecutiveDocs = new Set(nextPlan.executiveDocIds);
    previousPlan.executiveDocIds
      .filter((docId) => !nextExecutiveDocs.has(docId))
      .forEach((docId) => transaction.delete("executiveViews", docId));
    nextPlan.writes.forEach((write) => transaction.set(write.collection, write.docId, write.payload));
    return {
      lead: nextLead,
      previousExecutive: freshCurrent,
      previousExecutiveKeys: [
        freshCurrent.id,
        freshCurrent.email,
        freshCurrent.mobile,
      ].filter(Boolean),
      historyEntry: completedHistoryEntry,
    };
  });

  const updated = transferResult.lead;
  const transferredFrom = transferResult.previousExecutive;
  const transferredFromKeys = transferResult.previousExecutiveKeys;
  const completedHistoryEntry = transferResult.historyEntry;
  const previousExecutiveRecord = executives.find((item) => sameExecutive(transferredFrom, item)) || {
    ...previousExecutive,
    ...transferredFrom,
  };

  const assignmentRealtimeEvent = transferredFrom.id || transferredFrom.email || transferredFrom.mobile
    ? REALTIME_EVENTS.EXECUTIVE_REASSIGNED
    : REALTIME_EVENTS.EXECUTIVE_ASSIGNED;
  clearCachedValue("lead-query:");
  clearCachedTags([
    `lead:${leadId}`,
    "lead:list",
    "dashboard:fast",
    "bank:summary",
    "bank:executive-cases",
    "bank:leads",
    "notifications",
  ]);
  publishRealtimeEvent({
    eventType: assignmentRealtimeEvent,
    lead: updated,
    actor: { email: requestedBy, role: "bank-manager" },
    data: {
      reason,
      fromExecutiveId: transferredFrom.id || transferredFrom.email || "",
      toExecutiveId: executive.id,
      previousExecutiveId: transferredFrom.id || transferredFrom.email || "",
      previousExecutiveIds: transferredFromKeys,
      assignedExecutiveId: executive.id,
      executiveId: executive.id,
      recipientId: executive.id,
    },
  });

  const runFollowUps = async () => {
    syncLeadProjectionSoon(updated);
    await Promise.all([
      refreshExecutiveSummary(executive),
      refreshExecutiveSummary(previousExecutiveRecord),
    ]);
    await addTimelineEvent({
      leadId,
      eventType: TIMELINE_EVENTS.LEAD_REASSIGNED,
      title: "Case Reassigned",
      description: `Case reassigned from ${transferredFrom.name || transferredFrom.email || "previous executive"} to ${executiveName}`,
      actorName: requestedBy,
      actorRole: "bank-manager",
      metadata: { ...completedHistoryEntry, fromExecutiveId: transferredFrom.id || transferredFrom.email || null, toExecutiveId: executive.id },
      leadSnapshot: updated,
    });
    if (reason !== "lead-created-auto-assignment") await createNotification({
      type: "executive-reassigned",
      title: "Lead reassigned",
      message: `Lead ${updated.caseId || leadId} reassigned to ${executiveName}. Accept it within 5 hours to keep the assignment.`,
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
  };

  if (options.deferFollowUps === true) {
    Promise.resolve()
      .then(runFollowUps)
      .catch((error) => {
        logError("Assignment follow-up failed", {
          leadId,
          caseId: updated.caseId || leadId,
          reason,
          error: error.message,
        });
      });
  } else {
    await runFollowUps();
  }

  return updated;
}
