import { getRequestScope } from "./requestScope.service.js";
import { logInfo } from "./logger.service.js";

const ROUTE_PREFIX = "/api/realtime/ticket";

function now() {
  return Date.now();
}

function scopeState() {
  const scope = getRequestScope();
  if (!scope || scope.method !== "POST" || !String(scope.endpoint || "").startsWith(ROUTE_PREFIX)) return null;
  scope.realtimeTicketLatency = scope.realtimeTicketLatency || {
    startedAt: now(),
    steps: [],
    summary: {
      authDurationMs: 0,
      sessionDurationMs: 0,
      userLookupDurationMs: 0,
      dealershipLookupDurationMs: 0,
      permissionDurationMs: 0,
      ticketGenerationDurationMs: 0,
      tokenGenerationDurationMs: 0,
      firestoreDurationMs: 0,
      cacheDurationMs: 0,
      responseCreationDurationMs: 0,
    },
  };
  return { scope, state: scope.realtimeTicketLatency };
}

export function realtimeTicketTimingEnabled() {
  return Boolean(scopeState());
}

export function markRealtimeTicketStart() {
  scopeState();
}

export function logRealtimeTicketStep(step, durationMs, meta = {}) {
  const context = scopeState();
  if (!context) return;
  const { scope, state } = context;
  const roundedDuration = Math.max(0, Math.round(Number(durationMs || 0)));
  const entry = {
    requestId: scope.requestId,
    step,
    durationMs: roundedDuration,
    ...meta,
  };
  state.steps.push(entry);
  const field = meta.summaryField;
  if (field && Object.prototype.hasOwnProperty.call(state.summary, field)) {
    state.summary[field] += roundedDuration;
  }
  if (meta.firestore === true) state.summary.firestoreDurationMs += roundedDuration;
  if (meta.cacheStatus) state.summary.cacheDurationMs += roundedDuration;
  logInfo("Realtime ticket latency step", {
    tag: "REALTIME-TICKET-LATENCY",
    ...entry,
  });
}

export async function measureRealtimeTicketStep(step, fn, meta = {}) {
  const startedAt = now();
  try {
    return await fn();
  } finally {
    logRealtimeTicketStep(step, now() - startedAt, meta);
  }
}

export function measureRealtimeTicketSync(step, fn, meta = {}) {
  const startedAt = now();
  try {
    return fn();
  } finally {
    logRealtimeTicketStep(step, now() - startedAt, meta);
  }
}

export function logRealtimeTicketSummary(meta = {}) {
  const context = scopeState();
  if (!context) return;
  const { scope, state } = context;
  const totalDurationMs = Math.max(0, now() - state.startedAt);
  const slowest = [...state.steps].sort((left, right) => right.durationMs - left.durationMs)[0] || null;
  logInfo("Realtime ticket latency summary", {
    tag: "REALTIME-TICKET-LATENCY",
    requestId: scope.requestId,
    step: "summary",
    ...state.summary,
    totalDurationMs,
    slowestOperation: slowest?.step || null,
    slowestDurationMs: slowest?.durationMs || 0,
    slowestPercentOfTotal: totalDurationMs ? Math.round(((slowest?.durationMs || 0) / totalDurationMs) * 100) : 0,
    ...meta,
  });
}
