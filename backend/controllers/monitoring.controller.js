import { getGlobalMetrics } from "../services/analyticsEngine.service.js";
import { countRecords } from "../services/firestore.service.js";
import { productionHealth } from "../services/health.service.js";
import { monitoringTelemetrySummary } from "../services/monitoringCenter.service.js";
import { getOperationalDashboard } from "../services/observability.service.js";
import { realtimeStats } from "../services/realtime.service.js";
import { cached } from "../services/ttlCache.service.js";
import { whatsappMonitoringSummary } from "../services/whatsapp.service.js";

function statusLabel(status = "") {
  if (["ok", "healthy"].includes(status)) return "Healthy";
  if (["down", "critical"].includes(status)) return "Critical";
  return "Warning";
}

function card(status, detail = "") {
  return {
    status: statusLabel(status),
    detail,
  };
}

async function platformMetricsWithFallbacks(metrics = {}) {
  const [
    projectedLeads,
    activeDealerships,
    approvedDealerships,
    legacyDealers,
    activeBanks,
    bankPartners,
  ] = await Promise.all([
    countRecords("adminViews", { where: [{ field: "viewType", value: "lead" }] }).catch(() => 0),
    countRecords("dealerships", { where: [{ field: "active", value: true }] }).catch(() => 0),
    countRecords("approvedDealerships").catch(() => 0),
    countRecords("dealers", { where: [{ field: "active", value: true }] }).catch(() => 0),
    countRecords("banks", { where: [{ field: "active", value: true }] }).catch(() => 0),
    countRecords("bankPartners", { where: [{ field: "active", value: true }] }).catch(() => 0),
  ]);
  const dealershipCount = Math.max(
    Number(metrics.activeDealerships || 0),
    Number(metrics.totalDealerships || 0),
    Number(activeDealerships || 0),
    Number(approvedDealerships || 0),
    Number(legacyDealers || 0),
  );
  const bankCount = Math.max(
    Number(metrics.activeBanks || 0),
    Number(metrics.bankPartners || 0),
    Number(activeBanks || 0),
    Number(bankPartners || 0),
  );
  return {
    ...metrics,
    totalLeads: Number(metrics.totalLeads || 0) || Number(projectedLeads || 0),
    activeDealerships: Number(metrics.activeDealerships || 0) || dealershipCount,
    totalDealerships: Number(metrics.totalDealerships || 0) || dealershipCount,
    approvedDealerships: Number(metrics.approvedDealerships || 0) || Number(approvedDealerships || 0) || dealershipCount,
    activeBanks: Number(metrics.activeBanks || 0) || bankCount,
    bankPartners: Number(metrics.bankPartners || 0) || bankCount,
  };
}

function buildQueueMonitoring(redisQueues = {}) {
  const queueItems = Object.values(redisQueues.queues || {});
  const totals = queueItems.reduce((acc, item) => {
    acc.failedJobsTotal += Number(item.failedJobsTotal || 0);
    acc.failedJobsLastHour += Number(item.failedJobsLastHour || 0);
    acc.failedJobsLast24Hours += Number(item.failedJobsLast24Hours || 0);
    acc.historicalFailedJobs += Number(item.historicalFailedJobs || 0);
    acc.waitingJobs += Number(item.waitingJobs || 0);
    acc.activeJobs += Number(item.activeJobs || 0);
    acc.delayedJobs += Number(item.delayedJobs || 0);
    return acc;
  }, {
    failedJobsTotal: 0,
    failedJobsLastHour: 0,
    failedJobsLast24Hours: 0,
    historicalFailedJobs: 0,
    waitingJobs: 0,
    activeJobs: 0,
    delayedJobs: 0,
  });

  return {
    enabled: Boolean(redisQueues.enabled),
    status: redisQueues.status || "local-fallback",
    generatedAt: redisQueues.generatedAt || null,
    healthRules: redisQueues.healthRules || {},
    queues: queueItems,
    ...totals,
  };
}

