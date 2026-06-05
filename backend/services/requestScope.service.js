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

export function flushFirestoreReadReport() {
  const scope = storage.getStore();
  if (!scope || !scope.reads.length) return;
  const totalEstimatedReads = scope.reads.reduce((sum, item) => sum + Number(item.estimatedReads || 0), 0);
  const byCollection = scope.reads.reduce((acc, item) => {
    const key = item.collection || "unknown";
    acc[key] = (acc[key] || 0) + Number(item.estimatedReads || 0);
    return acc;
  }, {});
  logInfo("Firestore read meter", {
    requestId: scope.requestId,
    endpoint: scope.endpoint,
    method: scope.method,
    role: scope.role,
    queryCount: scope.reads.length,
    totalEstimatedReads,
    byCollection,
  });
}
