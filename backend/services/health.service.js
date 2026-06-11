import os from "os";
import { firestore } from "../firebase/admin.js";
import { getGlobalMetrics } from "./analyticsEngine.service.js";
import { getOperationalDashboard, observeQueueHealth } from "./observability.service.js";
import { queueEnabled, queueHealth } from "./queue.service.js";

let workerState = {
  queueWorkersRegisteredAt: null,
  scheduledOperationsRegisteredAt: null,
  notificationWorkerLastRunAt: null,
  whatsappWorkerLastRunAt: null,
  lastWorkerError: null,
};

export function markWorkerHealth(key, value = new Date().toISOString()) {
  workerState = { ...workerState, [key]: value };
}

async function checkFirestore() {
  if (!firestore) return { status: "memory-fallback", latencyMs: 0 };
  const started = Date.now();
  await firestore.collection("systemCounters").doc("__health").get();
  return { status: "ok", latencyMs: Date.now() - started };
}

async function checkMetricsEngine() {
  const started = Date.now();
  await getGlobalMetrics();
  return { status: "ok", latencyMs: Date.now() - started };
}

function memoryHealth() {
  const memory = process.memoryUsage();
  const rssMb = Math.round(memory.rss / 1024 / 1024);
  const heapUsedMb = Math.round(memory.heapUsed / 1024 / 1024);
  const thresholdMb = Number(process.env.ALERT_MEMORY_RSS_MB || 450);
  return {
    status: rssMb >= thresholdMb ? "degraded" : "ok",
    rssMb,
    heapUsedMb,
    thresholdMb,
  };
}

function cpuHealth() {
  return {
    loadAverage: os.loadavg(),
    cpuCount: os.cpus().length,
  };
}

function scoreStatus(checks) {
  if (checks.some((item) => item?.status === "down")) return "down";
  if (checks.some((item) => item?.status === "degraded")) return "degraded";
  return "ok";
}

export async function productionHealth({ deep = false } = {}) {
  const base = {
    service: "CarLoanSaathi API",
    environment: process.env.NODE_ENV || "development",
    release: process.env.RENDER_GIT_COMMIT || process.env.npm_package_version || "local",
    uptimeSeconds: Math.round(process.uptime()),
    generatedAt: new Date().toISOString(),
    memory: memoryHealth(),
    cpu: cpuHealth(),
    workers: workerState,
  };

  const queue = await queueHealth().catch((error) => ({ enabled: queueEnabled(), status: "down", error: error.message }));
  await observeQueueHealth(queue).catch(() => {});

  const checks = {
    firestore: deep ? await checkFirestore().catch((error) => ({ status: "down", error: error.message })) : { status: "skipped" },
    redisQueues: queue,
    metricsEngine: deep ? await checkMetricsEngine().catch((error) => ({ status: "degraded", error: error.message })) : { status: "skipped" },
    scheduler: {
      status: process.env.ENABLE_SCHEDULED_OPERATIONS === "true" ? "enabled" : "disabled",
      registeredAt: workerState.scheduledOperationsRegisteredAt,
    },
    notifications: {
      status: process.env.DISABLE_NOTIFICATION_WORKER === "true" ? "disabled" : "enabled",
      lastRunAt: workerState.notificationWorkerLastRunAt,
    },
    archival: {
      status: process.env.ENABLE_SCHEDULED_OPERATIONS === "true" ? "scheduled" : "manual",
    },
  };

  return {
    status: scoreStatus([base.memory, checks.firestore, checks.metricsEngine, queue]),
    ...base,
    checks,
  };
}

export async function observabilitySnapshot() {
  const [health, dashboard] = await Promise.all([
    productionHealth({ deep: true }),
    getOperationalDashboard({ limit: 25 }),
  ]);
  return {
    health,
    dashboard,
  };
}
