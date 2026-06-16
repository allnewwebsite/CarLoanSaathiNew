import { createRecord, queryRecords } from "./firestore.service.js";
import { logError, logInfo, logSecurity, logWarn } from "./logger.service.js";
import { captureOperationalIncident, captureSecurityIncident } from "./monitoring.service.js";
import { recordApiMetric } from "./monitoringCenter.service.js";
import { cached } from "./ttlCache.service.js";

export const ALERT_SEVERITY = Object.freeze({
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

const defaultThresholds = {
  slowApiMs: Number(process.env.ALERT_SLOW_API_MS || 2000),
  criticalApiMs: Number(process.env.ALERT_CRITICAL_API_MS || 5000),
  queueFailedJobs: Number(process.env.ALERT_QUEUE_FAILED_JOBS || 10),
  queueBacklogJobs: Number(process.env.ALERT_QUEUE_BACKLOG_JOBS || 250),
  memoryRssMb: Number(process.env.ALERT_MEMORY_RSS_MB || 450),
  authFailureCount: Number(process.env.ALERT_AUTH_FAILURE_COUNT || 20),
};

const dedupeCache = new Map();

function dedupeKey(type, entityId) {
  return `${type}:${entityId || "global"}`;
}

function shouldEmitAlert(type, entityId) {
  const key = dedupeKey(type, entityId);
  const now = Date.now();
  const ttlMs = Number(process.env.ALERT_DEDUPE_WINDOW_MS || 5 * 60 * 1000);
  const previous = dedupeCache.get(key) || 0;
  if (now - previous < ttlMs) return false;
  dedupeCache.set(key, now);
  return true;
}

export async function recordOperationalEvent({
  type,
  severity = ALERT_SEVERITY.LOW,
  component = "platform",
  message,
  entityId = null,
  requestId = null,
  meta = {},
} = {}) {
  const payload = {
    type,
    severity,
    component,
    message,
    entityId,
    requestId,
    meta,
    environment: process.env.NODE_ENV || "development",
    release: process.env.RENDER_GIT_COMMIT || process.env.npm_package_version || "local",
    createdAt: new Date().toISOString(),
  };
  try {
    await createRecord("operationalEvents", payload);
  } catch (error) {
    logWarn("Operational event persistence failed", { type, error: error.message });
  }
  return payload;
}

export async function emitOperationalAlert(alert = {}) {
  const payload = {
    severity: alert.severity || ALERT_SEVERITY.MEDIUM,
    component: alert.component || "platform",
    type: alert.type || "operational_alert",
    title: alert.title || "Operational alert",
    message: alert.message || "Operational alert triggered",
    entityId: alert.entityId || null,
    requestId: alert.requestId || null,
    deliveryStatus: "pending",
    channels: {
      sentry: Boolean(process.env.SENTRY_DSN),
      emailReady: Boolean(process.env.ALERT_EMAIL_TO),
      slackReady: Boolean(process.env.SLACK_WEBHOOK_URL),
      whatsappReady: Boolean(process.env.ALERT_WHATSAPP_TO),
      smsReady: Boolean(process.env.ALERT_SMS_TO),
    },
    meta: alert.meta || {},
    createdAt: new Date().toISOString(),
  };
  if (!shouldEmitAlert(payload.type, payload.entityId || payload.component)) return { deduped: true, alert: payload };

  try {
    await createRecord("operationalAlerts", payload);
  } catch (error) {
    logError("Operational alert persistence failed", { type: payload.type, error: error.message });
  }

  const logFn = payload.severity === ALERT_SEVERITY.CRITICAL || payload.severity === ALERT_SEVERITY.HIGH ? logError : logWarn;
  logFn("Operational alert raised", payload);
  captureOperationalIncident(payload.title, payload);
  return { deduped: false, alert: payload };
}

export async function observeApiRequest(req, res, durationMs) {
  const statusCode = res.statusCode;
  recordApiMetric({
    method: req.method,
    endpoint: req.originalUrl,
    statusCode,
    durationMs,
    responseBytes: Number(res.getHeader("content-length") || 0) || res.locals.responseBytes || 0,
    userId: req.user?.uid,
    role: req.user?.role,
  });
  const severity = durationMs >= defaultThresholds.criticalApiMs
    ? ALERT_SEVERITY.HIGH
    : durationMs >= defaultThresholds.slowApiMs
      ? ALERT_SEVERITY.MEDIUM
      : null;

  logInfo("API request completed", {
    requestId: req.requestId,
    method: req.method,
    endpoint: req.originalUrl,
    statusCode,
    durationMs,
    userId: req.user?.uid,
    role: req.user?.role,
  });

  if (statusCode >= 500) {
    await recordOperationalEvent({
      type: "api_error",
      severity: ALERT_SEVERITY.HIGH,
      component: "api",
      message: "API request failed",
      requestId: req.requestId,
      meta: { method: req.method, endpoint: req.originalUrl, statusCode, durationMs },
    });
  }

  if (severity) {
    await emitOperationalAlert({
      type: "slow_api",
      severity,
      component: "api",
      title: "Slow API request detected",
      message: `${req.method} ${req.originalUrl} completed in ${durationMs}ms`,
      entityId: req.route?.path || req.path,
      requestId: req.requestId,
      meta: { statusCode, durationMs },
    });
  }
}

export function observeAuthFailure(req, reason = "auth_failure") {
  const meta = { requestId: req.requestId, endpoint: req.originalUrl, ip: req.ip, reason };
  logSecurity("Authentication failure", meta);
  captureSecurityIncident("Authentication failure", { ...meta, severity: "medium" });
  recordOperationalEvent({
    type: "auth_failure",
    severity: ALERT_SEVERITY.MEDIUM,
    component: "auth",
    message: "Authentication failure",
    requestId: req.requestId,
    meta,
  }).catch(() => {});
}

export async function observeQueueHealth(health) {
  if (!health?.enabled) return;
  for (const [queue, counts] of Object.entries(health.queues || {})) {
    const activeFailures = Number(counts.failedJobsLast24Hours ?? counts.failed ?? 0);
    const failedTotal = Number(counts.failedJobsTotal ?? counts.failed ?? 0);
    const historicalFailures = Number(counts.historicalFailedJobs || Math.max(failedTotal - activeFailures, 0));
    const backlog = Number(counts.waitingJobs ?? counts.waiting ?? 0) + Number(counts.delayedJobs ?? counts.delayed ?? 0);
    if (activeFailures > 0) {
      await emitOperationalAlert({
        type: "queue_failures",
        severity: activeFailures > defaultThresholds.queueFailedJobs ? ALERT_SEVERITY.HIGH : ALERT_SEVERITY.MEDIUM,
        component: "queue",
        title: "Active queue failures detected",
        message: `${queue} has ${activeFailures} failed jobs in the last 24 hours (${historicalFailures} retained historical failures)`,
        entityId: queue,
        meta: { ...counts, activeFailedLast24Hours: activeFailures, failedJobsTotal: failedTotal, historicalFailures },
      });
    }
    if (backlog >= defaultThresholds.queueBacklogJobs) {
      await emitOperationalAlert({
        type: "queue_backlog",
        severity: ALERT_SEVERITY.MEDIUM,
        component: "queue",
        title: "Queue backlog detected",
        message: `${queue} has ${backlog} pending jobs`,
        entityId: queue,
        meta: counts,
      });
    }
  }
}

export async function getOperationalDashboard({ limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return cached(`operational:dashboard:${safeLimit}:v2`, 10_000, () => getOperationalDashboardSnapshot({ limit: safeLimit }));
}

async function getOperationalDashboardSnapshot({ limit = 20 } = {}) {
  const [alerts, events] = await Promise.all([
    queryRecords("operationalAlerts", { orderBy: "createdAt", direction: "desc", limit, maxLimit: 100 }).catch(() => ({ data: [] })),
    queryRecords("operationalEvents", { orderBy: "createdAt", direction: "desc", limit, maxLimit: 100 }).catch(() => ({ data: [] })),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    thresholds: defaultThresholds,
    alerts: alerts.data,
    events: events.data,
  };
}
