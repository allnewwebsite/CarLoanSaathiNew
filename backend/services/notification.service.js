import { createRecord, getRecord, queryRecords, updateRecord } from "./firestore.service.js";
import { buildWhatsAppMessage, queueWhatsAppNotification } from "./whatsapp.service.js";
import { paginationParams, pageResponse } from "../utils/pagination.js";
import { logError } from "./logger.service.js";
import { GOVERNANCE_LIMITS } from "../config/governance.js";
import { DOMAIN_EVENTS, emitDomainEvent, onDomainEvent } from "./eventBus.service.js";
import { renderNotificationTemplate } from "./notificationTemplates.service.js";
import { writeAuditLog, AUDIT_ACTIONS } from "./audit.service.js";
import { addQueueJob, QUEUE_NAMES } from "./queue.service.js";

export async function createNotification({
  type,
  title,
  message,
  leadId,
  partnerId,
  dealerEmail,
  admin = false,
  meta = {},
  recipientRole,
  recipientId,
  phoneNumber,
  priority = "normal",
  userId,
  dealershipId,
  bankId,
  assignedExecutiveId,
  entityType = leadId ? "lead" : "system",
  entityId,
  source = "api",
  requestId = null,
}) {
  const lead = leadId ? await getRecord("leads", leadId) : null;
  const caseId = lead?.caseId || meta.caseId || null;
  const targetUserId = userId || recipientId || partnerId || dealerEmail || null;
  const rendered = renderNotificationTemplate(type, { ...meta, title, message, caseId });
  const normalizedPriority = GOVERNANCE_LIMITS.notifications.priorities.includes(priority) ? priority : rendered.priority;
  const notification = await createRecord("notifications", {
    recipientId: targetUserId,
    userId: targetUserId,
    role: recipientRole || (admin ? "super-admin" : null),
    notificationType: type,
    type,
    title: rendered.title,
    message: rendered.message,
    entityType,
    entityId: entityId || leadId || caseId || null,
    leadId,
    caseId,
    partnerId,
    dealerEmail,
    dealershipId: dealershipId || lead?.dealershipId || meta.dealershipId || null,
    bankId: bankId || lead?.bankId || meta.bankId || null,
    assignedExecutiveId: assignedExecutiveId || lead?.assignedExecutiveId || meta.assignedExecutiveId || null,
    admin,
    recipientRole,
    priority: normalizedPriority,
    read: false,
    deliveryStatus: "queued",
    retryCount: 0,
    maxRetries: GOVERNANCE_LIMITS.notifications.maxRetryCount,
    source,
    requestId,
    expiresAt: new Date(Date.now() + GOVERNANCE_LIMITS.notifications.ttlDays * 24 * 60 * 60 * 1000).toISOString(),
    meta,
  });
  await createRecord("notificationLogs", {
    notificationId: notification.id,
    userId: targetUserId,
    role: recipientRole || (admin ? "super-admin" : null),
    type,
    leadId,
    caseId,
    dealershipId: notification.dealershipId,
    bankId: notification.bankId,
    assignedExecutiveId: notification.assignedExecutiveId,
    status: "queued",
    requestId,
  });

  const whatsappMessage = rendered.message || buildWhatsAppMessage(type, { ...meta, leadId: caseId || leadId, caseId });
  Promise.resolve().then(() => queueWhatsAppNotification({
    type,
    recipientRole: recipientRole || (admin ? "super-admin" : partnerId ? "loan-executive" : dealerEmail ? "finance-desk" : "system"),
    recipientId: recipientId || partnerId || dealerEmail || "admin",
    phoneNumber: phoneNumber || meta.phoneNumber || meta.mobile,
    message: whatsappMessage,
    leadId,
    priority: normalizedPriority,
    metadata: { notificationId: notification.id, caseId, ...meta },
  })).catch((error) => logError("Notification delivery queue failed", { notificationId: notification.id, error: error.message }));

  Promise.resolve().then(() => writeAuditLog({
    actionType: AUDIT_ACTIONS.NOTIFICATION_CREATED,
    actorId: "system",
    actorRole: "system",
    leadId,
    meta: { notificationId: notification.id, type, caseId, requestId },
  })).catch((error) => logError("Notification audit failed", { notificationId: notification.id, error: error.message }));

  return notification;
}

export function emitNotificationEvent(event) {
  return addQueueJob(QUEUE_NAMES.NOTIFICATIONS, event?.type || "notification", event, {
    priority: event?.priority || "medium",
    fallback: (payload) => emitDomainEvent(DOMAIN_EVENTS.NOTIFICATION_REQUESTED, payload),
  });
}

onDomainEvent(DOMAIN_EVENTS.NOTIFICATION_REQUESTED, async ({ payload }) => {
  await createNotification({ ...payload, source: payload.source || "event" });
});

export async function getNotifications({ query = {}, actor = {} } = {}) {
  const { limit, cursor } = paginationParams(query);
  const role = actor.role;
  const id = actor.email || actor.uid;
  const search = String(query.search || "").trim().toLowerCase();
  const type = String(query.type || "").trim();
  const unreadOnly = query.unread === "true";
  const where = [];
  if (role !== "super-admin") {
    if (["finance-desk", "gm-sm"].includes(role) && actor.dealershipId) where.push({ field: "dealershipId", value: actor.dealershipId });
    else if (role === "bank-manager" && actor.bankId) where.push({ field: "bankId", value: actor.bankId });
    else where.push({ field: "recipientId", value: id });
  }
  if (type) where.push({ field: "type", value: type });

  const result = await queryRecords("notifications", {
    where,
    orderBy: "createdAt",
    direction: "desc",
    limit,
    cursor,
    search,
    searchFields: ["title", "message", "caseId", "leadId"],
  });

  let items = result.data.filter((item) => {
    const allowed = canAccessNotification(item, actor);
    const unreadOk = !unreadOnly || item.read === false;
    return allowed && unreadOk;
  });

  return pageResponse({ data: items, limit, nextCursor: result.nextCursor, extra: { unread: items.filter((item) => !item.read).length } });
}

function canAccessNotification(item, actor = {}) {
  const actorId = actor.email || actor.uid;
  if (actor.role === "super-admin") return true;
  if (item.recipientId === actorId || item.userId === actorId || item.dealerEmail === actorId || item.partnerId === actorId) return true;
  if (["finance-desk", "gm-sm"].includes(actor.role)) {
    return Boolean(actor.dealershipId && item.dealershipId === actor.dealershipId);
  }
  if (actor.role === "bank-manager") {
    return Boolean(actor.bankId && item.bankId === actor.bankId);
  }
  if (actor.role === "loan-executive") {
    return item.assignedExecutiveId === actor.uid || item.assignedExecutiveId === actor.email;
  }
  return false;
}

export async function markNotificationRead(id, actor = {}) {
  const item = await getRecord("notifications", id);
  if (!item) {
    const error = new Error("Notification not found");
    error.status = 404;
    throw error;
  }
  if (!canAccessNotification(item, actor)) {
    const error = new Error("Notification access denied");
    error.status = 403;
    throw error;
  }
  const updated = await updateRecord("notifications", id, { read: true, readAt: new Date().toISOString() });
  await createRecord("notificationLogs", {
    notificationId: id,
    userId: actor.email || actor.uid,
    role: actor.role,
    type: item.type,
    leadId: item.leadId || null,
    caseId: item.caseId || null,
    dealershipId: item.dealershipId || null,
    bankId: item.bankId || null,
    assignedExecutiveId: item.assignedExecutiveId || null,
    status: "read",
  });
  return updated;
}
