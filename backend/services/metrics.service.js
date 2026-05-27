import { createRecord } from "./firestore.service.js";
import { getGlobalMetrics, getMetric } from "./analyticsEngine.service.js";

export async function computeLeadMetrics(scope = {}) {
  if (scope.dealershipId) return getMetric("dealershipMetrics", scope.dealershipId);
  if (scope.bankId) return getMetric("bankMetrics", scope.bankId);
  if (scope.assignedExecutiveId) return getMetric("executiveMetrics", scope.assignedExecutiveId);
  return getGlobalMetrics();
}

export async function upsertLeadMetrics(scope = {}) {
  return computeLeadMetrics(scope);
}

export function queueLeadMetricsUpdate() {
  return Promise.resolve({ queued: true });
}

export async function lightweightLeadSample() {
  return [];
}

export async function recordOperationalMetric(metric) {
  return createRecord("operationalMetrics", {
    ...metric,
    recordedAt: new Date().toISOString(),
  });
}
