import { bulkUpsertRecords, createRecord, getRecord, queryRecords, runRecordTransaction, updateRecord } from "./firestore.service.js";
import { buildWhatsAppMessage, queueWhatsAppNotification } from "./whatsapp.service.js";
import { paginationParams, pageResponse } from "../utils/pagination.js";
import { logError, logInfo } from "./logger.service.js";
import { GOVERNANCE_LIMITS } from "../config/governance.js";
import { DOMAIN_EVENTS, emitDomainEvent, onDomainEvent } from "./eventBus.service.js";
import { canonicalNotificationType, renderNotificationTemplate } from "./notificationTemplates.service.js";
import { writeAuditLog, AUDIT_ACTIONS } from "./audit.service.js";
import { addQueueJob, QUEUE_NAMES } from "./queue.service.js";
import { syncNotificationProjectionSoon } from "./projection.service.js";
import { markBufferedNotificationRead, publishRealtimeEvent, REALTIME_EVENTS } from "./realtime.service.js";
import { executiveIdentityValues, valuesMatch } from "./roleIdentity.service.js";
import { cached, clearCachedTags } from "./ttlCache.service.js";

const NOTIFICATION_LIST_CACHE_TTL_MS = Number(process.env.NOTIFICATION_LIST_CACHE_TTL_MS || 5000);
const NOTIFICATION_MARK_ALL_LIMIT = Number(process.env.NOTIFICATION_MARK_ALL_LIMIT || 100);

function safeNotificationId(...parts) {
  const key = parts.map((part) => String(part || "").trim().toLowerCase()).join("|");
  return `notification_${Buffer.from(key).toString("base64url").slice(0, 180)}`;
}

function notificationDedupeId({ eventId, type, entityType, entityId, caseId, eventVersion, meta = {} } = {}) {
  return safeNotificationId(
    eventId || meta.eventId || meta.notificationId || "",
    canonicalNotificationType(type),
    entityType || "",
    entityId || "",
    caseId || "",
    eventVersion || "",
    meta.status || meta.action || "",
    meta.documentId || meta.documentType || "",
  );
}

function notificationEventVersion({ lead = {}, meta = {}, requestId = null } = {}) {
  return meta.eventVersion
    || meta.statusUpdatedAt
    || lead.statusUpdatedAt
    || lead.acceptedAt
    || lead.documentsRequestedAt
    || lead.documentsUploadedAt
    || lead.deadCaseDate
    || lead.deadCaseRestoredAt
    || lead.reassignedAt
    || lead.assignmentTimestamp
    || lead.assignedAt
    || lead.updatedAt
    || meta.documentId
    || meta.status
    || meta.action
    || meta.reason
    || requestId
    || "initial";
}

function actorId(actor = {}) {
  return actor.email || actor.uid || "";
}

function actorScopeWhere(actor = {}, { unreadOnly = false, type = "" } = {}) {
  const role = actor.role;
  const id = actorId(actor);
  const where = [];
  if (role !== "super-admin") {
    if (["finance-desk", "gm"].includes(role) && actor.dealershipId) where.push({ field: "dealershipId", value: actor.dealershipId });
    else if (role === "bank-manager" && actor.bankId) where.push({ field: "bankId", value: actor.bankId });
    else where.push({ field: "recipientId", value: id });
  }
  if (type) where.push({ field: "type", value: type });
  if (unreadOnly) where.push({ field: "read", value: false });
  return where;
}

function notificationCacheTags(notification = {}) {
  return [
    "notifications",
    notification.recipientId ? `notifications:user:${notification.recipientId}` : null,
    notification.userId ? `notifications:user:${notification.userId}` : null,
    notification.dealerEmail ? `notifications:user:${notification.dealerEmail}` : null,
    notification.partnerId ? `notifications:user:${notification.partnerId}` : null,
    notification.dealershipId ? `notifications:dealership:${notification.dealershipId}` : null,
    notification.bankId ? `notifications:bank:${notification.bankId}` : null,
    notification.assignedExecutiveId ? `notifications:executive:${notification.assignedExecutiveId}` : null,
  ].filter(Boolean);
}

function notificationActorTags(actor = {}) {
  return [
    "notifications",
    actor.email || actor.uid ? `notifications:user:${actor.email || actor.uid}` : null,
    actor.dealershipId ? `notifications:dealership:${actor.dealershipId}` : null,
    actor.bankId ? `notifications:bank:${actor.bankId}` : null,
    actor.executiveId ? `notifications:executive:${actor.executiveId}` : null,
  ].filter(Boolean);
}

