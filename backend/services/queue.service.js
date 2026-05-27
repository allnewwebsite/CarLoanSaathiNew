import { Queue, Worker, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { logError, logInfo, logWarn } from "./logger.service.js";
import { createRecord } from "./firestore.service.js";
import { captureBackendError, captureOperationalIncident } from "./monitoring.service.js";

export const QUEUE_NAMES = Object.freeze({
  NOTIFICATIONS: "notifications",
  SLA: "sla-jobs",
  ARCHIVAL: "archival-jobs",
  METRICS: "metrics-aggregation",
  EMAIL: "email-jobs",
  WHATSAPP: "whatsapp-jobs",
  CLEANUP: "cleanup-jobs",
});

const priorityMap = { critical: 1, high: 2, medium: 5, low: 9 };
const queues = new Map();
const workers = new Map();
let redisConnection = null;

export function queueEnabled() {
  return Boolean(process.env.REDIS_URL);
}

function connection() {
  if (!queueEnabled()) return null;
  if (!redisConnection) {
    redisConnection = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
  }
  return redisConnection;
}

export function getQueue(name) {
  if (!queueEnabled()) return null;
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, {
      connection: connection(),
      defaultJobOptions: {
        attempts: Number(process.env.QUEUE_MAX_ATTEMPTS || 5),
        backoff: { type: "exponential", delay: Number(process.env.QUEUE_BACKOFF_MS || 60_000) },
        removeOnComplete: { age: Number(process.env.QUEUE_COMPLETE_TTL_SECONDS || 86_400), count: 1000 },
        removeOnFail: { age: Number(process.env.QUEUE_FAILED_TTL_SECONDS || 604_800) },
      },
    }));
  }
  return queues.get(name);
}

export async function addQueueJob(name, jobName, payload = {}, options = {}) {
  const queue = getQueue(name);
  if (!queue) {
    queueMicrotask(async () => {
      if (typeof options.fallback === "function") {
        try {
          await options.fallback(payload);
        } catch (error) {
          logError("Local fallback queue job failed", { queue: name, jobName, error: error.message });
          captureBackendError(error, { component: "queue-fallback", queue: name, jobName, severity: "high" });
        }
      }
    });
    return { queued: false, fallback: true };
  }
  const job = await queue.add(jobName, payload, {
    priority: priorityMap[options.priority || payload.priority] || priorityMap.medium,
    delay: Number(options.delay || 0),
  });
  return { queued: true, jobId: job.id };
}

export function registerWorker(name, processor, { concurrency = 5 } = {}) {
  if (!queueEnabled() || workers.has(name)) return null;
  const worker = new Worker(name, async (job) => processor(job.data, job), {
    connection: connection(),
    concurrency: Number(process.env[`QUEUE_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_CONCURRENCY`] || concurrency),
  });
  const events = new QueueEvents(name, { connection: connection() });
  events.on("failed", ({ jobId, failedReason }) => {
    logError("Queue job failed", { queue: name, jobId, failedReason });
    captureOperationalIncident("Queue job failed", {
      component: "queue",
      incidentType: "queue_failure",
      severity: "high",
      queue: name,
      jobId,
      failedReason,
    });
    createRecord("operationalMetrics", { type: "queue_failed", queue: name, jobId, failedReason, recordedAt: new Date().toISOString() }).catch(() => {});
  });
  events.on("completed", ({ jobId }) => {
    logInfo("Queue job completed", { queue: name, jobId });
  });
  worker.on("error", (error) => {
    logError("Queue worker error", { queue: name, error: error.message });
    captureBackendError(error, { component: "queue-worker", queue: name, severity: "critical" });
  });
  workers.set(name, worker);
  logInfo("Queue worker registered", { queue: name });
  return worker;
}

export async function queueHealth() {
  if (!queueEnabled()) return { enabled: false, status: "local-fallback" };
  const health = {};
  for (const name of Object.values(QUEUE_NAMES)) {
    const queue = getQueue(name);
    health[name] = await queue.getJobCounts("waiting", "active", "failed", "delayed");
  }
  return { enabled: true, queues: health };
}

export function logQueueDisabled() {
  if (!queueEnabled()) logWarn("Redis queue disabled; using in-process async fallback", { env: process.env.NODE_ENV });
}
