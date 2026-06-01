import { logWarn, logInfo } from "./logger.service.js";

export const QUERY_LIMITS = Object.freeze({
  defaultLimit: 20,
  dashboardLimit: 50,
  maxLimit: Number(process.env.FIRESTORE_MAX_PAGE_SIZE || 100),
  timeoutMs: Number(process.env.FIRESTORE_QUERY_TIMEOUT_MS || 8000),
  slowQueryMs: Number(process.env.FIRESTORE_SLOW_QUERY_MS || 1200),
});

const leadScopeFields = new Set(["dealershipId", "bankId", "assignedExecutiveId", "assignedExecutiveEmail", "caseId"]);

export function clampQueryLimit(limit, fallback = QUERY_LIMITS.defaultLimit) {
  const parsed = Number(limit || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), QUERY_LIMITS.maxLimit);
}

export function assertLeadQueryScoped(where = [], { allowGlobal = false } = {}) {
  if (allowGlobal) return true;
  const scoped = where.some((clause) => leadScopeFields.has(clause.field) && clause.value);
  if (!scoped) {
    const error = new Error("Lead query must be tenant scoped");
    error.status = 400;
    error.code = "UNSCOPED_LEAD_QUERY";
    throw error;
  }
  return true;
}

export async function withQueryMonitoring({ collection, operation = "query", where = [], limit }, executor) {
  const started = Date.now();
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(`Firestore ${operation} timed out`);
      error.status = 503;
      error.code = "FIRESTORE_QUERY_TIMEOUT";
      reject(error);
    }, QUERY_LIMITS.timeoutMs);
  });

  try {
    const result = await Promise.race([executor(), timeoutPromise]);
    const durationMs = Date.now() - started;
    const meta = {
      collection,
      operation,
      durationMs,
      limit,
      where: where.map((clause) => ({ field: clause.field, op: clause.op || "==" })),
    };
    if (durationMs >= QUERY_LIMITS.slowQueryMs) {
      logWarn("Slow Firestore query", meta);
    }
    if (collection === "leads" && operation === "query") {
      logInfo("Firestore query executed", meta);
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}
