import { deleteRecord, deleteRecordsByQuery, queryRecords, updateRecord } from "./firestore.service.js";
import { createNotification } from "./notification.service.js";
import { reassignLeadToNextBranchExecutive } from "./assignment.service.js";
import { moveLeadToDeadCase } from "./deadCase.service.js";
import { removeLeadProjections } from "./projection.service.js";
import { deleteLeadDocument } from "./storage.service.js";
import { clearCachedTags, clearCachedValue } from "./ttlCache.service.js";
import { logError, logInfo } from "./logger.service.js";
import { queueLeadAssignedWhatsApp } from "./whatsappQueue.service.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";
import { AUTOMATION_POLICY, addCalendarMonths, addMilliseconds, currentWorkflowLocation, retentionDue } from "./automationPolicy.service.js";

const AUTOMATION_SCAN_LIMIT = Math.min(Math.max(Number(process.env.AUTOMATION_SCAN_LIMIT || 100), 1), 250);
const RELATED_LEAD_COLLECTIONS = Object.freeze([
  "leadAssignments",
  "leadAssignmentHistory",
  "assignmentHistory",
  "assignmentErrorQueue",
  "reassignmentLogs",
  "leadTimeline",
  "timelineProjection",
  "notifications",
  "adminViews",
  "financeViews",
  "gmViews",
  "bankViews",
  "executiveViews",
  "auditLogs",
  "commissions",
  "payouts",
  "bankAnalyticsLeadStates",
  "bankRecentCases",
  "whatsappQueue",
  "notificationEvents",
]);

function automationRequestForLead(lead = {}) {
  const dealershipId = lead.dealershipId || lead.dealershipEmail || lead.dealerEmail || lead.createdBy || "system";
  return {
    user: { role: "finance-desk", email: "automation@carloansaathi.system", uid: "automation-engine", dealershipId },
    headers: {},
    ip: null,
    requestId: `automation-${lead.id}-${Date.now()}`,
  };
}

async function scanLeads(where = []) {
  const page = await queryRecords("leads", {
    where,
    orderBy: "updatedAt",
    direction: "asc",
    limit: AUTOMATION_SCAN_LIMIT,
    maxLimit: AUTOMATION_SCAN_LIMIT,
    allowGlobal: true,
  });
  return page.data || [];
}

async function scanDueLeads(deadlineField, now, where = []) {
  const deadline = now.toISOString();
  const page = await queryRecords("leads", {
    where: [...where, { field: deadlineField, op: "<=", value: deadline }],
    orderBy: deadlineField,
    direction: "asc",
    limit: AUTOMATION_SCAN_LIMIT,
    maxLimit: AUTOMATION_SCAN_LIMIT,
    allowGlobal: true,
  });
  return page.data || [];
}

export async function processAcceptanceSla(now = new Date()) {
  const due = await scanDueLeads("acceptanceDueAt", now, [
    { field: "assignmentStatus", value: "pending" },
  ]);
  let reassigned = 0;
  for (const lead of due) {
    if (lead.isDeadCase === true || lead.assignmentStatus !== "pending") continue;
    if ([LEAD_STATUSES.REJECTED, LEAD_STATUSES.DISBURSED, LEAD_STATUSES.CLOSED].includes(normalizeStatus(lead.status))) continue;
    const previousExecutiveId = lead.assignedExecutiveId || lead.assignedExecutiveEmail || null;
    try {
      const updated = await reassignLeadToNextBranchExecutive(
        lead.id,
        "acceptance-sla-expired",
        "automation-engine",
        { deferFollowUps: false },
      );
      await queueLeadAssignedWhatsApp(updated);
      reassigned += 1;
      if (previousExecutiveId) {
        await createNotification({
          type: "ASSIGNMENT_ACCEPTANCE_EXPIRED",
          title: "Lead reassigned",
          message: `Case ${lead.caseId || lead.id} was reassigned because it was not accepted within 5 hours.`,
          leadId: lead.id,
          recipientRole: "loan-executive",
          recipientId: previousExecutiveId,
          assignedExecutiveId: previousExecutiveId,
          priority: "high",
          entityType: "lead",
          entityId: lead.id,
          leadSnapshot: updated,
          meta: { dedupeKey: `acceptance-expired-${lead.acceptanceDueAt || lead.assignmentTimestamp}` },
        });
      }
    } catch (error) {
      logError("Acceptance SLA reassignment failed", { leadId: lead.id, error: error.message });
    }
  }
  return { checked: due.length, reassigned };
}

export async function backfillAutomationMetadata() {
  const leads = await scanLeads([]);
  let updated = 0;
  for (const lead of leads) {
    const patch = {};
    const assignmentAt = lead.assignmentTimestamp || lead.assignedAt || lead.reassignedAt || lead.updatedAt || lead.createdAt;
    if (lead.assignmentStatus === "pending" && !lead.acceptanceDueAt && assignmentAt) {
      patch.acceptanceDueAt = addMilliseconds(assignmentAt, AUTOMATION_POLICY.acceptanceSlaMs);
    }
    if (lead.assignmentStatus === "accepted" && !lead.acceptedAt) {
      patch.acceptedAt = lead.statusUpdatedAt || lead.updatedAt || assignmentAt || lead.createdAt;
    }
    if (!lead.lastWorkflowActionAt) {
      patch.lastWorkflowActionAt = lead.statusUpdatedAt || lead.updatedAt || patch.acceptedAt || assignmentAt || lead.createdAt;
    }
    if ([LEAD_STATUSES.REJECTED, LEAD_STATUSES.DISBURSED].includes(normalizeStatus(lead.status)) && !lead.terminalStatusAt) {
      const terminalAt = lead.statusUpdatedAt || lead.updatedAt || lead.createdAt;
      patch.terminalStatusAt = terminalAt;
      patch.terminalVisibleUntil = addMilliseconds(terminalAt, AUTOMATION_POLICY.terminalActiveMs);
      patch.workflowLocation = currentWorkflowLocation({ ...lead, terminalStatusAt: terminalAt });
      patch.retentionDueAt = addCalendarMonths(terminalAt);
    }
    if (lead.isDeadCase === true && !lead.retentionDueAt && lead.deadCaseDate) {
      patch.retentionDueAt = addCalendarMonths(lead.deadCaseDate);
    }
    if (!Object.keys(patch).length) continue;
    await updateRecord("leads", lead.id, patch, { mutationRole: "finance-desk" }).catch((error) => {
      logError("Automation metadata backfill failed", { leadId: lead.id, error: error.message });
    });
    updated += 1;
  }
  return { checked: leads.length, updated };
}