function buildAlerts({ telemetry, operational, queueMonitoring }) {
  const alerts = [];
  const projectionRate = telemetry.projection.projectionHitRate;
  const cacheRate = telemetry.cache.hitRate;
  if (projectionRate !== null && projectionRate < 80) {
    alerts.push({ severity: projectionRate < 50 ? "critical" : "warning", title: "Projection hit rate below 80%", detail: `${projectionRate}% projection hit rate` });
  }
  if (cacheRate !== null && cacheRate < 70) {
    alerts.push({ severity: cacheRate < 40 ? "critical" : "warning", title: "Cache hit rate below 70%", detail: `${cacheRate}% cache hit rate` });
  }
  if (telemetry.api.p95Ms > 1000) {
    alerts.push({ severity: telemetry.api.p95Ms > 2000 ? "critical" : "warning", title: "API latency above 1000ms", detail: `p95 ${telemetry.api.p95Ms}ms` });
  }
  if (telemetry.firestore.duplicateReadCount > 0) {
    alerts.push({ severity: "warning", title: "Duplicate Firestore reads detected", detail: `${telemetry.firestore.duplicateReadCount} duplicate reads in current window` });
  }
  if (telemetry.realtime.realtimeErrors > 0 || telemetry.realtime.disconnectedClients > 10) {
    alerts.push({ severity: "warning", title: "Realtime instability detected", detail: `${telemetry.realtime.realtimeErrors} errors, ${telemetry.realtime.disconnectedClients} disconnects` });
  }
  for (const queue of queueMonitoring.queues || []) {
    const recentFailures = Number(queue.failedJobsLast24Hours || 0);
    if (recentFailures > 0) {
      alerts.push({
        severity: recentFailures > 10 ? "critical" : "warning",
        title: "Active queue failures detected",
        detail: `${queue.queueName} has ${recentFailures} failures in the last 24 hours; ${queue.historicalFailedJobs || 0} retained historical failures`,
      });
    }
  }
  const operationalAlerts = (operational.alerts || []).filter((item) => {
    if (item.type !== "queue_failures") return true;
    return Number(item.meta?.activeFailedLast24Hours || item.meta?.failedJobsLast24Hours || 0) > 0;
  });
  return [
    ...alerts,
    ...operationalAlerts.slice(0, 8).map((item) => ({
      severity: item.severity || "warning",
      title: item.title || item.type || "Operational alert",
      detail: item.message || "",
      createdAt: item.createdAt || null,
    })),
  ].slice(0, 12);
}

