import { firestore } from "../firebase/admin.js";
import { assertCompositeIndexFallbackAllowed, assertLeadQueryScoped, assertPaginationSafe, clampQueryLimit, withQueryMonitoring } from "./queryGovernance.service.js";
import { logInfo, logWarn } from "./logger.service.js";
import { recordFirestoreRead } from "./requestScope.service.js";
import { logRealtimeTicketStep } from "./realtimeTicketLatency.service.js";
import { getRecord } from "./firestoreCore.service.js";
import {
  DIAGNOSTIC_QUERY_COLLECTIONS,
  DIRECT_ID_ONLY_COLLECTIONS,
  getRequestReadCache,
  hashValue,
  memoryStore,
  PRODUCTION_FULL_SCAN_DENYLIST,
  readCacheKey,
  readSignature,
  setRequestReadCache,
  whereSignature,
  withLeadCaseIds,
} from "./firestoreShared.service.js";

export async function listRecords(collection) {
  if (process.env.NODE_ENV === "production" && (collection === "leads" || PRODUCTION_FULL_SCAN_DENYLIST.has(collection)) && process.env.ALLOW_FIRESTORE_FULL_SCAN !== "true") {
    const error = new Error(`Unbounded ${collection} reads are disabled in production`);
    error.status = 400;
    error.code = "UNBOUNDED_FIRESTORE_READ_DISABLED";
    throw error;
  }
  if (process.env.NODE_ENV === "production") {
    logWarn("Unbounded Firestore listRecords used", { collection });
  }
  if (!firestore) return memoryStore[collection] || [];
  const snapshot = await firestore.collection(collection).get();
  recordFirestoreRead({ collection, operation: "list", signature: readSignature(collection, "list"), documentsReturned: snapshot.size, estimatedReads: snapshot.size });
  const pairs = snapshot.docs
    .map((doc) => ({ doc, record: { id: doc.id, ...doc.data() } }))
    .sort((left, right) => String(right.record.createdAt || "").localeCompare(String(left.record.createdAt || "")));
  const records = pairs.map((pair) => pair.record);
  if (collection === "leads") return withLeadCaseIds(records, pairs.map((pair) => pair.doc));
  return records;
}

export async function findRecordsByField(collection, field, value, limit = 10) {
  if (!field || value === undefined || value === null) return [];
  const startedAt = Date.now();
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 25);
  const cacheKey = readCacheKey(collection, "find", { field, value, safeLimit });
  const cachedRows = getRequestReadCache(cacheKey);
  if (cachedRows !== undefined) {
    logRealtimeTicketStep(`firestore_find_cache:${collection}`, Date.now() - startedAt, { collection, operation: "find", cacheStatus: "request-cache-hit" });
    return cachedRows;
  }
  if (!firestore) return (memoryStore[collection] || []).filter((item) => item[field] === value).slice(0, safeLimit);
  try {
    const snapshot = await firestore.collection(collection).where(field, "==", value).limit(safeLimit).get();
    recordFirestoreRead({
      collection,
      operation: "find",
      signature: readSignature(collection, "find", [[field, "==", hashValue(value)], ["limit", safeLimit]]),
      documentsReturned: snapshot.size,
      estimatedReads: snapshot.size,
      limit: safeLimit,
    });
    return setRequestReadCache(cacheKey, snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  } finally {
    logRealtimeTicketStep(`firestore_find:${collection}`, Date.now() - startedAt, { collection, operation: "find", firestore: true });
  }
}

export async function findFirstRecordByFields(collection, fields = {}, limit = 5) {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!entries.length) return null;
  if (!firestore) {
    return (memoryStore[collection] || []).find((item) => entries.some(([field, value]) => item[field] === value || (field === "id" && item.id === value))) || null;
  }
  const directId = fields.id ? await getRecord(collection, fields.id).catch(() => null) : null;
  if (directId) return directId;
  const pages = await Promise.all(entries
    .filter(([field]) => field !== "id")
    .map(([field, value]) => findRecordsByField(collection, field, value, limit).catch(() => [])));
  return pages.flat()[0] || null;
}

