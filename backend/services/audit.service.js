import { createRecord, getRecord, queryRecords, upsertRecord } from "./firestore.service.js";
import { logError } from "./logger.service.js";

export const AUDIT_ACTIONS = {
  LOGIN: "LOGIN",
  LOGOUT: "LOGOUT",
  PASSWORD_RESET: "PASSWORD_RESET",
  LEAD_CREATED: "LEAD_CREATED",
  LEAD_ASSIGNED: "LEAD_ASSIGNED",
  STATUS_UPDATED: "STATUS_UPDATED",
  REJECTED: "REJECTED",
  DISBURSED: "DISBURSED",
  DOCUMENT_UPLOADED: "DOCUMENT_UPLOADED",
  DOCUMENT_VIEWED: "DOCUMENT_VIEWED",
  PENDING_DOCUMENT_REQUESTED: "PENDING_DOCUMENT_REQUESTED",
  EXECUTIVE_REASSIGNED: "EXECUTIVE_REASSIGNED",
  DEALERSHIP_APPROVED: "DEALERSHIP_APPROVED",
  REGISTRATION_COMPLETED: "REGISTRATION_COMPLETED",
  ADMIN_APPROVAL: "ADMIN_APPROVAL",
  PAYMENT_REQUESTED: "PAYMENT_REQUESTED",
  DASHBOARD_ACCESS: "DASHBOARD_ACCESS",
  BANK_APPROVED: "BANK_APPROVED",
  ACCOUNT_SUSPENDED: "ACCOUNT_SUSPENDED",
  NOTIFICATION_CREATED: "NOTIFICATION_CREATED",
  BANK_ASSIGNED: "BANK_ASSIGNED",
  EXECUTIVE_ASSIGNED: "EXECUTIVE_ASSIGNED",
  ASSIGNMENT_FAILURE: "ASSIGNMENT_FAILURE",
  ASSIGNMENT_REPAIRED: "ASSIGNMENT_REPAIRED",
  ORPHAN_LEAD_DETECTED: "ORPHAN_LEAD_DETECTED",
  PROJECTION_REPAIRED: "PROJECTION_REPAIRED",
  REALTIME_FAILURE: "REALTIME_FAILURE",
  UNAUTHORIZED_ACCESS: "UNAUTHORIZED_ACCESS",
  SECURITY_INCIDENT: "SECURITY_INCIDENT",
  SUBSCRIPTION_ORDER_CREATED: "SUBSCRIPTION_ORDER_CREATED",
  PAYMENT_RECEIVED: "PAYMENT_RECEIVED",
  SUBSCRIPTION_RENEWED: "SUBSCRIPTION_RENEWED",
  SUBSCRIPTION_MANUAL_EXTENSION: "SUBSCRIPTION_MANUAL_EXTENSION",
  SUBSCRIPTION_TRIAL_ACTIVATED: "SUBSCRIPTION_TRIAL_ACTIVATED",
  SUBSCRIPTION_TRIAL_ENDED: "SUBSCRIPTION_TRIAL_ENDED",
  SUBSCRIPTION_EXPIRED: "SUBSCRIPTION_EXPIRED",
  SUBSCRIPTION_ADMIN_OVERRIDE: "SUBSCRIPTION_ADMIN_OVERRIDE",
  RAZORPAY_WEBHOOK_RECEIVED: "RAZORPAY_WEBHOOK_RECEIVED",
  RAZORPAY_WEBHOOK_PROCESSED: "RAZORPAY_WEBHOOK_PROCESSED",
  RAZORPAY_WEBHOOK_REJECTED: "RAZORPAY_WEBHOOK_REJECTED",
  LEAD_MARKED_DEAD: "LEAD_MARKED_DEAD",
  LEAD_RESTORED_FROM_DEAD: "LEAD_RESTORED_FROM_DEAD",
  DEAD_CASE_UPDATED: "DEAD_CASE_UPDATED",
};

const sensitiveKeys = /password|token|secret|privateKey|authorization|apiKey|otp|credential/i;

function maskSensitive(value) {
  if (Array.isArray(value)) return value.map(maskSensitive);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, val]) => {
    if (sensitiveKeys.test(key)) return [key, "[masked]"];
    return [key, maskSensitive(val)];
  }));
}

export async function writeAuditLog({
  req,
  actorId,
  actorRole,
  actionType,
  action,
  oldValue = null,
  previousValue = null,
  newValue = null,
  targetEntity = null,
  targetId = null,
  leadId = null,
  sourcePortal = null,
  meta = {},
  collection = "auditLogs",
}) {
  const lead = leadId ? await getRecord("leads", leadId) : null;
  const timestamp = new Date().toISOString();
  const performedBy = actorId || req?.user?.email || req?.user?.uid || "system";
  const role = actorRole || req?.user?.role || "system";
  const resolvedAction = actionType || action;
  return createRecord(collection, {
    action: resolvedAction,
    actionType: resolvedAction,
    previousValue: maskSensitive(previousValue || oldValue),
    oldValue: maskSensitive(oldValue),
    newValue: maskSensitive(newValue),
    oldStatus: meta.oldStatus || oldValue?.status || previousValue?.status || null,
    newStatus: meta.newStatus || newValue?.status || null,
    performedBy,
    role,
    actorId: performedBy,
    actorRole: role,
    targetEntity,
    targetId: targetId || leadId || null,
    dealershipId: meta.dealershipId || lead?.dealershipId || req?.user?.dealershipId || null,
    bankId: meta.bankId || lead?.bankId || req?.user?.bankId || null,
    assignedExecutiveId: meta.assignedExecutiveId || lead?.assignedExecutiveId || null,
    leadId,
    caseId: lead?.caseId || meta.caseId || leadId || null,
    timestamp,
    createdAt: timestamp,
    ipAddress: req?.ip || req?.headers?.["x-forwarded-for"] || null,
    userAgent: req?.headers?.["user-agent"] || null,
    requestId: req?.requestId || meta.requestId || null,
    sourcePortal: sourcePortal || meta.sourcePortal || req?.headers?.["x-source-portal"] || null,
    immutable: true,
    meta: maskSensitive(meta),
  });
}

