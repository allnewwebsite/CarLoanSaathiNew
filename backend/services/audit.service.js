import { createRecord, getRecord, listRecords } from "./firestore.service.js";
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
  BANK_APPROVED: "BANK_APPROVED",
  ACCOUNT_SUSPENDED: "ACCOUNT_SUSPENDED",
  NOTIFICATION_CREATED: "NOTIFICATION_CREATED",
  SLA_WARNING: "SLA_WARNING",
  SLA_BREACHED: "SLA_BREACHED",
  SECURITY_INCIDENT: "SECURITY_INCIDENT",
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

export function queueAuditLog(payload) {
  Promise.resolve()
    .then(() => writeAuditLog(payload))
    .catch((error) => logError("Audit write failed", { actionType: payload?.actionType, error: error.message }));
}

export async function getAuditLogs(filters = {}) {
  const logs = await listRecords("auditLogs");
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
