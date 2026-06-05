import { queryRecords, upsertRecord } from "./firestore.service.js";
import { pageResponse, paginationParams } from "../utils/pagination.js";

const VIEW_LEAD_FIELDS = [
  "id",
  "caseId",
  "fullName",
  "customerName",
  "mobile",
  "city",
  "carPrice",
  "carOnRoadPrice",
  "loanAmount",
  "requiredLoanAmount",
  "status",
  "createdAt",
  "updatedAt",
  "generatedAt",
  "statusUpdatedAt",
  "dealershipId",
  "dealershipEmail",
  "dealershipName",
  "dealerEmail",
  "salespersonId",
  "salespersonName",
  "assignedSalesperson",
  "bankId",
  "bankName",
  "assignedBankName",
  "assignedBankIfsc",
  "ifscCode",
  "assignedExecutiveId",
  "assignedExecutiveEmail",
  "assignedExecutiveName",
  "assignedExecutiveMobile",
  "pendingDocuments",
  "pendingDocumentReason",
  "updatedByExecutiveName",
  "loanExecutiveRemarks",
  "bankRemarks",
  "sanctionLetterDocumentId",
  "sanctionLetterUploadedAt",
];

const VIEW_SEARCH_FIELDS = ["caseId", "fullName", "customerName", "mobile", "city", "bankName", "assignedBankName", "assignedExecutiveName", "salespersonName"];

function pick(record = {}, fields = VIEW_LEAD_FIELDS) {
  return fields.reduce((next, field) => {
    if (Object.prototype.hasOwnProperty.call(record, field)) next[field] = record[field];
    return next;
  }, { id: record.id });
}

function scopeId(value) {
  return String(value || "").trim();
}

function safeDocId(value) {
  return String(value || "").trim().replace(/[^\w.@-]/g, "_").slice(0, 420);
}

function projectionPayload(lead = {}, { scopeType, scopeId: scope }) {
  const projected = pick(lead);
  const updatedAt = lead.updatedAt || lead.statusUpdatedAt || lead.createdAt || new Date().toISOString();
  return {
    ...projected,
    viewType: "lead",
    sourceCollection: "leads",
    sourceId: lead.id,
    scopeType,
    scopeId: scope,
    createdAt: lead.createdAt || updatedAt,
    updatedAt,
    status: lead.status || "NEW",
    searchText: VIEW_SEARCH_FIELDS.map((field) => lead[field]).filter(Boolean).join(" ").toLowerCase(),
  };
}

function leadTargets(lead = {}) {
  const targets = [{ collection: "adminViews", scopeType: "admin", scopeId: "global", docId: safeDocId(`lead_${lead.id}`) }];
  const dealershipId = scopeId(lead.dealershipId || lead.dealershipEmail || lead.dealerEmail);
  if (dealershipId) {
    targets.push({ collection: "financeViews", scopeType: "dealership", scopeId: dealershipId, docId: safeDocId(`lead_${lead.id}`) });
    targets.push({ collection: "gmViews", scopeType: "dealership", scopeId: dealershipId, docId: safeDocId(`lead_${lead.id}`) });
  }
  const bankId = scopeId(lead.bankId || lead.assignedBankId || lead.assignedPartnerId);
  if (bankId) targets.push({ collection: "bankViews", scopeType: "bank", scopeId: bankId, docId: safeDocId(`lead_${lead.id}`) });
  [lead.assignedExecutiveId, lead.assignedExecutiveEmail].map(scopeId).filter(Boolean).forEach((executiveScope) => {
    targets.push({ collection: "executiveViews", scopeType: "executive", scopeId: executiveScope, docId: safeDocId(`lead_${lead.id}_${executiveScope}`) });
  });
  return targets;
}

export async function syncLeadProjection(lead = {}) {
  if (!lead?.id) return null;
  const targets = leadTargets(lead);
  await Promise.all(targets.map((target) => upsertRecord(
    target.collection,
    target.docId,
    projectionPayload(lead, target),
  )));
  return { synced: targets.length, leadId: lead.id };
}

export function syncLeadProjectionSoon(lead = {}) {
  Promise.resolve().then(() => syncLeadProjection(lead)).catch(() => {});
}

function notificationTargets(notification = {}) {
  const targets = [{ collection: "adminViews", scopeType: "admin", scopeId: "global", docId: safeDocId(`notification_${notification.id}`) }];
  const dealershipId = scopeId(notification.dealershipId || notification.dealerEmail);
  if (dealershipId) {
    targets.push({ collection: "financeViews", scopeType: "dealership", scopeId: dealershipId, docId: safeDocId(`notification_${notification.id}`) });
    targets.push({ collection: "gmViews", scopeType: "dealership", scopeId: dealershipId, docId: safeDocId(`notification_${notification.id}`) });
  }
  const bankId = scopeId(notification.bankId || notification.partnerId);
  if (bankId) targets.push({ collection: "bankViews", scopeType: "bank", scopeId: bankId, docId: safeDocId(`notification_${notification.id}`) });
  const executiveScope = scopeId(notification.assignedExecutiveId || notification.recipientId);
  if (notification.recipientRole === "loan-executive" && executiveScope) {
    targets.push({ collection: "executiveViews", scopeType: "executive", scopeId: executiveScope, docId: safeDocId(`notification_${notification.id}_${executiveScope}`) });
  }
  return targets;
}

export async function syncNotificationProjection(notification = {}) {
  if (!notification?.id) return null;
  const targets = notificationTargets(notification);
  const updatedAt = notification.updatedAt || notification.readAt || notification.createdAt || new Date().toISOString();
  const payload = {
    id: notification.id,
    sourceId: notification.id,
    sourceCollection: "notifications",
    viewType: "notification",
    title: notification.title || "",
    message: notification.message || "",
    read: notification.read === true,
    type: notification.type || notification.notificationType || "",
    priority: notification.priority || "normal",
    leadId: notification.leadId || null,
    caseId: notification.caseId || null,
    createdAt: notification.createdAt || updatedAt,
    updatedAt,
  };
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

export async function queryLeadProjectionForUser({ user = {}, query = {}, fields = VIEW_LEAD_FIELDS } = {}) {
  const { limit, cursor, page } = paginationParams(query);
  const role = user.role;
  let collection = "adminViews";
  const where = [{ field: "viewType", value: "lead" }];

  if (role === "finance-desk") {
    collection = "financeViews";
    where.push({ field: "scopeId", value: scopeId(user.dealershipId || user.email || user.uid) });
  } else if (role === "gm-sm") {
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

  if (query.status) where.push({ field: "status", value: String(query.status).trim() });
  const result = await queryRecords(collection, {
    where,
    orderBy: "createdAt",
    direction: "desc",
    limit,
    cursor,
    page,
    search: query.search,
    searchFields: ["searchText", ...VIEW_SEARCH_FIELDS],
    fields: [...new Set(["sourceId", "viewType", "scopeId", ...fields])],
    maxLimit: 100,
  });
  if (!result.data.length) return null;
  return pageResponse({ data: result.data.map((item) => ({ ...item, id: item.sourceId || item.id })), limit, nextCursor: result.nextCursor });
}
