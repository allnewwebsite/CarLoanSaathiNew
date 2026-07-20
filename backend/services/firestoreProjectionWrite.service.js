import { firestore } from "../firebase/admin.js";
import { memoryStore, recordWriteMetric } from "./firestoreShared.service.js";

const WORKFLOW_LOG_SOURCES = new Set([
  "leadAssignments",
  "reassignmentLogs",
  "payouts",
  "commissions",
  "notifications",
  "settings",
]);

const BANK_CATALOG_SOURCES = new Set([
  "banks",
  "bankPartners",
  "branches",
  "branchManagers",
  "pendingBankApprovals",
]);

function safeProjectionId(...parts) {
  return parts
    .filter(Boolean)
    .join("__")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 240);
}

function workflowLogProjection(collection, record = {}) {
  const timestamp = record.updatedAt || record.createdAt || record.timestamp || record.approvedAt || record.completedAt || new Date().toISOString();
  return {
    id: safeProjectionId(collection, record.id || timestamp),
    sourceCollection: collection,
    sourceId: record.id || null,
    logType: collection,
    timestamp,
    createdAt: record.createdAt || timestamp,
    updatedAt: record.updatedAt || timestamp,
    leadId: record.leadId || record.caseId || record.entityId || record.targetId || null,
    caseId: record.caseId || null,
    entityId: record.entityId || record.targetId || record.leadId || null,
    actorEmail: record.actorEmail || record.createdBy || record.updatedBy || record.approvedBy || record.userEmail || record.recipientEmail || null,
    actorName: record.actorName || record.createdByName || record.userName || null,
    status: record.status || record.newStatus || record.approvalStatus || null,
    action: record.action || record.actionType || record.type || record.eventType || collection,
    title: record.title || record.subject || record.action || record.actionType || collection,
    summary: record.message || record.description || record.reason || record.title || record.action || record.actionType || "",
  };
}

function bankBranchCatalogProjection(collection, record = {}) {
  const ifscCode = String(record.ifscCode || record.ifsc || record.bankIfsc || "").trim().toUpperCase();
  if (!ifscCode) return null;
  const status = String(record.status || record.approvalStatus || "").trim().toLowerCase();
  const approved = record.approved === true || ["approved", "active"].includes(status);
  const active = record.active !== false && status !== "suspended" && status !== "rejected";
  const bankName = String(record.bankName || record.name || record.companyName || "").trim();
  const branchName = String(record.branchName || record.branchLocation || record.bankBranchLocation || record.city || "").trim();
  if (!bankName || !branchName) return null;
  return {
    id: ifscCode,
    sourceCollection: collection,
    sourceId: record.id || null,
    bankId: record.bankId || record.id || ifscCode,
    branchId: record.branchId || record.id || record.bankId || ifscCode,
    bankBranchId: record.bankBranchId || record.branchId || record.id || record.bankId || ifscCode,
    ifscCode,
    bankName,
    branchName,
    address: record.address || "",
    city: String(record.city || record.branchCity || record.branchLocation || record.bankBranchLocation || "").trim(),
    state: String(record.state || "Haryana").trim(),
    contactPerson: record.contactPerson || record.managerName || "",
    phone: record.phone || record.mobile || "",
    email: record.email || record.officialEmail || "",
    approvalStatus: approved ? "approved" : (record.approvalStatus || record.status || "pending"),
    approved,
    active,
    approvedAt: record.approvedAt || null,
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || new Date().toISOString(),
  };
}

async function writeProjectionRecord(collection, id, payload) {
  if (!payload || !id) return;
  const startedAt = Date.now();
  if (!firestore) {
    memoryStore[collection] = memoryStore[collection] || [];
    const index = memoryStore[collection].findIndex((item) => item.id === id);
    if (index >= 0) memoryStore[collection][index] = { ...memoryStore[collection][index], ...payload };
    else memoryStore[collection].push({ id, ...payload });
    recordWriteMetric({ collection, operation: "projection-write", id, startedAt });
    return;
  }
  await firestore.collection(collection).doc(id).set(payload, { merge: true });
  recordWriteMetric({ collection, operation: "projection-write", id, startedAt });
}

export async function syncWriteProjections(collection, record = {}) {
  if (WORKFLOW_LOG_SOURCES.has(collection)) {
    const projection = workflowLogProjection(collection, record);
    await writeProjectionRecord("workflowLogViews", projection.id, projection);
  }
  if (BANK_CATALOG_SOURCES.has(collection)) {
    const projection = bankBranchCatalogProjection(collection, record);
    if (projection) await writeProjectionRecord("bankBranchCatalog", projection.id, projection);
  }
  if (["dealerStaff", "salespersons", "financeManagers"].includes(collection) && record?.id) {
    const { syncMemberViewProjection, syncSalespersonSummaryProjection, syncStaffViewProjection } = await import("./projection.service.js");
    if (collection === "dealerStaff") {
      await syncStaffViewProjection(record);
      await syncMemberViewProjection(record);
    }
    if (collection === "salespersons") {
      await syncSalespersonSummaryProjection(record);
      await syncMemberViewProjection({ ...record, role: "salesperson", sourceCollection: "salespersons" });
    }
    if (collection === "financeManagers") {
      await syncMemberViewProjection({ ...record, role: "finance-manager", sourceCollection: "financeManagers" });
    }
  }
}