export async function getAdminMonitoringCenter(_req, res, next) {
  try {
    const snapshot = await cached("admin:monitoring:center:v1", 15000, async () => {
      const currentRealtimeStats = realtimeStats();
      const [health, operational, rawMetrics] = await Promise.all([
        productionHealth({ deep: true }),
        getOperationalDashboard({ limit: 10 }),
        getGlobalMetrics(),
      ]);
      const metrics = await platformMetricsWithFallbacks(rawMetrics);
      const telemetry = monitoringTelemetrySummary({ realtimeStats: currentRealtimeStats });
      const whatsappMonitoring = whatsappMonitoringSummary();
      const activeUsers = telemetry.realtime.activeSseConnections;
      const queueMonitoring = buildQueueMonitoring(health.checks?.redisQueues);
      const healthCards = {
        systemStatus: card(health.status, `${health.environment} / uptime ${health.uptimeSeconds}s`),
        apiHealth: card(telemetry.statuses.api, `p95 ${telemetry.api.p95Ms}ms`),
        realtimeStatus: card(telemetry.statuses.realtime, `${telemetry.realtime.activeSseConnections} SSE clients`),
        projectionHealth: card(telemetry.statuses.projection, telemetry.projection.projectionHitRate === null ? "No projection samples yet" : `${telemetry.projection.projectionHitRate}% hit rate`),
        cacheHealth: card(telemetry.statuses.cache, telemetry.cache.hitRate === null ? "No cache samples yet" : `${telemetry.cache.hitRate}% hit rate`),
        firestoreHealth: card(health.checks?.firestore?.status === "ok" ? telemetry.statuses.firestore : health.checks?.firestore?.status, `${health.checks?.firestore?.latencyMs ?? 0}ms health read`),
        razorpayWebhook: card(health.checks?.razorpayWebhook?.status, health.checks?.razorpayWebhook?.lastSuccessAt ? `Last success ${health.checks.razorpayWebhook.lastSuccessAt}` : "Waiting for successful delivery"),
        paymentReconciliation: card(health.checks?.paymentReconciliation?.status, health.checks?.paymentReconciliation?.lastRunAt ? `Last run ${health.checks.paymentReconciliation.lastRunAt}` : "Waiting for first run"),
      };

      return {
        generatedAt: new Date().toISOString(),
        healthCards,
        platformOverview: {
          totalActiveDealerships: metrics.activeDealerships || 0,
          totalActiveBanks: metrics.activeBanks || metrics.bankPartners || 0,
          totalActiveUsers: null,
          currentOnlineUsers: activeUsers,
          activeSseConnections: telemetry.realtime.activeSseConnections,
          totalLeads: metrics.totalLeads || 0,
          totalDisbursedCases: metrics.disbursedLeads || 0,
          totalBranches: metrics.totalBranches || 0,
          disabledBranches: metrics.disabledBranches || 0,
        },
        apiPerformance: {
          topSlowApis: telemetry.api.topSlowApis,
          averageApiResponseTime: telemetry.api.averageMs,
          p95ApiResponseTime: telemetry.api.p95Ms,
          p99ApiResponseTime: telemetry.api.p99Ms,
          requestCount: telemetry.api.requestCount,
          failureCount: telemetry.api.failureCount,
          timeoutCount: telemetry.api.timeoutCount,
          errorRate: telemetry.api.errorRate,
          slowRequestCount: telemetry.api.slowRequestCount,
          apiErrorCount: telemetry.api.errorCount,
        },
        firestoreMonitoring: telemetry.firestore,
        portalHealth: telemetry.portals,
        leadMonitoring: {
          total: metrics.totalLeads || 0,
          pending: metrics.pendingLeads || 0,
          acceptedOrAssigned: metrics.assignedLeads || 0,
          pendingDocuments: metrics.pendingDocuments || 0,
          bankProcess: metrics.bankProcess || 0,
          rejected: metrics.rejectedLeads || 0,
          disbursed: metrics.disbursedLeads || 0,
          completed: metrics.completedLeads || 0,
        },
        businessMonitoring: {
          conversionRate: metrics.approvalRatio || 0,
          rejectionRate: metrics.rejectionRatio || 0,
          averageProcessingMinutes: metrics.averageProcessingTime || 0,
          dealerships: metrics.totalDealerships || metrics.activeDealerships || 0,
          banks: metrics.activeBanks || metrics.bankPartners || 0,
        },
        securityMonitoring: {
          unauthorizedRequests: telemetry.api.unauthorizedCount,
          permissionDenials: telemetry.api.forbiddenCount,
          rateLimitEvents: telemetry.api.rateLimitedCount,
          suspiciousRequestFailures: telemetry.api.failureCount,
        },
        serviceHealth: {
          backend: health.status,
          firestore: health.checks?.firestore?.status || "not-checked",
          redis: health.checks?.redisQueues?.status || "not-configured",
          scheduler: health.checks?.scheduler?.status || "unknown",
          notifications: health.checks?.notifications?.status || "unknown",
          projections: health.checks?.projections?.status || "unknown",
          razorpayWebhook: health.checks?.razorpayWebhook?.status || "unknown",
          paymentReconciliation: health.checks?.paymentReconciliation?.status || "unknown",
          memory: health.memory,
          cpu: health.cpu,
          workers: health.workers,
        },
        projectionHealth: telemetry.projection,
        realtimeMonitoring: telemetry.realtime,
        notificationMonitoring: telemetry.realtime.notificationDelivery,
        branchMonitoring: {
          totalBanks: metrics.activeBanks || metrics.bankPartners || 0,
          totalBranches: metrics.totalBranches || 0,
          disabledBranches: metrics.disabledBranches || 0,
          branchesByState: telemetry.branches.branchesByState,
          branchesByLocation: telemetry.branches.branchesByLocation,
          branchesByCapacity: telemetry.branches.branchesByCapacity,
          ifscDuplicates: telemetry.branches.ifscDuplicates,
          realtimeSyncEvents: telemetry.branches.realtimeSyncEvents,
          branchCreationEvents: telemetry.branches.branchCreationEvents,
          branchUpdateEvents: telemetry.branches.branchUpdateEvents,
        },
        dealerMonitoring: {
          totalDealerships: metrics.totalDealerships || metrics.activeDealerships || 0,
          approvedDealerships: metrics.approvedDealerships || metrics.activeDealerships || 0,
          pendingDealerships: metrics.pendingDealerships || 0,
          disabledDealerships: metrics.disabledDealerships || 0,
          dealershipsByBrand: telemetry.dealers.dealershipsByBrand,
          dealershipsByState: telemetry.dealers.dealershipsByState,
          dealershipsByLocation: telemetry.dealers.dealershipsByLocation,
          realtimeDealerEvents: telemetry.dealers.realtimeDealerEvents,
          dealerCreationEvents: telemetry.dealers.dealerCreationEvents,
          dealerApprovalEvents: telemetry.dealers.dealerApprovalEvents,
          dealerUpdateEvents: telemetry.dealers.dealerUpdateEvents,
          dealerDisabledEvents: telemetry.dealers.dealerDisabledEvents,
        },
        cacheMonitoring: telemetry.cache,
        whatsappMonitoring,
        queueMonitoring,
        systemAlerts: buildAlerts({ telemetry, operational, queueMonitoring }),
        operationalEvents: (operational.events || []).slice(0, 25),
        sampleWindow: telemetry.sampleWindow,
        readModel: {
          source: "metrics + in-process telemetry",
          avoidsCollectionScans: true,
          expectedReadsPerColdSnapshot: 51,
          snapshotCacheTtlMs: 15000,
        },
      };
    });
    res.set("Cache-Control", "no-store").json(snapshot);
  } catch (error) {
    next(error);
  }
}
