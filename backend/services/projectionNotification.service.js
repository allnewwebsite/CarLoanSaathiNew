import { queryRecords, upsertRecord } from "./firestore.service.js";
import { pageResponse, paginationParams } from "../utils/pagination.js";
import { freshProjectionRows } from "./projectionFreshness.service.js";
import {
  PROJECTION_META_FIELDS,
  safeDocId,
  scopeId,
  withProjectionMetadata,
} from "./projectionShared.service.js";

function notificationTargets(notification = {}) {
  const recipientRole = scopeId(notification.recipientRole || notification.role || "");
  const targets = [];
  if (!recipientRole || recipientRole === "super-admin") {
    targets.push({ collection: "adminViews", scopeType: "admin", scopeId: "global", docId: safeDocId(`notification_${notification.id}`) });
  }
  const dealershipId = scopeId(notification.dealershipId || notification.dealerEmail || notification.meta?.dealershipId || notification.meta?.dealershipEmail);
  if (dealershipId) {
    if (!recipientRole || recipientRole === "finance-desk") {
      targets.push({ collection: "financeViews", scopeType: "dealership", scopeId: dealershipId, docId: safeDocId(`notification_${notification.id}`) });
    }
    if (!recipientRole || recipientRole === "gm") {
      targets.push({ collection: "gmViews", scopeType: "dealership", scopeId: dealershipId, docId: safeDocId(`notification_${notification.id}`) });
    }
  }
  const bankId = scopeId(notification.bankId || notification.partnerId || notification.meta?.bankId || notification.meta?.assignedBankId || notification.meta?.assignedPartnerId);
  if (bankId && (!recipientRole || recipientRole === "bank-manager")) {
    targets.push({ collection: "bankViews", scopeType: "bank", scopeId: bankId, docId: safeDocId(`notification_${notification.id}`) });
  }
  const executiveScope = scopeId(notification.assignedExecutiveId || notification.recipientId || notification.meta?.assignedExecutiveId || notification.meta?.assignedExecutiveEmail);
  if (notification.recipientRole === "loan-executive" && executiveScope) {
    targets.push({ collection: "executiveViews", scopeType: "executive", scopeId: executiveScope, docId: safeDocId(`notification_${notification.id}_${executiveScope}`) });
  }
  return targets;
}

export async function syncNotificationProjection(notification = {}) {
  if (!notification?.id) return null;
  const targets = notificationTargets(notification);
  const updatedAt = notification.updatedAt || notification.readAt || notification.createdAt || new Date().toISOString();
  const payload = withProjectionMetadata({
    id: notification.id,
    sourceId: notification.id,
    sourceCollection: "notifications",
    viewType: "notification",
    title: notification.title || "",
    message: notification.message || "",
    read: notification.read === true,
    type: notification.type || notification.notificationType || "",
    priority: notification.priority || "normal",
    recipientRole: notification.recipientRole || notification.role || "",
    recipientId: notification.recipientId || notification.userId || "",
    recipientEmail: notification.recipientEmail || "",
    leadId: notification.leadId || null,
    caseId: notification.caseId || null,
    customerName: notification.leadSnapshot?.customerName || notification.meta?.customerName || "",
    status: notification.leadSnapshot?.status || notification.meta?.status || notification.status || "",
    actor: notification.actor || notification.actorName || notification.meta?.actor || "",
    createdAt: notification.createdAt || updatedAt,
    updatedAt,
  }, { sourceCollection: "notifications", sourceId: notification.id, sourceUpdatedAt: updatedAt, projectionType: "notification-view" });
  await Promise.all(targets.map((target) => upsertRecord(target.collection, target.docId, {
    ...payload,
    scopeType: target.scopeType,
    scopeId: target.scopeId,
  })));
  return { synced: targets.length, notificationId: notification.id };
}

export function syncNotificationProjectionSoon(notification = {}) {
  Promise.resolve().then(() => syncNotificationProjection(notification)).catch(() => {});
}

export async function queryNotificationProjectionForUser({ user = {}, query = {} } = {}) {
  const { limit, cursor, page } = paginationParams({ ...query, limit: query.limit || 40 });
  const role = user.role;
  let collection = "adminViews";
  const where = [{ field: "viewType", value: "notification" }];

  if (role === "finance-desk") {
    collection = "financeViews";
    where.push({ field: "scopeId", value: scopeId(user.dealershipId || user.email || user.uid) });
  } else if (role === "gm") {
    collection = "gmViews";
    where.push({ field: "scopeId", value: scopeId(user.dealershipId || user.email || user.uid) });
  } else if (role === "bank-manager") {
    collection = "bankViews";
    where.push({ field: "scopeId", value: scopeId(user.bankId || user.bankName || user.email || user.uid) });
  } else if (role === "loan-executive") {
    collection = "executiveViews";
    where.push({ field: "scopeId", value: scopeId(user.uid || user.email) });
  } else if (role !== "super-admin") {
    return null;
  }

  const result = await queryRecords(collection, {
    where,
    orderBy: "createdAt",
    direction: "desc",
    limit,
    cursor,
    page,
    maxLimit: 100,
    fields: [
      "sourceId",
      "viewType",
      "scopeId",
      ...PROJECTION_META_FIELDS,
      "title",
      "message",
      "read",
      "type",
      "priority",
      "recipientRole",
      "recipientId",
      "recipientEmail",
      "leadId",
      "caseId",
      "status",
      "actor",
      "createdAt",
      "updatedAt",
    ],
  });
  if (!result.data.length) return null;
  const freshRows = await freshProjectionRows(collection, result.data);
  if (!freshRows.length) return null;
  return pageResponse({
    data: freshRows.map((item) => ({ ...item, id: item.sourceId || item.id })),
    limit,
    nextCursor: result.nextCursor,
  });
}
