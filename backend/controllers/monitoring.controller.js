import { getGlobalMetrics } from "../services/analyticsEngine.service.js";
import { productionHealth } from "../services/health.service.js";
import { monitoringTelemetrySummary } from "../services/monitoringCenter.service.js";
import { getOperationalDashboard } from "../services/observability.service.js";
import { realtimeStats } from "../services/realtime.service.js";
import { cached } from "../services/ttlCache.service.js";

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
      const [health, operational, metrics] = await Promise.all([
        productionHealth({ deep: true }),
        getOperationalDashboard({ limit: 20 }),
        getGlobalMetrics(),
      ]);
      const telemetry = monitoringTelemetrySummary({ realtimeStats: currentRealtimeStats });
      const activeUsers = telemetry.realtime.activeSseConnections;
      const queueMonitoring = buildQueueMonitoring(health.checks?.redisQueues);
      const healthCards = {
        systemStatus: card(health.status, `${health.environment} / uptime ${health.uptimeSeconds}s`),
        apiHealth: card(telemetry.statuses.api, `p95 ${telemetry.api.p95Ms}ms`),
        realtimeStatus: card(telemetry.statuses.realtime, `${telemetry.realtime.activeSseConnections} SSE clients`),
        projectionHealth: card(telemetry.statuses.projection, telemetry.projection.projectionHitRate === null ? "No projection samples yet" : `${telemetry.projection.projectionHitRate}% hit rate`),
        cacheHealth: card(telemetry.statuses.cache, telemetry.cache.hitRate === null ? "No cache samples yet" : `${telemetry.cache.hitRate}% hit rate`),
        firestoreHealth: card(health.checks?.firestore?.status === "ok" ? telemetry.statuses.firestore : health.checks?.firestore?.status, `${health.checks?.firestore?.latencyMs ?? 0}ms health read`),
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
          slowRequestCount: telemetry.api.slowRequestCount,
          apiErrorCount: telemetry.api.errorCount,
        },
        firestoreMonitoring: telemetry.firestore,
        projectionHealth: telemetry.projection,
        realtimeMonitoring: telemetry.realtime,
        branchMonitoring: {
          totalBanks: metrics.activeBanks || metrics.bankPartners || 0,
          totalBranches: metrics.totalBranches || 0,
          disabledBranches: metrics.disabledBranches || 0,
          branchesByState: telemetry.branches.branchesByState,
          branchesByLocation: telemetry.branches.branchesByLocation,
          ifscDuplicates: telemetry.branches.ifscDuplicates,
          realtimeSyncEvents: telemetry.branches.realtimeSyncEvents,
          branchCreationEvents: telemetry.branches.branchCreationEvents,
          branchUpdateEvents: telemetry.branches.branchUpdateEvents,
        },
        cacheMonitoring: telemetry.cache,
        queueMonitoring,
        systemAlerts: buildAlerts({ telemetry, operational, queueMonitoring }),
        operationalEvents: (operational.events || []).slice(0, 10),
        sampleWindow: telemetry.sampleWindow,
        readModel: {
          source: "metrics + in-process telemetry",
          avoidsCollectionScans: true,
          expectedReadsPerColdSnapshot: 43,
          snapshotCacheTtlMs: 15000,
        },
      };
    });
    res.set("Cache-Control", "no-store").json(snapshot);
  } catch (error) {
    next(error);
  }
}
