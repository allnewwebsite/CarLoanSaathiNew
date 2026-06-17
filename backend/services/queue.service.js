import { Queue, Worker, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { logError, logInfo, logWarn } from "./logger.service.js";
import { createRecord } from "./firestore.service.js";
import { captureBackendError, captureOperationalIncident } from "./monitoring.service.js";
import { cached } from "./ttlCache.service.js";

export const QUEUE_NAMES = Object.freeze({
  NOTIFICATIONS: "notifications",
  METRICS: "metrics-aggregation",
  EMAIL: "email-jobs",
  WHATSAPP: "whatsapp-jobs",
  CLEANUP: "cleanup-jobs",
  BILLING: "billing-jobs",
});

const priorityMap = { critical: 1, high: 2, medium: 5, low: 9 };
const queues = new Map();
const workers = new Map();
let redisConnection = null;
let queueDisabledLogged = false;
const queueCircuitBreakers = new Map();
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function queueHealthSampleLimit() {
  return Math.max(1, Math.min(Number(process.env.QUEUE_HEALTH_FAILED_SAMPLE_LIMIT || 500), 1000));
}

function timestampFromJob(job) {
  const timestamp = Number(job?.finishedOn || job?.processedOn || job?.timestamp || 0);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function isoFromTimestamp(timestamp) {
  return timestamp ? new Date(timestamp).toISOString() : null;
}

function queueStatusForRecentFailures(failedJobsLast24Hours) {
  if (failedJobsLast24Hours > 10) return "critical";
  if (failedJobsLast24Hours > 0) return "warning";
  return "healthy";
}

function aggregateQueueStatus(queueItems) {
  if (queueItems.some((item) => item.status === "critical")) return "critical";
  if (queueItems.some((item) => item.status === "warning")) return "warning";
  return "healthy";
}

function isWorkerConnected(name) {
  const worker = workers.get(name);
  if (!worker) return false;
  if (typeof worker.isRunning === "function") return Boolean(worker.isRunning());
  return true;
}

async function getLatestCompletedTimestamp(queue) {
  try {
    const completed = typeof queue.getCompleted === "function"
      ? await queue.getCompleted(0, 0)
      : await queue.getJobs(["completed"], 0, 0, false);
    return isoFromTimestamp(timestampFromJob(completed?.[0]));
  } catch (error) {
    logWarn("Queue completed job health sample failed", { queue: queue.name, error: error.message });
    return null;
  }
}

async function getFailureSummary(queue, failedJobsTotal) {
  const sampleLimit = Math.min(failedJobsTotal, queueHealthSampleLimit());
  if (sampleLimit <= 0) {
    return {
      failedJobsLastHour: 0,
      failedJobsLast24Hours: 0,
      historicalFailedJobs: 0,
      oldestFailedJobTimestamp: null,
      newestFailedJobTimestamp: null,
      latestFailedReason: null,
      latestFailedJobId: null,
      failureSampleSize: 0,
      failureSampleLimited: false,
    };
  }

  try {
    const failedJobs = typeof queue.getFailed === "function"
      ? await queue.getFailed(0, sampleLimit - 1)
      : await queue.getJobs(["failed"], 0, sampleLimit - 1, false);
    const now = Date.now();
    const failedTimes = failedJobs.map(timestampFromJob).filter(Boolean);
    const failedJobsLastHour = failedTimes.filter((timestamp) => now - timestamp <= HOUR_MS).length;
    const failedJobsLast24Hours = failedTimes.filter((timestamp) => now - timestamp <= DAY_MS).length;
    const oldestFailedTimestamp = failedTimes.length ? Math.min(...failedTimes) : null;
    const newestFailedTimestamp = failedTimes.length ? Math.max(...failedTimes) : null;
    const newestJob = failedJobs
      .map((job) => ({ job, timestamp: timestampFromJob(job) || 0 }))
      .sort((a, b) => b.timestamp - a.timestamp)[0]?.job;

    return {
      failedJobsLastHour,
      failedJobsLast24Hours,
      historicalFailedJobs: Math.max(failedJobsTotal - failedJobsLast24Hours, 0),
      oldestFailedJobTimestamp: isoFromTimestamp(oldestFailedTimestamp),
      newestFailedJobTimestamp: isoFromTimestamp(newestFailedTimestamp),
      latestFailedReason: newestJob?.failedReason || newestJob?.stacktrace?.[0] || null,
      latestFailedJobId: newestJob?.id || null,
      failureSampleSize: failedJobs.length,
      failureSampleLimited: failedJobsTotal > failedJobs.length,
    };
  } catch (error) {
    logWarn("Queue failed job health sample failed", { queue: queue.name, error: error.message });
    return {
      failedJobsLastHour: 0,
      failedJobsLast24Hours: 0,
      historicalFailedJobs: failedJobsTotal,
      oldestFailedJobTimestamp: null,
      newestFailedJobTimestamp: null,
      latestFailedReason: null,
      latestFailedJobId: null,
      failureSampleSize: 0,
      failureSampleLimited: true,
      failureSampleError: error.message,
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cooldownMsForError(error) {
  const message = String(error?.message || error || "");
  if (/RESOURCE_EXHAUSTED|quota exceeded/i.test(message)) {
    return Number(process.env.FIRESTORE_QUOTA_COOLDOWN_MS || 5 * 60 * 1000);
  }
  if (/Firestore query timed out/i.test(message)) {
    return Number(process.env.FIRESTORE_TIMEOUT_COOLDOWN_MS || 60 * 1000);
  }
  return 0;
}

async function waitForQueueCircuit(name) {
  const breaker = queueCircuitBreakers.get(name);
  const waitMs = Number(breaker?.until || 0) - Date.now();
  if (waitMs <= 0) return;
  await sleep(Math.min(waitMs, Number(process.env.QUEUE_CIRCUIT_MAX_WAIT_MS || 30_000)));
}

export function queueEnabled() {
  return process.env.ENABLE_REDIS_QUEUE === "true" && Boolean(process.env.REDIS_URL);
}

function queueDisabledReason() {
  if (!process.env.REDIS_URL) return "REDIS_URL is not configured";
  if (process.env.ENABLE_REDIS_QUEUE !== "true") return "ENABLE_REDIS_QUEUE is not true";
  return "Redis queue disabled";
}

function connection() {
  if (!queueEnabled()) return null;
  if (!redisConnection) {
    redisConnection = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    redisConnection.on("error", (error) => {
      logWarn("Redis queue connection error", { error: error.message });
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
    jobId: options.jobId || payload.jobId || undefined,
    priority: priorityMap[options.priority || payload.priority] || priorityMap.medium,
    delay: Number(options.delay || 0),
  });
  return { queued: true, jobId: job.id };
}

export function registerWorker(name, processor, { concurrency = 5 } = {}) {
  if (!queueEnabled() || workers.has(name)) return null;
  const worker = new Worker(name, async (job) => {
    await waitForQueueCircuit(name);
    try {
      return await processor(job.data, job);
    } catch (error) {
      const cooldownMs = cooldownMsForError(error);
      if (cooldownMs > 0) {
        const until = Date.now() + cooldownMs;
        queueCircuitBreakers.set(name, { until, reason: error.message });
        logWarn("Queue cooldown opened", {
          queue: name,
          jobId: job.id,
          cooldownMs,
          reason: error.message,
          resumeAt: new Date(until).toISOString(),
        });
      }
      throw error;
    }
  }, {
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
  return cached("queue:health:v2", Number(process.env.QUEUE_HEALTH_CACHE_TTL_MS || 10_000), queueHealthSnapshot);
}

async function queueHealthSnapshot() {
  if (!queueEnabled()) {
    return {
      enabled: false,
      status: "local-fallback",
      reason: queueDisabledReason(),
      redisUrlConfigured: Boolean(process.env.REDIS_URL),
      generatedAt: new Date().toISOString(),
    };
  }
  const entries = await Promise.all(Object.values(QUEUE_NAMES).map(async (name) => {
    const queue = getQueue(name);
    const [counts, paused, lastSuccessfulJobTimestamp] = await Promise.all([
      queue.getJobCounts("waiting", "active", "failed", "delayed"),
      typeof queue.isPaused === "function" ? queue.isPaused().catch(() => false) : Promise.resolve(false),
      getLatestCompletedTimestamp(queue),
    ]);
    const failedJobsTotal = Number(counts.failed || 0);
    const failureSummary = await getFailureSummary(queue, failedJobsTotal);
    const status = queueStatusForRecentFailures(failureSummary.failedJobsLast24Hours);
    return [name, {
      queueName: name,
      failedJobsTotal,
      failedJobsLastHour: failureSummary.failedJobsLastHour,
      failedJobsLast24Hours: failureSummary.failedJobsLast24Hours,
      historicalFailedJobs: failureSummary.historicalFailedJobs,
      oldestFailedJobTimestamp: failureSummary.oldestFailedJobTimestamp,
      newestFailedJobTimestamp: failureSummary.newestFailedJobTimestamp,
      latestFailedReason: failureSummary.latestFailedReason,
      latestFailedJobId: failureSummary.latestFailedJobId,
      lastSuccessfulJobTimestamp,
      waitingJobs: Number(counts.waiting || 0),
      activeJobs: Number(counts.active || 0),
      delayedJobs: Number(counts.delayed || 0),
      paused,
      workerConnected: isWorkerConnected(name),
      status,
      statusReason: status === "healthy"
        ? "No failures in the last 24 hours"
        : `${failureSummary.failedJobsLast24Hours} failures in the last 24 hours`,
      failureSampleSize: failureSummary.failureSampleSize,
      failureSampleLimited: failureSummary.failureSampleLimited,
      failureSampleError: failureSummary.failureSampleError || null,
    }];
  }));
  const health = Object.fromEntries(entries);
  return {
    enabled: true,
    status: aggregateQueueStatus(Object.values(health)),
    generatedAt: new Date().toISOString(),
    healthRules: {
      healthy: "No failures in last 24 hours",
      warning: "1-10 failures in last 24 hours",
      critical: "More than 10 failures in last 24 hours",
    },
    queues: health,
  };
}

export function logQueueDisabled() {
  if (queueEnabled() || queueDisabledLogged) return;
  queueDisabledLogged = true;
  logWarn("Redis queue disabled; using in-process async fallback", {
    env: process.env.NODE_ENV,
    reason: queueDisabledReason(),
    redisUrlConfigured: Boolean(process.env.REDIS_URL),
  });
}
