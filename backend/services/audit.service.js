import { createRecord, listRecords } from "./firestore.service.js";

export const AUDIT_ACTIONS = {
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
};

export async function writeAuditLog({ req, actorId, actorRole, actionType, oldValue = null, newValue = null, leadId = null, meta = {} }) {
  const lead = leadId ? (await listRecords("leads")).find((entry) => entry.id === leadId || entry.caseId === leadId) : null;
  const timestamp = new Date().toISOString();
  const performedBy = actorId || req?.user?.email || req?.user?.uid || "system";
  const role = actorRole || req?.user?.role || "system";
  return createRecord("auditLogs", {
    actionType,
    oldValue,
    newValue,
    oldStatus: meta.oldStatus || oldValue?.status || null,
    newStatus: meta.newStatus || newValue?.status || null,
    performedBy,
    role,
    actorId: performedBy,
    actorRole: role,
    dealershipId: meta.dealershipId || lead?.dealershipId || req?.user?.dealershipId || null,
    bankId: meta.bankId || lead?.bankId || req?.user?.bankId || null,
    assignedExecutiveId: meta.assignedExecutiveId || lead?.assignedExecutiveId || null,
    leadId,
    caseId: lead?.caseId || meta.caseId || leadId || null,
    timestamp,
    ipAddress: req?.ip || req?.headers?.["x-forwarded-for"] || null,
    userAgent: req?.headers?.["user-agent"] || null,
    meta,
  });
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
