import { countRecords, createRecord, queryRecords, upsertRecord } from "./firestore.service.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";
import { logWarn } from "./logger.service.js";

const statusBuckets = {
  pending: [LEAD_STATUSES.NEW, LEAD_STATUSES.ASSIGNED, LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW],
  pendingDocs: [LEAD_STATUSES.DOCS_PENDING],
  approved: [LEAD_STATUSES.APPROVED],
  disbursed: [LEAD_STATUSES.DISBURSED, LEAD_STATUSES.CLOSED],
  rejected: [LEAD_STATUSES.REJECTED],
  bankProcess: [LEAD_STATUSES.ASSIGNED, LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW, LEAD_STATUSES.APPROVED],
};

function scopeWhere(scope = {}) {
  if (scope.dealershipId) return [{ field: "dealershipId", value: scope.dealershipId }];
  if (scope.bankId) return [{ field: "bankId", value: scope.bankId }];
  if (scope.assignedExecutiveId) return [{ field: "assignedExecutiveId", value: scope.assignedExecutiveId }];
  return [];
}

export async function computeLeadMetrics(scope = {}) {
  const startedAt = Date.now();
  const baseWhere = scopeWhere(scope);
  const totalLeads = await countRecords("leads", { where: baseWhere });
  const counts = {};
  for (const [bucket, statuses] of Object.entries(statusBuckets)) {
    let total = 0;
    for (const status of statuses) {
      total += await countRecords("leads", { where: [...baseWhere, { field: "status", value: status }] });
    }
    counts[bucket] = total;
  }
  const metrics = {
    scopeType: scope.dealershipId ? "dealership" : scope.bankId ? "bank" : scope.assignedExecutiveId ? "executive" : "global",
    scopeId: scope.dealershipId || scope.bankId || scope.assignedExecutiveId || "global",
    totalLeads,
    ...counts,
    generatedAt: new Date().toISOString(),
  };
  if (Date.now() - startedAt > 1500) logWarn("Slow metrics computation", { scope: metrics.scopeType, scopeId: metrics.scopeId, durationMs: Date.now() - startedAt });
  return metrics;
}

export async function upsertLeadMetrics(scope = {}) {
  const metrics = await computeLeadMetrics(scope);
  await upsertRecord("metrics", `lead:${metrics.scopeType}:${metrics.scopeId}`, metrics);
  return metrics;
}

export function queueLeadMetricsUpdate(scope = {}) {
  Promise.resolve()
    .then(() => upsertLeadMetrics(scope))
    .catch((error) => logWarn("Lead metrics update failed", { scope, error: error.message }));
}

export async function lightweightLeadSample(scope = {}, limit = 20) {
  const result = await queryRecords("leads", {
    where: scopeWhere(scope),
    orderBy: "createdAt",
    direction: "desc",
    limit,
    fields: ["id", "caseId", "status", "dealershipId", "bankId", "assignedExecutiveId", "createdAt", "updatedAt"],
  });
  return result.data.map((lead) => ({ ...lead, normalizedStatus: normalizeStatus(lead.status) }));
}

export async function recordOperationalMetric(metric) {
  return createRecord("operationalMetrics", {
    ...metric,
    recordedAt: new Date().toISOString(),
  });
}
