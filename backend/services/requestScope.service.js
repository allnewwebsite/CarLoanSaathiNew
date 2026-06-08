import { AsyncLocalStorage } from "async_hooks";
import { logInfo, logWarn } from "./logger.service.js";

const storage = new AsyncLocalStorage();

export function runRequestScope(req, next) {
  storage.run({
    requestId: req.requestId,
    endpoint: req.originalUrl || req.path,
    method: req.method,
    role: null,
    reads: [],
    cache: { hits: 0, misses: 0 },
    requestCache: new Map(),
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
    signature: meta.signature || `${meta.collection || "unknown"}:${meta.operation || "query"}`,
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

export function getRequestCachedValue(key) {
  const scope = storage.getStore();
  if (!scope?.requestCache || !key) return undefined;
  if (!scope.requestCache.has(key)) return undefined;
  recordCacheEvent(true);
  return scope.requestCache.get(key);
}

export function setRequestCachedValue(key, value) {
  const scope = storage.getStore();
  if (!scope?.requestCache || !key) return value;
  scope.requestCache.set(key, value);
  return value;
}

export function clearRequestCachedValue(prefix = "") {
  const scope = storage.getStore();
  if (!scope?.requestCache) return;
  for (const key of scope.requestCache.keys()) {
    if (!prefix || key.startsWith(prefix)) scope.requestCache.delete(key);
  }
}

export function flushFirestoreReadReport(meta = {}) {
  const scope = storage.getStore();
  if (!scope || (!scope.reads.length && !scope.cache.hits && !scope.cache.misses)) return;
  const totalEstimatedReads = scope.reads.reduce((sum, item) => sum + Number(item.estimatedReads || 0), 0);
  const totalCacheEvents = scope.cache.hits + scope.cache.misses;
  const cacheHitRate = totalCacheEvents ? Math.round((scope.cache.hits / totalCacheEvents) * 100) : null;
  const byCollection = scope.reads.reduce((acc, item) => {
    const key = item.collection || "unknown";
    acc[key] = (acc[key] || 0) + Number(item.estimatedReads || 0);
    return acc;
  }, {});
  const duplicateReads = Object.entries(scope.reads.reduce((acc, item) => {
    const key = item.signature || `${item.collection || "unknown"}:${item.operation || "query"}`;
    acc[key] = acc[key] || {
      collection: item.collection || "unknown",
      operation: item.operation || "query",
      count: 0,
      estimatedReads: 0,
    };
    acc[key].count += 1;
    acc[key].estimatedReads += Number(item.estimatedReads || 0);
    return acc;
  }, {}))
    .map(([, value]) => value)
    .filter((value) => value.count > 1)
    .sort((left, right) => right.estimatedReads - left.estimatedReads)
    .slice(0, 10);

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
    cacheHitRate,
    duplicateReadCount: duplicateReads.reduce((sum, item) => sum + item.count - 1, 0),
    duplicateReads,
    statusCode: meta.statusCode || null,
    durationMs: meta.durationMs || null,
    responseBytes: meta.responseBytes || null,
    byCollection,
  });
  if (duplicateReads.length) {
    logWarn("Duplicate Firestore reads detected", {
      tag: "READ-METER-DUPLICATE",
      requestId: scope.requestId,
      route: scope.endpoint,
      method: scope.method,
      role: scope.role,
      duplicateReads,
    });
  }
}
