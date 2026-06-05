import { createRecord, queryRecords, updateRecord } from "./firestore.service.js";
import { createNotification } from "./notification.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "./timeline.service.js";
import { getWorkflowSettings } from "./settings.service.js";
import { GOVERNANCE_LIMITS, SLA_STAGES } from "../config/governance.js";
import { queueAuditLog, AUDIT_ACTIONS } from "./audit.service.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";

export const slaStatuses = [
  "pending",
  "accepted",
  "in-progress",
  "document-requested",
  "approved",
  "rejected",
  "expired",
];

export async function createSlaLog({ lead, assignment, status = "pending" }) {
  const settings = await getWorkflowSettings();
  const assignedAt = assignment.assignmentTimestamp || new Date().toISOString();
  const expiresAt = new Date(new Date(assignedAt).getTime() + Number(settings.slaAcceptMinutes) * 60 * 1000).toISOString();

  return createRecord("slaLogs", {
    leadId: lead.id,
    assignmentId: assignment.id,
    partnerId: assignment.partnerId,
    partnerName: assignment.partnerName,
    status,
    assignedAt,
    expiresAt,
    responseTimeMinutes: null,
    processingTimeMinutes: null,
    approvalRatio: null,
    rejectionRatio: null,
    slaScore: null,
  });
}

export async function updateSlaForLead(lead, status) {
  const logs = await queryRecords("slaLogs", {
    where: [{ field: "leadId", value: lead.id }],
    orderBy: "leadId",
    direction: "asc",
    limit: 10,
    maxLimit: 10,
  }).catch(() => ({ data: [] }));
  const log = logs.data.find((item) => item.status !== "expired");
  if (!log) return null;

  const now = new Date();
  const assignedAt = new Date(log.assignedAt || log.createdAt);
  const acceptedAt = log.acceptedAt ? new Date(log.acceptedAt) : null;
  const nextStatus = mapLeadStatusToSla(status);
  const responseTimeMinutes = acceptedAt
    ? log.responseTimeMinutes
    : ["accepted", "in-progress", "approved", "rejected"].includes(nextStatus)
      ? Math.round((now - assignedAt) / 60000)
      : log.responseTimeMinutes;
  const processingTimeMinutes = ["approved", "rejected"].includes(nextStatus)
    ? Math.round((now - (acceptedAt || assignedAt)) / 60000)
    : log.processingTimeMinutes;

  return updateRecord("slaLogs", log.id, {
    status: nextStatus,
    acceptedAt: acceptedAt?.toISOString() || (responseTimeMinutes !== null ? now.toISOString() : log.acceptedAt),
    completedAt: ["approved", "rejected"].includes(nextStatus) ? now.toISOString() : log.completedAt,
    responseTimeMinutes,
    processingTimeMinutes,
    slaScore: calculateSlaScore({ responseTimeMinutes, processingTimeMinutes, status: nextStatus }),
  });
}

export function mapLeadStatusToSla(status) {
  const normalized = normalizeStatus(status);
  if (normalized === LEAD_STATUSES.CONTACTED || normalized === LEAD_STATUSES.ACCEPTED) return "accepted";
  if (normalized === LEAD_STATUSES.UNDER_BANK_PROCESS || normalized === LEAD_STATUSES.UNDER_REVIEW) return "in-progress";
  if ([LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.DOCUMENT_RECEIVED, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING].includes(normalized)) return "document-requested";
  if (normalized === LEAD_STATUSES.ALL_DOCUMENTS_RECEIVED) return "in-progress";
  if (normalized === LEAD_STATUSES.APPROVED || normalized === LEAD_STATUSES.DISBURSED) return "approved";
  if (normalized === LEAD_STATUSES.REJECTED) return "rejected";
  return "pending";
}

export function calculateSlaScore({ responseTimeMinutes, processingTimeMinutes, status }) {
  let score = 100;
  if (responseTimeMinutes && responseTimeMinutes > 30) score -= 25;
  if (processingTimeMinutes && processingTimeMinutes > 240) score -= 15;
  if (status === "rejected") score -= 10;
  if (status === "expired") score -= 40;
  return Math.max(score, 0);
}

