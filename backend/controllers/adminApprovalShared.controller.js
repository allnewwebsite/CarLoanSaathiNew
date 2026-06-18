import { createRecord, incrementRecord, listRecentRecords } from "../services/firestore.service.js";
import { clearCachedValue } from "../services/ttlCache.service.js";
import { logError } from "../services/logger.service.js";

export async function approvalLog({ req, entityType, entityId, previousStatus, newStatus, rejectionReason = "" }) {
  return createRecord("approvalLogs", {
    entityType,
    entityId,
    approvedBy: newStatus === "approved" ? req.user?.email || "super-admin" : null,
    approvedAt: newStatus === "approved" ? new Date().toISOString() : null,
    rejectedBy: newStatus === "rejected" ? req.user?.email || "super-admin" : null,
    rejectionReason,
    previousStatus,
    newStatus,
  });
}

export function today(value) {
  return String(value || "").startsWith(new Date().toISOString().slice(0, 10));
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function approvalStatusOf(record) {
  return String(record?.status || record?.approvalStatus || "pending").trim().toLowerCase();
}

export function finalApprovalStatus(record) {
  return ["approved", "rejected", "suspended", "deleted", "disabled", "inactive"].includes(approvalStatusOf(record));
}

export function pendingApprovalStatus(record) {
  if (record?.accountApproved === true || record?.approved === true) return false;
  return !finalApprovalStatus(record);
}

export function ecosystemLimit(value, fallback = 5) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 10) : fallback;
}

export async function boundedList(collection, limit, mapper = (item) => item, fields = []) {
  const rows = await listRecentRecords(collection, { limit, fields });
  return rows.map(mapper);
}

export const APPROVAL_LIST_FIELDS = [
  "id",
  "status",
  "approvalStatus",
  "accountType",
  "type",
  "dealershipName",
  "dealershipBrand",
  "city",
  "loginEmail",
  "primaryGoogleEmail",
  "bankName",
  "companyName",
  "bankBranchLocation",
  "branchLocation",
  "ifsc",
  "ifscCode",
  "managerName",
  "contactPerson",
  "mobile",
  "email",
  "officialEmail",
  "state",
  "monthlyLoanCapacity",
  "monthlyCapacity",
  "approvalLimit",
  "executiveCount",
  "executives",
  "documents",
  "createdAt",
  "updatedAt",
  "submittedAt",
  "dealership",
];

export const APPROVAL_LIST_PROJECTION_FIELDS = APPROVAL_LIST_FIELDS;

export function clearAdminApprovalCaches() {
  clearCachedValue("admin:approvals:");
  clearCachedValue("admin:ecosystem:");
  clearCachedValue("admin:partners:");
}

export function runAdminSideEffects(label, tasks = []) {
  Promise.allSettled(tasks.map((task) => task())).catch((error) => {
    logError("Admin side effect runner failed", { label, error: error.message });
  });
}

export function clearLeadMutationCaches(leadId) {
  clearCachedValue(`lead-detail:${leadId}:`);
  clearCachedValue(`timeline:lead:${leadId}:`);
  clearCachedValue("admin:");
  clearCachedValue("bank:");
  clearCachedValue("dealer:");
  clearCachedValue("finance:");
  clearCachedValue("gm:");
  clearCachedValue("lead-query:");
}

export function safeAdminUser(user = {}) {
  return {
    id: user.id,
    uid: user.uid || user.email,
    email: user.email,
    role: user.role,
    approved: user.approved === true,
    active: user.active !== false,
    accountStatus: user.accountStatus || user.status || "",
    dealershipId: user.dealershipId || null,
    bankId: user.bankId || null,
    branchId: user.branchId || null,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    lastLoginAt: user.lastLoginAt || null,
    lockedUntil: user.lockedUntil || null,
  };
}

export function safeLoginActivity(item = {}) {
  return {
    id: item.id,
    email: item.email,
    role: item.role || null,
    status: item.status,
    reason: item.reason || "",
    createdAt: item.createdAt || item.timestamp || null,
    ipAddress: item.ipAddress ? "recorded" : "",
    userAgent: item.userAgent ? "recorded" : "",
  };
}

export function safeDocument(item = {}) {
  return {
    id: item.id,
    leadId: item.leadId || null,
    caseId: item.caseId || null,
    dealershipId: item.dealershipId || null,
    bankId: item.bankId || null,
    assignedExecutiveId: item.assignedExecutiveId || null,
    assignedExecutiveEmail: item.assignedExecutiveEmail || null,
    type: item.type || item.documentType || item.label || "",
    documentType: item.documentType || item.type || "",
    fileName: item.fileName || item.originalName || "",
    fileType: item.fileType || item.mimeType || "",
    size: item.size || item.fileSize || null,
    status: item.status || "",
    uploadedBy: item.uploadedBy || "",
    createdAt: item.createdAt || item.uploadedAt || null,
  };
}

export async function firstAdminLookup(lookups = []) {
  for (const lookup of lookups) {
    const result = await lookup().catch(() => null);
    if (Array.isArray(result)) {
      if (result[0]) return result[0];
    } else if (result) {
      return result;
    }
  }
  return null;
}

export async function incrementPlatformCounters(increments = {}) {
  clearCachedValue("metrics:global:v2");
  return incrementRecord("metrics", "global", increments, {
    activeDealerships: 0,
    approvedDealerships: 0,
    pendingDealerships: 0,
    totalDealerships: 0,
    disabledDealerships: 0,
    bankPartners: 0,
    activeBanks: 0,
    totalBranches: 0,
    disabledBranches: 0,
    updatedAt: new Date().toISOString(),
  }).catch(() => null);
}