export async function processAcceptedLeadInactivity(now = new Date()) {
  const inactivityCutoff = new Date(now.getTime() - AUTOMATION_POLICY.inactivitySlaMs);
  const accepted = await scanDueLeads("lastWorkflowActionAt", inactivityCutoff, [
    { field: "assignmentStatus", value: "accepted" },
  ]);
  let movedToDead = 0;
  for (const lead of accepted) {
    if (lead.isDeadCase === true) continue;
    if ([LEAD_STATUSES.REJECTED, LEAD_STATUSES.DISBURSED, LEAD_STATUSES.CLOSED].includes(normalizeStatus(lead.status))) continue;
    const lastAction = new Date(lead.lastWorkflowActionAt || lead.statusUpdatedAt || lead.acceptedAt || 0).getTime();
    if (!lastAction || now.getTime() - lastAction < AUTOMATION_POLICY.inactivitySlaMs) continue;
    try {
      await moveLeadToDeadCase({
        req: automationRequestForLead(lead),
        leadId: lead.id,
        reason: "Customer Unreachable",
        notes: "Automatically moved after 7 calendar days without a status update following executive acceptance.",
      });
      movedToDead += 1;
    } catch (error) {
      logError("Accepted lead inactivity automation failed", { leadId: lead.id, error: error.message });
    }
  }
  return { checked: accepted.length, movedToDead };
}

export async function processTerminalLocations(now = new Date()) {
  const terminalLeads = await Promise.all([
    scanDueLeads("terminalVisibleUntil", now, [{ field: "status", value: LEAD_STATUSES.REJECTED }]),
    scanDueLeads("terminalVisibleUntil", now, [{ field: "status", value: LEAD_STATUSES.DISBURSED }]),
  ]).then((pages) => pages.flat());
  let moved = 0;
  for (const lead of terminalLeads) {
    if (lead.isDeadCase === true) continue;
    const location = currentWorkflowLocation(lead, now.getTime());
    if (location === "active" || lead.workflowLocation === location) continue;
    await updateRecord("leads", lead.id, { workflowLocation: location, terminalMovedAt: now.toISOString() }).catch((error) => {
      logError("Terminal location update failed", { leadId: lead.id, error: error.message });
    });
    moved += 1;
  }
  return { checked: terminalLeads.length, moved };
}

async function deleteLeadDocuments(leadId) {
  for (const collection of ["documents", "bankDocuments"]) {
    for (let pass = 0; pass < 20; pass += 1) {
      const page = await queryRecords(collection, {
        where: [{ field: "leadId", value: leadId }],
        limit: 250,
        maxLimit: 250,
      });
      if (!page.data?.length) break;
      for (const document of page.data) {
        const storagePath = document.storagePath || document.filePath;
        if (storagePath) await deleteLeadDocument(storagePath);
        await deleteRecord(collection, document.id);
      }
      if (page.data.length < 250) break;
    }
  }
}

export async function permanentlyDeleteLead(lead) {
  if (!lead?.id) return false;
  await updateRecord("leads", lead.id, {
    retentionDeletionStartedAt: new Date().toISOString(),
    retentionDeletionState: "in-progress",
  }, { mutationRole: "finance-desk" });
  await deleteLeadDocuments(lead.id);
  await removeLeadProjections(lead).catch(() => null);
  for (const collection of RELATED_LEAD_COLLECTIONS) {
    await deleteRecordsByQuery(collection, {
      where: [{ field: "leadId", value: lead.id }],
      limit: 500,
    }).catch(() => 0);
  }
  clearCachedTags(["lead:list", "admin:summary", "bank:summary", "bank:analytics", "notifications", `lead:${lead.id}`]);
  clearCachedValue(`lead:${lead.id}`);
  await deleteRecord("leads", lead.id);
  return true;
}

export async function processRetentionDeletion(now = new Date()) {
  const candidates = await scanDueLeads("retentionDueAt", now);
  let deleted = 0;
  for (const lead of candidates) {
    if (!retentionDue(lead, now.getTime())) continue;
    try {
      if (await permanentlyDeleteLead(lead)) deleted += 1;
    } catch (error) {
      logError("Lead retention deletion failed and will retry", { leadId: lead.id, error: error.message });
    }
  }
  return { checked: candidates.length, deleted };
}

export async function runEnterpriseAutomation(now = new Date()) {
  const backfill = await backfillAutomationMetadata();
  const [acceptance, inactivity, terminalLocations] = await Promise.all([
    processAcceptanceSla(now),
    processAcceptedLeadInactivity(now),
    processTerminalLocations(now),
  ]);
  // Retention runs after all lead mutations so a due lead cannot be updated while
  // its dependent records and canonical document are being removed.
  const retention = await processRetentionDeletion(now);
  const summary = { backfill, acceptance, inactivity, terminalLocations, retention, completedAt: new Date().toISOString() };
  logInfo("Enterprise automation completed", summary);
  return summary;
}