export async function listRecentRecords(collection, { limit = 50, orderBy = "createdAt", direction = "desc", fields = [] } = {}) {
  return queryRecords(collection, {
    orderBy,
    direction,
    limit,
    maxLimit: Math.min(Math.max(Number(limit) || 50, 1), 500),
    fields,
  }).then((page) => page.data);
}

function parseCursor(cursor) {
  if (!cursor) return null;
  try {
    return JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function encodeCursor(record, orderByField) {
  if (!record) return null;
  const value = record[orderByField] || record.createdAt || record.updatedAt || "";
  return Buffer.from(JSON.stringify({ value, id: record.id })).toString("base64url");
}

function applyMemoryWhere(records, whereClauses = []) {
  return records.filter((record) => whereClauses.every(({ field, op = "==", value }) => {
    if (op === "==") return record[field] === value;
    if (op === "in") return Array.isArray(value) && value.includes(record[field]);
    if (op === ">") return record[field] > value;
    if (op === ">=") return record[field] >= value;
    if (op === "<") return record[field] < value;
    if (op === "<=") return record[field] <= value;
    return true;
  }));
}

function applySearch(records, search, fields = []) {
  const needle = String(search || "").trim().toLowerCase();
  if (!needle) return records;
  return records.filter((record) => fields.some((field) => String(record[field] || "").toLowerCase().includes(needle)));
}

function selectFields(record, fields = []) {
  if (!fields.length) return record;
  return fields.reduce((next, field) => {
    if (Object.prototype.hasOwnProperty.call(record, field)) next[field] = record[field];
    return next;
  }, { id: record.id });
}

function isMissingCompositeIndexError(error) {
  return Number(error?.code) === 9
    || String(error?.message || "").includes("FAILED_PRECONDITION")
    || String(error?.message || "").includes("requires an index");
}

async function fallbackIndexedQuery({ collection, where, orderBy, direction, safeLimit, parsedCursor, offset = 0, search, searchFields, fields, maxLimit }) {
  const startedAt = Date.now();
  logWarn("Firestore composite index missing; using scoped fallback query", {
    collection,
    orderBy,
    direction,
    limit: safeLimit,
    where: where.map((clause) => ({ field: clause.field, op: clause.op || "==" })),
  });
  let ref = firestore.collection(collection);
  for (const clause of where) {
    ref = ref.where(clause.field, clause.op || "==", clause.value);
  }
  const fallbackLimit = Math.min(Math.max(safeLimit * 5, safeLimit), maxLimit);
  const snapshot = await ref.limit(fallbackLimit).get();
  recordFirestoreRead({ collection, operation: "query-fallback", documentsReturned: snapshot.size, estimatedReads: snapshot.size, limit: fallbackLimit });
  let rows = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  rows = applySearch(rows, search, searchFields);
  rows = rows.sort((left, right) => {
    const leftValue = String(left[orderBy] || "");
    const rightValue = String(right[orderBy] || "");
    return direction === "asc" ? leftValue.localeCompare(rightValue) : rightValue.localeCompare(leftValue);
  });
  if (parsedCursor) {
    const index = rows.findIndex((row) => row.id === parsedCursor.id);
    if (index >= 0) rows = rows.slice(index + 1);
  }
  if (offset) rows = rows.slice(offset);
  rows = rows.slice(0, safeLimit);
  if (collection === "leads") rows = await withLeadCaseIds(rows, rows.map((row) => ({ ref: firestore.collection(collection).doc(row.id) })));
  if (DIAGNOSTIC_QUERY_COLLECTIONS.has(collection)) {
    logInfo("Firestore fallback query completed", {
      tag: "PROJECTION-LATENCY",
      collection,
      queryType: "query-fallback",
      durationMs: Date.now() - startedAt,
      resultCount: rows.length,
      estimatedReads: snapshot.size,
      cacheHit: false,
      cacheMiss: true,
      fallbackTriggered: true,
      where: where.map((clause) => ({ field: clause.field, op: clause.op || "==" })),
      orderBy,
      direction,
      limit: safeLimit,
      fallbackLimit,
      search: Boolean(search),
    });
  }
  return {
    data: rows.map((record) => selectFields(record, fields)),
    limit: safeLimit,
    nextCursor: null,
    indexFallback: true,
  };
}

export async function queryRecords(collection, {
  where = [],
  orderBy = "createdAt",
  direction = "desc",
  limit = 20,
  cursor = null,
  page = null,
  search = "",
  searchFields = [],
  fields = [],
  maxLimit = 100,
  allowGlobal = false,
} = {}) {
  const safeLimit = Math.min(clampQueryLimit(limit, 20), maxLimit);
  const parsedCursor = parseCursor(cursor);
  const pageNumber = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : null;
  assertPaginationSafe({ page: pageNumber, limit: safeLimit, cursor, collection });
  const offset = !parsedCursor && pageNumber && pageNumber > 1 ? (pageNumber - 1) * safeLimit : 0;
  if (collection === "leads") assertLeadQueryScoped(where, { allowGlobal: Boolean(allowGlobal) });
  const cacheKey = readCacheKey(collection, "query", {
    where,
    orderBy,
    direction,
    safeLimit,
    cursor,
    page: pageNumber,
    search,
    searchFields,
    fields,
    maxLimit,
    allowGlobal: Boolean(allowGlobal),
  });
  const cachedPage = getRequestReadCache(cacheKey);
  if (cachedPage !== undefined) {
    if (DIAGNOSTIC_QUERY_COLLECTIONS.has(collection)) {
      logInfo("Firestore query cache hit", {
        tag: "PROJECTION-LATENCY",
        collection,
        queryType: "query",
        durationMs: 0,
        resultCount: Array.isArray(cachedPage.data) ? cachedPage.data.length : 0,
        cacheHit: true,
        cacheMiss: false,
        fallbackTriggered: false,
        where: where.map((clause) => ({ field: clause.field, op: clause.op || "==" })),
        orderBy,
        direction,
        limit: safeLimit,
        search: Boolean(search),
      });
    }
    return cachedPage;
  }

  if (!firestore) {
    const memoryStartedAt = Date.now();
    let rows = applyMemoryWhere(memoryStore[collection] || [], where);
    rows = applySearch(rows, search, searchFields);
    rows = rows.sort((left, right) => {
      const leftValue = String(left[orderBy] || "");
      const rightValue = String(right[orderBy] || "");
      return direction === "asc" ? leftValue.localeCompare(rightValue) : rightValue.localeCompare(leftValue);
    });
    if (parsedCursor) {
      const index = rows.findIndex((row) => row.id === parsedCursor.id);
      if (index >= 0) rows = rows.slice(index + 1);
    }
    if (offset) rows = rows.slice(offset);
    const page = rows.slice(0, safeLimit);
    const memoryPage = {
      data: page.map((record) => selectFields(record, fields)),
      total: rows.length,
      limit: safeLimit,
      nextCursor: page.length === safeLimit ? encodeCursor(page[page.length - 1], orderBy) : null,
    };
    if (DIAGNOSTIC_QUERY_COLLECTIONS.has(collection)) {
      logInfo("Firestore memory query completed", {
        tag: "PROJECTION-LATENCY",
        collection,
        queryType: "memory-query",
        durationMs: Date.now() - memoryStartedAt,
        resultCount: memoryPage.data.length,
        cacheHit: false,
        cacheMiss: true,
        fallbackTriggered: false,
        where: where.map((clause) => ({ field: clause.field, op: clause.op || "==" })),
        orderBy,
        direction,
        limit: safeLimit,
        search: Boolean(search),
      });
    }
    return setRequestReadCache(cacheKey, memoryPage);
  }

  let snapshot;
  const queryStartedAt = Date.now();
  try {
    snapshot = await withQueryMonitoring({ collection, operation: "query", where, limit: safeLimit }, async () => {
      let ref = firestore.collection(collection);
      for (const clause of where) {
        ref = ref.where(clause.field, clause.op || "==", clause.value);
      }
      ref = ref.orderBy(orderBy, direction);
      if (parsedCursor?.value) ref = ref.startAfter(parsedCursor.value);
      else if (offset) ref = ref.offset(offset);
      if (fields.length && typeof ref.select === "function") ref = ref.select(...fields.filter((field) => field !== "id"));
      ref = ref.limit(safeLimit + 1);
      return ref.get();
    });
  } catch (error) {
    if (isMissingCompositeIndexError(error) && where.length) {
      assertCompositeIndexFallbackAllowed({ collection, where, orderBy });
      return fallbackIndexedQuery({ collection, where, orderBy, direction, safeLimit, parsedCursor, offset, search, searchFields, fields, maxLimit });
    }
    if (DIAGNOSTIC_QUERY_COLLECTIONS.has(collection)) {
      logWarn("Firestore query failed", {
        tag: "PROJECTION-LATENCY",
        collection,
        queryType: "query",
        durationMs: Date.now() - queryStartedAt,
        cacheHit: false,
        cacheMiss: true,
        fallbackTriggered: false,
        timeout: error.code === "FIRESTORE_QUERY_TIMEOUT",
        error: error.code || error.message,
        where: where.map((clause) => ({ field: clause.field, op: clause.op || "==" })),
        orderBy,
        direction,
        limit: safeLimit,
        search: Boolean(search),
      });
    }
    throw error;
  }
  let rows = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  recordFirestoreRead({
    collection,
    operation: "query",
    signature: readSignature(collection, "query", [
      ...whereSignature(where),
      ["orderBy", orderBy],
      ["direction", direction],
      ["limit", safeLimit],
      search ? ["search", hashValue(search)] : null,
    ]),
    documentsReturned: rows.length,
    estimatedReads: snapshot.size,
    limit: safeLimit,
  });
  rows = applySearch(rows, search, searchFields);
  const hasMore = rows.length > safeLimit;
  rows = rows.slice(0, safeLimit);
  if (collection === "leads") rows = await withLeadCaseIds(rows, snapshot.docs.slice(0, rows.length));
  const resultPage = {
    data: rows.map((record) => selectFields(record, fields)),
    limit: safeLimit,
    nextCursor: hasMore ? encodeCursor(rows[rows.length - 1], orderBy) : null,
  };
  if (DIAGNOSTIC_QUERY_COLLECTIONS.has(collection)) {
    logInfo("Firestore query completed", {
      tag: "PROJECTION-LATENCY",
      collection,
      queryType: "query",
      durationMs: Date.now() - queryStartedAt,
      resultCount: resultPage.data.length,
      estimatedReads: snapshot.size,
      cacheHit: false,
      cacheMiss: true,
      fallbackTriggered: false,
      where: where.map((clause) => ({ field: clause.field, op: clause.op || "==" })),
      orderBy,
      direction,
      limit: safeLimit,
      search: Boolean(search),
    });
  }
  return setRequestReadCache(cacheKey, resultPage);
}

export async function countRecords(collection, { where = [] } = {}) {
  if (collection === "leads") assertLeadQueryScoped(where, { allowGlobal: false });
  const cacheKey = readCacheKey(collection, "count", { where });
  const cachedCount = getRequestReadCache(cacheKey);
  if (cachedCount !== undefined) return cachedCount;
  if (!firestore) return applyMemoryWhere(memoryStore[collection] || [], where).length;

  return withQueryMonitoring({ collection, operation: "count", where, limit: 0 }, async () => {
    let ref = firestore.collection(collection);
    for (const clause of where) {
      ref = ref.where(clause.field, clause.op || "==", clause.value);
    }
    if (typeof ref.count === "function") {
      const snapshot = await ref.count().get();
      recordFirestoreRead({ collection, operation: "count", signature: readSignature(collection, "count", whereSignature(where)), documentsReturned: 1, estimatedReads: 1 });
      return setRequestReadCache(cacheKey, snapshot.data().count || 0);
    }
    const snapshot = await ref.select().get();
    recordFirestoreRead({ collection, operation: "count-fallback", signature: readSignature(collection, "count-fallback", whereSignature(where)), documentsReturned: snapshot.size, estimatedReads: snapshot.size });
    return setRequestReadCache(cacheKey, snapshot.size);
  });
}