export function evaluateSlaState({ startedAt, targetMinutes }) {
  if (!startedAt || !targetMinutes) return "healthy";
  const elapsedMinutes = Math.max(Math.round((Date.now() - new Date(startedAt).getTime()) / 60000), 0);
  const ratio = elapsedMinutes / Number(targetMinutes);
  if (ratio >= GOVERNANCE_LIMITS.sla.breachRatio) return "breached";
  if (ratio >= GOVERNANCE_LIMITS.sla.warningRatio) return "warning";
  return "healthy";
}

export async function upsertSlaMetric({ lead, stageKey, startedAt, completedAt = null, owner = {} }) {
  const stage = Object.values(SLA_STAGES).find((item) => item.key === stageKey) || SLA_STAGES.BANK_PROCESSING;
  const status = completedAt ? "completed" : evaluateSlaState({ startedAt, targetMinutes: stage.targetMinutes });
  const elapsedMinutes = startedAt ? Math.max(Math.round(((completedAt ? new Date(completedAt).getTime() : Date.now()) - new Date(startedAt).getTime()) / 60000), 0) : 0;
  const metric = await createRecord("slaMetrics", {
    leadId: lead.id,
    caseId: lead.caseId || null,
    stage: stage.key,
    targetMinutes: stage.targetMinutes,
    elapsedMinutes,
    status,
    dealershipId: lead.dealershipId || null,
    bankId: lead.bankId || null,
    assignedExecutiveId: lead.assignedExecutiveId || null,
    ownerRole: owner.role || null,
    ownerId: owner.id || owner.email || null,
    startedAt,
    completedAt,
  });
  if (status === "warning" || status === "breached") {
    queueAuditLog({
      actionType: status === "breached" ? AUDIT_ACTIONS.SLA_BREACHED : AUDIT_ACTIONS.SLA_WARNING,
      leadId: lead.id,
      meta: { caseId: lead.caseId, stage: stage.key, status },
    });
  }
  return metric;
}

export async function expireAssignment({ lead, assignment, reason }) {
  await updateRecord("leadAssignments", assignment.id, {
    status: "expired",
    expiredAt: new Date().toISOString(),
    reason,
  });
  const logs = await queryRecords("slaLogs", {
    where: [{ field: "assignmentId", value: assignment.id }],
    orderBy: "assignmentId",
    direction: "asc",
    limit: 5,
    maxLimit: 5,
  }).catch(() => ({ data: [] }));
  const log = logs.data[0];
  if (log) await updateRecord("slaLogs", log.id, { status: "expired", expiredAt: new Date().toISOString(), slaScore: 0 });
  await addTimelineEvent({
    leadId: lead.id,
    eventType: TIMELINE_EVENTS.SLA_MISSED,
    title: "SLA Missed",
    description: `Assignment expired: ${reason}`,
    actorName: "SLA Engine",
    actorRole: "system",
    metadata: { assignmentId: assignment.id, partnerId: assignment.partnerId, executiveId: assignment.executiveId, reason },
  });
  await addTimelineEvent({
    leadId: lead.id,
    eventType: TIMELINE_EVENTS.ESCALATION_TRIGGERED,
    title: "Escalation Triggered",
    description: "SLA breach notification sent to operations",
    actorName: "SLA Engine",
    actorRole: "system",
    metadata: { assignmentId: assignment.id, reason },
  });
  await createNotification({
    type: "sla-breach",
    title: "SLA breached",
    message: `Lead ${lead.caseId || lead.id} assignment expired: ${reason}`,
    leadId: lead.id,
    partnerId: assignment.partnerId,
    admin: true,
    recipientRole: "bank-manager",
    recipientId: assignment.partnerId,
    priority: "high",
    meta: {
      leadId: lead.id,
      executiveName: assignment.executiveName,
      reason,
    },
  });
}
