import { AsyncLocalStorage } from "async_hooks";
import { logInfo } from "./logger.service.js";

const storage = new AsyncLocalStorage();

export function runRequestScope(req, next) {
  storage.run({
    requestId: req.requestId,
    endpoint: req.originalUrl || req.path,
    method: req.method,
    role: null,
    reads: [],
    cache: { hits: 0, misses: 0 },
  }, next);
}

export function setRequestScopeUser(user = {}) {
  const scope = storage.getStore();
  if (!scope) return;
  scope.role = user.role || null;
  scope.userId = user.uid || user.email || null;
}

export function recordFirestoreRead(meta = {}) {
  const scope = storage.getStore();
  if (!scope) return;
  scope.reads.push({
    collection: meta.collection,
    operation: meta.operation || "query",
    documentsReturned: Number(meta.documentsReturned || 0),
    estimatedReads: Number(meta.estimatedReads || meta.documentsReturned || 0),
    limit: meta.limit || null,
  });
}

export function recordCacheEvent(hit = false) {
  const scope = storage.getStore();
  if (!scope) return;
  if (hit) scope.cache.hits += 1;
  else scope.cache.misses += 1;
}

export function flushFirestoreReadReport(meta = {}) {
  const scope = storage.getStore();
  if (!scope || (!scope.reads.length && !scope.cache.hits && !scope.cache.misses)) return;
  const totalEstimatedReads = scope.reads.reduce((sum, item) => sum + Number(item.estimatedReads || 0), 0);
  const byCollection = scope.reads.reduce((acc, item) => {
    const key = item.collection || "unknown";
    acc[key] = (acc[key] || 0) + Number(item.estimatedReads || 0);
    return acc;
  }, {});
  logInfo("Firestore read meter", {
    tag: "READ-METER",
    requestId: scope.requestId,
    route: scope.endpoint,
    endpoint: scope.endpoint,
    method: scope.method,
    role: scope.role,
    queryCount: scope.reads.length,
    totalEstimatedReads,
    cacheHit: scope.cache.hits,
    cacheMiss: scope.cache.misses,
    statusCode: meta.statusCode || null,
    durationMs: meta.durationMs || null,
    responseBytes: meta.responseBytes || null,
    byCollection,
  });
}
