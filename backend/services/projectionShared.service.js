import { createHash } from "node:crypto";

export const PROJECTION_VERSION = Number(process.env.PROJECTION_VERSION || 2);
export const PROJECTION_VALIDATION_SAMPLE_LIMIT = Number(process.env.PROJECTION_VALIDATION_SAMPLE_LIMIT || 3);
export const LEAD_QUERY_CACHE_TTL_MS = Number(process.env.LEAD_QUERY_CACHE_TTL_MS || 8000);

export const LEAD_VIEW_COLLECTIONS = new Set(["adminViews", "financeViews", "gmViews", "bankViews", "executiveViews", "leadDetailsProjection", "bankDealershipViews"]);
export const NOTIFICATION_VIEW_COLLECTIONS = new Set(["adminViews", "financeViews", "gmViews", "bankViews", "executiveViews"]);

export const VIEW_LEAD_FIELDS = [
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
  "workflowLocation",
  "terminalStatusAt",
  "terminalMovedAt",
  "archivedAt",
  "retentionDueAt",
  "rejectionReason",
  "rejectionRemarks",
  "rejectedAt",
  "rejectedBy",
  "dealershipId",
  "dealershipEmail",
  "dealershipName",
  "dealershipCity",
  "dealerName",
  "dealerEmail",
  "dealerMobile",
  "salespersonId",
  "salespersonName",
  "salespersonJobId",
  "salespersonEmail",
  "assignedSalesperson",
  "financeManagerId",
  "financeManagerName",
  "financeManagerMobile",
  "financeManagerEmail",
  "financeManagerEmployeeId",
  "assignedFinanceManager",
  "bankId",
  "bankName",
  "assignedBankName",
  "assignedBankIfsc",
  "ifscCode",
  "assignedExecutiveId",
  "assignedExecutiveEmail",
  "ownerId",
  "assignedExecutiveName",
  "assignedExecutiveMobile",
  "executiveMobile",
  "assignmentStatus",
  "ownershipStatus",
  "accepted",
  "acceptedAt",
  "acceptedBy",
  "acceptedExecutiveId",
  "acceptanceDueAt",
  "slaRunning",
  "pendingDocuments",
  "pendingDocumentReason",
  "updatedByExecutiveName",
  "loanExecutiveRemarks",
  "bankRemarks",
  "sanctionLetterDocumentId",
  "sanctionLetterUploadedAt",
  "isDeadCase",
  "deadCaseDate",
  "deadCaseBy",
  "deadCaseReason",
  "deadCaseNotes",
  "deadCaseUpdatedAt",
];

export const VIEW_SEARCH_FIELDS = ["caseId", "fullName", "customerName", "mobile", "city", "bankName", "assignedBankName", "assignedExecutiveName", "salespersonName", "salespersonJobId", "salespersonEmail", "assignedSalesperson", "financeManagerName", "financeManagerEmployeeId", "financeManagerEmail", "assignedFinanceManager"];
export const PROJECTION_META_FIELDS = [
  "projectionVersion",
  "projectionType",
  "projectionUpdatedAt",
  "projectionLastUpdatedAt",
  "sourceUpdatedAt",
  "projectionLagMs",
  "projectionHealthStatus",
  "projectionHealthCheckedAt",
  "projectionHealthReason",
];

export function pick(record = {}, fields = VIEW_LEAD_FIELDS) {
  return fields.reduce((next, field) => {
    if (Object.prototype.hasOwnProperty.call(record, field)) next[field] = record[field];
    return next;
  }, { id: record.id });
}

function stableCacheValue(value) {
  if (Array.isArray(value)) return value.map(stableCacheValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((next, key) => {
      const current = value[key];
      if (current !== undefined) next[key] = stableCacheValue(current);
      return next;
    }, {});
}

export function cacheDigest(value) {
  return createHash("sha1").update(JSON.stringify(stableCacheValue(value))).digest("hex");
}

export function projectionWhereSignature(where = []) {
  return cacheDigest(where.map((clause) => ({
    field: clause.field,
    op: clause.op || "==",
    value: clause.value,
  })));
}

export function scopeId(value) {
  return String(value || "").trim();
}

export function safeDocId(value) {
  return String(value || "").trim().replace(/[^\w.@-]/g, "_").slice(0, 420);
}

export function timestampValue(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime() || 0;
  if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function latestTimestamp(...values) {
  return values
    .filter(Boolean)
    .sort((left, right) => timestampValue(right) - timestampValue(left))[0] || "";
}

export function isoNow() {
  return new Date().toISOString();
}

export function projectionMetadata({ sourceCollection, sourceId, sourceUpdatedAt, projectionType }) {
  const projectionUpdatedAt = isoNow();
  const sourceTime = timestampValue(sourceUpdatedAt);
  const projectionTime = timestampValue(projectionUpdatedAt);
  return {
    projectionVersion: PROJECTION_VERSION,
    projectionType,
    projectionUpdatedAt,
    projectionLastUpdatedAt: projectionUpdatedAt,
    sourceCollection,
    sourceId: sourceId || null,
    sourceUpdatedAt: sourceUpdatedAt || projectionUpdatedAt,
    projectionLagMs: sourceTime ? Math.max(0, projectionTime - sourceTime) : 0,
    projectionHealthStatus: "fresh",
    projectionHealthCheckedAt: projectionUpdatedAt,
  };
}

export function withProjectionMetadata(payload = {}, meta = {}) {
  return {
    ...payload,
    ...projectionMetadata({
      sourceCollection: meta.sourceCollection || payload.sourceCollection,
      sourceId: meta.sourceId || payload.sourceId,
      sourceUpdatedAt: meta.sourceUpdatedAt || payload.updatedAt || payload.createdAt,
      projectionType: meta.projectionType || payload.viewType || payload.projectionType || "projection",
    }),
  };
}

export function freshnessProblem(record = {}) {
  if (!record) return "missing";
  if (Number(record.projectionVersion || 0) !== PROJECTION_VERSION) return "version_mismatch";
  if (!record.projectionUpdatedAt || !record.sourceUpdatedAt) return "missing_freshness_metadata";
  if (record.projectionHealthStatus === "stale" || record.projectionHealthStatus === "rebuild-failed") return record.projectionHealthStatus;
  return "";
}
