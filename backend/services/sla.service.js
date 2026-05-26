import { createRecord, listRecords, updateRecord } from "./firestore.service.js";
import { createNotification } from "./notification.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "./timeline.service.js";
import { getWorkflowSettings } from "./settings.service.js";
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
  const logs = await listRecords("slaLogs");
  const log = logs.find((item) => item.leadId === lead.id && item.status !== "expired");
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
  if (normalized === LEAD_STATUSES.ACCEPTED) return "accepted";
  if (normalized === LEAD_STATUSES.UNDER_REVIEW) return "in-progress";
  if (normalized === LEAD_STATUSES.DOCS_PENDING) return "document-requested";
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

export async function expireAssignment({ lead, assignment, reason }) {
  await updateRecord("leadAssignments", assignment.id, {
    status: "expired",
    expiredAt: new Date().toISOString(),
    reason,
  });
  const logs = await listRecords("slaLogs");
  const log = logs.find((item) => item.assignmentId === assignment.id);
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
