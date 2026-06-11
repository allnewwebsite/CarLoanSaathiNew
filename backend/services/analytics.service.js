import { getGlobalMetrics, getLeaderboardMetrics, getMetric, getTrendMetrics } from "./analyticsEngine.service.js";

export async function overviewAnalytics() {
  const metrics = await getGlobalMetrics();
  return {
    totalLeads: metrics.totalLeads,
    pendingLeads: metrics.pendingLeads,
    approvedLeads: metrics.approvedLeads || 0,
    disbursedLeads: metrics.disbursedLeads,
    rejectedLeads: metrics.rejectedLeads,
    pendingDocuments: metrics.pendingDocuments,
    bankProcess: metrics.bankProcess,
    approvalRatio: metrics.approvalRatio,
    rejectionRatio: metrics.rejectionRatio,
    averageProcessingTime: metrics.averageProcessingTime,
    commissionPayouts: metrics.commissionPayouts || 0,
  };
}

export async function monthlyLeadAnalytics() {
  const rows = await getTrendMetrics({ collection: "monthlyMetrics", limit: 12 });
  return rows.map((item) => ({ label: item.period || item.id, count: item.totalLeads || 0 }));
}

export async function cityAnalytics() {
  return [];
}

export async function dealerAnalytics() {
  const metrics = await getLeaderboardMetrics({ collection: "dealershipMetrics", limit: 20 });
  return metrics.map((item) => ({ label: item.scopeId, count: item.totalLeads || 0, amount: item.commissionPayouts || 0 }));
}

export async function bankAnalytics() {
  const metrics = await getLeaderboardMetrics({ collection: "bankMetrics", limit: 20 });
  return metrics.map((item) => ({ label: item.scopeId, count: item.totalLeads || 0 }));
}

export async function disbursalAnalytics() {
  const rows = await getTrendMetrics({ collection: "monthlyMetrics", limit: 12 });
  return rows.map((item) => ({ label: item.period || item.id, count: item.disbursedLeads || 0 }));
}

export async function scopedAnalytics({ dealershipId, bankId, assignedExecutiveId } = {}) {
  if (dealershipId) return getMetric("dealershipMetrics", dealershipId);
  if (bankId) return getMetric("bankMetrics", bankId);
  if (assignedExecutiveId) return getMetric("executiveMetrics", assignedExecutiveId);
  return getGlobalMetrics();
}