function notificationListCacheKey({ query = {}, actor = {} } = {}) {
  const key = {
    limit: query.limit || "",
    cursor: query.cursor || "",
    search: query.search || "",
    type: query.type || "",
    unread: query.unread || "",
    role: actor.role || "",
    id: actor.email || actor.uid || "",
    dealershipId: actor.dealershipId || "",
    bankId: actor.bankId || "",
    executiveId: actor.executiveId || "",
  };
  return `notifications:list:${Buffer.from(JSON.stringify(key)).toString("base64url").slice(0, 220)}`;
}

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
  recipientEmail,
  phoneNumber,
  priority = "normal",
  userId,
  dealershipId,
  bankId,
  assignedExecutiveId,
  entityType = leadId ? "lead" : "system",
  entityId,
  caseId: inputCaseId,
  actionUrl,
  metadata = {},
  createdBy = "system",
  deliveryChannels = ["in-app"],
  source = "api",
  requestId = null,
  eventId = null,
  leadSnapshot = null,
}) {
  const lead = leadSnapshot || null;
  const mergedMeta = { ...metadata, ...meta };
  const caseId = lead?.caseId || mergedMeta.caseId || inputCaseId || null;
  const targetUserId = userId || recipientId || recipientEmail || partnerId || dealerEmail || null;
  const targetEmail = recipientEmail || (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(targetUserId || "")) ? targetUserId : "");
  const resolvedEntityId = entityId || leadId || caseId || null;
  const rendered = renderNotificationTemplate(type, { ...mergedMeta, title, message, caseId });
  const normalizedPriority = GOVERNANCE_LIMITS.notifications.priorities.includes(priority) ? priority : rendered.priority;
  const eventVersion = notificationEventVersion({ lead: lead || {}, meta: mergedMeta, requestId });
  const resolvedEventId = eventId || mergedMeta.eventId || safeNotificationId(
    "business-event",
    canonicalNotificationType(type),
    entityType,
    resolvedEntityId,
    caseId,
    eventVersion,
  );
  const notificationId = notificationDedupeId({
    eventId: resolvedEventId,
    type,
    entityType,
    entityId: resolvedEntityId,
    caseId,
    eventVersion,
    meta: mergedMeta,
  });
  const now = new Date().toISOString();
  const notificationPayload = {
    id: notificationId,
    eventId: resolvedEventId,
    eventVersion,
    recipientId: targetUserId,
    recipientEmail: targetEmail || targetUserId,
    userId: targetUserId,
    role: recipientRole || (admin ? "super-admin" : null),
    notificationType: type,
    type,
    title: rendered.title,
    message: rendered.message,
    entityType,
    entityId: resolvedEntityId,
    leadId,
    caseId,
    partnerId,
    dealerEmail,
    dealershipId: dealershipId || lead?.dealershipId || mergedMeta.dealershipId || null,
    bankId: bankId || lead?.bankId || mergedMeta.bankId || null,
    assignedExecutiveId: assignedExecutiveId || lead?.assignedExecutiveId || mergedMeta.assignedExecutiveId || null,
    admin,
    recipientRole,
    priority: normalizedPriority,
    read: false,
    deliveryStatus: "queued",
    retryCount: 0,
    maxRetries: GOVERNANCE_LIMITS.notifications.maxRetryCount,
    source,
    requestId,
    createdBy,
    createdAt: now,
    actionUrl: actionUrl || mergedMeta.actionUrl || "",
    expiresAt: new Date(Date.now() + GOVERNANCE_LIMITS.notifications.ttlDays * 24 * 60 * 60 * 1000).toISOString(),
    meta: mergedMeta,
    metadata: mergedMeta,
    leadSnapshot: {
      leadId: leadId || null,
      caseId,
      customerName: mergedMeta.customerName || lead?.fullName || lead?.customerName || null,
      assignedUser: mergedMeta.assignedUser || mergedMeta.executiveName || lead?.assignedExecutiveName || lead?.assignedExecutiveEmail || null,
      status: mergedMeta.status || lead?.status || null,
    },
  };
  const creation = await runRecordTransaction(async (transaction) => {
    const existing = await transaction.get("notifications", notificationId);
    if (existing) return { created: false, notification: existing };
    await transaction.set("notifications", notificationId, notificationPayload, { merge: false });
    return { created: true, notification: notificationPayload };
  });
  if (!creation.created) {
    logInfo("Notification deduplicated", { notificationId, eventId: resolvedEventId, type, recipientRole, recipientId: targetUserId, caseId });
    return creation.notification;
  }
  const notification = creation.notification;
  clearCachedTags([...notificationCacheTags(notification), "dashboard:fast"]);
  syncNotificationProjectionSoon(notification);
  publishRealtimeEvent({
    eventType: REALTIME_EVENTS.NOTIFICATION_CREATED,
    notification,
    lead: lead || null,
    data: {
      leadId,
      caseId,
      dealershipId: notification.dealershipId,
      bankId: notification.bankId,
      executiveId: notification.assignedExecutiveId,
      recipientId: targetUserId,
    },
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

  if (deliveryChannels.includes("whatsapp")) {
    const whatsappMessage = rendered.message || buildWhatsAppMessage(type, { ...mergedMeta, leadId: caseId || leadId, caseId });
    Promise.resolve().then(() => queueWhatsAppNotification({
      type,
      recipientRole: recipientRole || (admin ? "super-admin" : partnerId ? "loan-executive" : dealerEmail ? "finance-desk" : "system"),
      recipientId: recipientId || partnerId || dealerEmail || "admin",
      phoneNumber: phoneNumber || mergedMeta.phoneNumber || mergedMeta.mobile,
      message: whatsappMessage,
      leadId,
      priority: normalizedPriority,
      metadata: { notificationId: notification.id, caseId, ...mergedMeta },
    })).catch((error) => logError("Notification delivery queue failed", { notificationId: notification.id, error: error.message }));
  }

  Promise.resolve().then(() => writeAuditLog({
    actionType: AUDIT_ACTIONS.NOTIFICATION_CREATED,
    actorId: "system",
    actorRole: "system",
    leadId,
    meta: { notificationId: notification.id, type, caseId, requestId },
  })).catch((error) => logError("Notification audit failed", { notificationId: notification.id, error: error.message }));

  logInfo("Notification created", { notificationId: notification.id, eventId: resolvedEventId, type, recipientRole: notification.recipientRole, recipientId: notification.recipientId, caseId });
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
  return cached(notificationListCacheKey({ query, actor }), NOTIFICATION_LIST_CACHE_TTL_MS, async () => {
    const { limit, cursor } = paginationParams(query);
    const search = String(query.search || "").trim().toLowerCase();
    const type = String(query.type || "").trim();
    const unreadOnly = query.unread === "true";
    const where = actorScopeWhere(actor, { unreadOnly, type });

    const result = await queryRecords("notifications", {
      where,
      orderBy: "createdAt",
      direction: "desc",
      limit,
      cursor,
      search,
      searchFields: ["title", "message", "caseId", "leadId"],
    });

    const items = result.data.filter((item) => {
      const allowed = canAccessNotification(item, actor);
      return allowed;
    });

    const unread = await getUnreadNotificationCount(actor);
    return pageResponse({ data: items, limit, nextCursor: result.nextCursor, extra: { unread } });
  }, { tags: notificationActorTags(actor) });
}

function canAccessNotification(item, actor = {}) {
  const actorId = actor.email || actor.uid;
  if (actor.role === "super-admin") return true;
  if (item.recipientId === actorId || item.recipientEmail === actorId || item.userId === actorId || item.dealerEmail === actorId || item.partnerId === actorId) return true;
  if (["finance-desk", "gm"].includes(actor.role)) {
    return Boolean(actor.dealershipId && item.dealershipId === actor.dealershipId);
  }
  if (actor.role === "bank-manager") {
    return Boolean(actor.bankId && item.bankId === actor.bankId);
  }
  if (actor.role === "loan-executive") {
    return valuesMatch(
      [
        item.assignedExecutiveId,
        item.assignedExecutiveEmail,
        item.recipientId,
        item.meta?.assignedExecutiveId,
        item.meta?.assignedExecutiveEmail,
        item.meta?.assignedExecutiveMobile,
      ],
      executiveIdentityValues(actor),
    );
  }
  const expectedRole = item.recipientRole || item.role || "";
  if (expectedRole && expectedRole !== actor.role) return false;
  return false;
}

export async function getUnreadNotificationCount(actor = {}) {
  const where = actorScopeWhere(actor, { unreadOnly: true });
  const result = await queryRecords("notifications", {
    where,
    orderBy: "createdAt",
    direction: "desc",
    limit: NOTIFICATION_MARK_ALL_LIMIT,
    maxLimit: NOTIFICATION_MARK_ALL_LIMIT,
    fields: ["recipientRole", "role", "recipientId", "recipientEmail", "userId", "dealerEmail", "partnerId", "dealershipId", "bankId", "assignedExecutiveId", "assignedExecutiveEmail", "meta", "read"],
  });
  return result.data.filter((item) => item.read === false && canAccessNotification(item, actor)).length;
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
  const readAt = new Date().toISOString();
  const updated = await updateRecord("notifications", id, { read: true, readAt });
  clearCachedTags([...notificationCacheTags({ ...item, ...updated }), "dashboard:fast"]);
  syncNotificationProjectionSoon(updated);
  markBufferedNotificationRead(id, readAt);
  publishRealtimeEvent({
    eventType: REALTIME_EVENTS.NOTIFICATION_READ,
    notification: updated,
    data: {
      recipientId: updated.recipientId || actor.email || actor.uid || "",
      dealershipId: updated.dealershipId || "",
      bankId: updated.bankId || "",
      executiveId: updated.assignedExecutiveId || "",
    },
  });
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
  logInfo("Notification read", { notificationId: id, recipientId: updated.recipientId, role: actor.role });
  return updated;
}

export async function markAllNotificationsRead(actor = {}) {
  const where = actorScopeWhere(actor, { unreadOnly: true });
  const result = await queryRecords("notifications", {
    where,
    orderBy: "createdAt",
    direction: "desc",
    limit: NOTIFICATION_MARK_ALL_LIMIT,
    maxLimit: NOTIFICATION_MARK_ALL_LIMIT,
  });
  const visibleUnread = result.data.filter((item) => item.read === false && canAccessNotification(item, actor));
  const readAt = new Date().toISOString();
  const updatedItems = visibleUnread.map((item) => ({ ...item, read: true, readAt, updatedAt: readAt }));
  await bulkUpsertRecords("notifications", updatedItems);
  updatedItems.forEach((item) => syncNotificationProjectionSoon(item));
  markBufferedNotificationRead(updatedItems.map((item) => item.id), readAt);
  clearCachedTags(["notifications", ...notificationActorTags(actor), "dashboard:fast"]);
  await Promise.all(updatedItems.map((item) => createRecord("notificationLogs", {
    notificationId: item.id,
    userId: actor.email || actor.uid,
    role: actor.role,
    type: item.type,
    leadId: item.leadId || null,
    caseId: item.caseId || null,
    dealershipId: item.dealershipId || null,
    bankId: item.bankId || null,
    assignedExecutiveId: item.assignedExecutiveId || null,
    status: "read-all",
  })));
  const sample = updatedItems[0] || {};
  publishRealtimeEvent({
    eventType: REALTIME_EVENTS.NOTIFICATION_MARK_ALL_READ,
    notification: {
      id: `mark-all-${Date.now()}`,
      recipientRole: actor.role,
      recipientId: actor.email || actor.uid || sample.recipientId || "",
      recipientEmail: actor.email || sample.recipientEmail || "",
      dealershipId: actor.dealershipId || sample.dealershipId || "",
      bankId: actor.bankId || sample.bankId || "",
      assignedExecutiveId: actor.executiveId || sample.assignedExecutiveId || "",
      read: true,
      title: "Notifications read",
      message: "All notifications marked read.",
      priority: "low",
      type: "NOTIFICATION_MARK_ALL_READ",
      createdAt: readAt,
      updatedAt: readAt,
    },
    data: {
      recipientId: actor.email || actor.uid || "",
      dealershipId: actor.dealershipId || sample.dealershipId || "",
      bankId: actor.bankId || sample.bankId || "",
      executiveId: actor.executiveId || sample.assignedExecutiveId || "",
      unread: 0,
      updated: updatedItems.length,
    },
  });
  logInfo("Notifications marked all read", { count: updatedItems.length, actorId: actor.email || actor.uid, role: actor.role });
  return { updated: updatedItems.length, unread: 0 };
}
