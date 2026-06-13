import { addQueueJob, QUEUE_NAMES } from "./queue.service.js";
import { archiveClosedLeads, cleanupExpiredNotifications } from "./archival.service.js";
import { validateMetricsIntegrity } from "./metricsBackfill.service.js";
import { validateProjectionFreshness } from "./projection.service.js";
import { logInfo, logWarn } from "./logger.service.js";
import { markWorkerHealth } from "./health.service.js";
import { processSubscriptionLifecycle } from "./subscription.service.js";
import { reconcileSubscriptionPayments } from "./paymentReconciliation.service.js";

const scheduled = [];

function schedule(name, intervalMs, task) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
  const timer = setInterval(() => {
    Promise.resolve()
      .then(task)
      .catch((error) => {
        markWorkerHealth("lastWorkerError", { name, error: error.message, at: new Date().toISOString() });
        logWarn("Scheduled job failed", { name, error: error.message });
      });
  }, intervalMs);
  timer.unref();
  scheduled.push({ name, intervalMs, timer });
  logInfo("Scheduled job registered", { name, intervalMs });
}

export function registerScheduledOperations() {
  if (process.env.ENABLE_SUBSCRIPTION_BILLING === "true" && process.env.ENABLE_PAYMENT_RECONCILIATION !== "false") {
    const reconciliationTask = () => addQueueJob(QUEUE_NAMES.BILLING, "payment-reconciliation", {}, {
      priority: "high",
      fallback: reconcileSubscriptionPayments,
    });
    schedule("payment-reconciliation", Number(process.env.PAYMENT_RECONCILIATION_INTERVAL_MS || 15 * 60 * 1000), reconciliationTask);
    Promise.resolve().then(reconciliationTask).catch((error) => {
      logWarn("Initial payment reconciliation failed", { error: error.message });
    });
  }

  if (process.env.ENABLE_SCHEDULED_OPERATIONS !== "true") {
    logInfo("Scheduled operations disabled");
    return scheduled;
  }

  markWorkerHealth("scheduledOperationsRegisteredAt");

  schedule("notification-cleanup", Number(process.env.NOTIFICATION_CLEANUP_INTERVAL_MS || 6 * 60 * 60 * 1000), () => (
    addQueueJob(QUEUE_NAMES.CLEANUP, "notification-cleanup", {}, { fallback: cleanupExpiredNotifications })
  ));

  schedule("lead-archival", Number(process.env.ARCHIVAL_INTERVAL_MS || 24 * 60 * 60 * 1000), () => (
    addQueueJob(QUEUE_NAMES.ARCHIVAL, "lead-archival", {}, { priority: "low", fallback: archiveClosedLeads })
  ));

  schedule("metrics-integrity", Number(process.env.METRICS_INTEGRITY_INTERVAL_MS || 60 * 60 * 1000), validateMetricsIntegrity);

  schedule("projection-freshness", Number(process.env.PROJECTION_FRESHNESS_INTERVAL_MS || 10 * 60 * 1000), validateProjectionFreshness);

  schedule("subscription-lifecycle", Number(process.env.SUBSCRIPTION_LIFECYCLE_INTERVAL_MS || 6 * 60 * 60 * 1000), processSubscriptionLifecycle);
  return scheduled;
}
