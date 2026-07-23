import { ensureCommissionForLead } from "./commission.service.js";
import { createNotification } from "./notification.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "./timeline.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "./audit.service.js";
import { ANALYTICS_EVENTS, queueSafeAnalyticsEvent } from "./analyticsEngine.service.js";
import { queueDocumentsRequiredWhatsApp, queueStatusUpdatedWhatsApp } from "./whatsapp.service.js";
import { STATUS_LABELS, LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";
import { logError } from "./logger.service.js";

const PENDING_DOCUMENT_STATUSES = [LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING];

export async function runLeadStatusTransitionSideEffects({ req, existing, lead, nextStatus, actor = {}, pendingDocument = "", requestedDocuments = [], pendingDocumentReason = "", pendingDocumentDescription = "", notification = {} } = {}) {
  const status = normalizeStatus(nextStatus);
  const statusLabel = STATUS_LABELS[status] || status;
  const processingTimeMinutes = existing?.createdAt ? Math.max(Math.round((Date.now() - new Date(existing.createdAt).getTime()) / 60000), 0) : 0;
  const actorName = actor.email || actor.name || actor.fullName || req?.user?.email || "system";
  const actorRole = req?.user?.role || "system";
  const leadId = lead?.id || req?.params?.id;
  const caseId = lead?.caseId || leadId;
  const isPendingDocuments = PENDING_DOCUMENT_STATUSES.includes(status);

  queueSafeAnalyticsEvent(ANALYTICS_EVENTS.STATUS_CHANGED, { lead, previousStatus: existing?.status, nextStatus: status, processingTimeMinutes });
  const tasks = [
    () => ensureCommissionForLead(lead, status),
    () => addTimelineEvent({
      leadId,
      eventType: status === LEAD_STATUSES.APPROVED ? TIMELINE_EVENTS.APPROVAL : status === LEAD_STATUSES.REJECTED ? TIMELINE_EVENTS.REJECTION : status === LEAD_STATUSES.DISBURSED ? TIMELINE_EVENTS.DISBURSEMENT_MARKED : isPendingDocuments ? TIMELINE_EVENTS.PENDING_DOCUMENTS_REQUESTED : TIMELINE_EVENTS.STATUS_CHANGED,
      title: `Status: ${statusLabel}`,
      description: pendingDocumentDescription || `Lead status updated to ${statusLabel}`,
      actorName,
      actorRole,
      branchId: actor.branchId || null,
      metadata: { oldStatus: existing?.status, nextStatus: status, status, customerName: lead?.fullName || lead?.customerName, pendingDocument, pendingDocuments: requestedDocuments, pendingDocumentReason },
      leadSnapshot: lead,
    }),
    () => createNotification({
      type: notification.type || (status === LEAD_STATUSES.REJECTED ? "rejection" : status === LEAD_STATUSES.APPROVED ? "approval" : "status-update"),
      title: notification.title || `Lead ${statusLabel}`,
      message: notification.message || `Lead ${caseId} status updated to ${statusLabel}`,
      leadId,
      dealerEmail: notification.dealerEmail || lead?.dealerEmail || lead?.dealershipId,
      recipientRole: notification.recipientRole,
      recipientId: notification.recipientId,
      partnerId: notification.partnerId,
      admin: notification.admin,
      priority: notification.priority || "medium",
      entityType: "lead",
      entityId: leadId,
      dealershipId: notification.dealershipId || lead?.dealershipId || lead?.dealershipEmail,
      bankId: notification.bankId || lead?.bankId || lead?.assignedBankId,
      assignedExecutiveId: notification.assignedExecutiveId || lead?.assignedExecutiveId,
      actionUrl: notification.actionUrl,
      leadSnapshot: lead,
      meta: { caseId, status, statusLabel, eventVersion: lead?.statusUpdatedAt || lead?.updatedAt, ...notification.meta },
    }),
    () => writeAuditLog({
      req,
      actionType: status === LEAD_STATUSES.DISBURSED ? AUDIT_ACTIONS.DISBURSED : status === LEAD_STATUSES.REJECTED ? AUDIT_ACTIONS.REJECTED : isPendingDocuments ? AUDIT_ACTIONS.PENDING_DOCUMENT_REQUESTED : AUDIT_ACTIONS.STATUS_UPDATED,
      oldValue: existing?.status,
      newValue: status,
      leadId,
      meta: { caseId, oldStatus: existing?.status, newStatus: status, dealershipId: lead?.dealershipId, bankId: lead?.bankId, pendingDocuments: requestedDocuments, pendingDocumentReason },
    }),
    () => isPendingDocuments ? queueDocumentsRequiredWhatsApp({ lead, documents: requestedDocuments }) : queueStatusUpdatedWhatsApp({ lead, statusLabel }),
  ];
  const results = await Promise.allSettled(tasks.map((task) => task()));
  results.filter((result) => result.status === "rejected").forEach((result) => logError("Lead status side effect failed", { error: result.reason?.message || String(result.reason), leadId, status }));
  return { status, results };
}