export async function writeAuditLogOnce(dedupeId, payload = {}) {
  const id = String(dedupeId || "").trim();
  if (!id) return writeAuditLog(payload);
  const existing = await getRecord(payload.collection || "auditLogs", id).catch(() => null);
  if (existing) return existing;
  const timestamp = new Date().toISOString();
  const performedBy = payload.actorId || payload.req?.user?.email || payload.req?.user?.uid || "system";
  const role = payload.actorRole || payload.req?.user?.role || "system";
  const resolvedAction = payload.actionType || payload.action;
  return upsertRecord(payload.collection || "auditLogs", id, {
    action: resolvedAction,
    actionType: resolvedAction,
    previousValue: maskSensitive(payload.previousValue || payload.oldValue || null),
    oldValue: maskSensitive(payload.oldValue || null),
    newValue: maskSensitive(payload.newValue || null),
    performedBy,
    role,
    actorId: performedBy,
    actorRole: role,
    targetEntity: payload.targetEntity || null,
    targetId: payload.targetId || null,
    dealershipId: payload.meta?.dealershipId || payload.req?.user?.dealershipId || null,
    bankId: payload.meta?.bankId || payload.req?.user?.bankId || null,
    leadId: payload.leadId || null,
    caseId: payload.meta?.caseId || payload.leadId || null,
    timestamp,
    createdAt: timestamp,
    ipAddress: payload.req?.ip || payload.req?.headers?.["x-forwarded-for"] || null,
    userAgent: payload.req?.headers?.["user-agent"] || null,
    requestId: payload.req?.requestId || payload.meta?.requestId || null,
    sourcePortal: payload.sourcePortal || payload.meta?.sourcePortal || payload.req?.headers?.["x-source-portal"] || null,
    immutable: true,
    dedupeId: id,
    meta: maskSensitive(payload.meta || {}),
  });
}

export function queueAuditLog(payload) {
  Promise.resolve()
    .then(() => writeAuditLog(payload))
    .catch((error) => logError("Audit write failed", { actionType: payload?.actionType, error: error.message }));
}

export async function getAuditLogs(filters = {}) {
  const where = [];
  if (filters.actorId || filters.user) where.push({ field: "actorId", value: String(filters.actorId || filters.user).trim() });
  if (filters.actionType || filters.action) where.push({ field: "actionType", value: String(filters.actionType || filters.action).trim() });
  if (filters.role) where.push({ field: "role", value: String(filters.role).trim() });
  if (filters.dealership || filters.dealershipId) where.push({ field: "dealershipId", value: String(filters.dealership || filters.dealershipId).trim() });
  if (filters.bank || filters.bankId) where.push({ field: "bankId", value: String(filters.bank || filters.bankId).trim() });
  if (filters.leadId) where.push({ field: "leadId", value: String(filters.leadId).trim() });
  if (filters.caseId) where.push({ field: "caseId", value: String(filters.caseId).trim() });
  if (filters.date) {
    const day = String(filters.date).slice(0, 10);
    where.push({ field: "timestamp", op: ">=", value: `${day}T00:00:00.000Z` });
    where.push({ field: "timestamp", op: "<=", value: `${day}T23:59:59.999Z` });
  }
  const result = await queryRecords("auditLogs", {
    where,
    orderBy: "timestamp",
    direction: "desc",
    limit: filters.limit || 50,
    cursor: filters.cursor,
    maxLimit: 100,
  });
  const logs = result.data;
  const search = String(filters.search || "").trim().toLowerCase();
  return logs.filter((log) => {
    const actor = filters.actorId || filters.user;
    const action = filters.actionType || filters.action;
    const role = filters.role;
    const dealership = filters.dealership || filters.dealershipId;
    const bank = filters.bank || filters.bankId;
    const lead = filters.leadId || filters.caseId;
    const date = filters.date;
    const userOk = !actor || String(log.actorId || log.performedBy || "").toLowerCase().includes(String(actor).toLowerCase());
    const actionOk = !action || String(log.actionType || "").toLowerCase().includes(String(action).toLowerCase());
    const roleOk = !role || String(log.role || log.actorRole || "").toLowerCase() === String(role).toLowerCase();
    const dealershipOk = !dealership || String(log.dealershipId || "").toLowerCase().includes(String(dealership).toLowerCase());
    const bankOk = !bank || String(log.bankId || "").toLowerCase().includes(String(bank).toLowerCase());
    const leadOk = !lead || [log.caseId, log.leadId].filter(Boolean).join(" ").toLowerCase().includes(String(lead).toLowerCase());
    const dateOk = !date || String(log.timestamp || log.createdAt || "").startsWith(date);
    const searchOk = !search || [log.caseId, log.leadId, log.actionType, log.performedBy, log.dealershipId, log.bankId].filter(Boolean).join(" ").toLowerCase().includes(search);
    return userOk && actionOk && roleOk && dealershipOk && bankOk && leadOk && dateOk && searchOk;
  });
}
