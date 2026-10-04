import crypto from "node:crypto";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
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
  readCacheKey,
  readSignature,
  setRequestReadCache,
  whereSignature,
  withLeadCaseIds,
} from "./firestoreShared.service.js";

export async function listRecords(collection) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_FIRESTORE_FULL_SCAN !== "true") {
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

export function parseCursor(cursor) {
  if (!cursor) return null;
  try {
    const encoded = String(cursor);
    if (encoded.length > 8192) throw new Error("Cursor is too large");
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || parsed.v !== 2
      || !Object.hasOwn(parsed, "value") || typeof parsed.id !== "string" || !parsed.id
      || typeof parsed.orderBy !== "string" || !["asc", "desc"].includes(parsed.direction)
      || !/^[a-f0-9]{64}$/.test(parsed.queryHash || "")
      || !isValidCursorValue(parsed.value)) {
      throw new Error("Invalid cursor structure");
    }
    return parsed;
  } catch (cause) {
    const error = new Error("Pagination cursor is invalid or expired. Refresh the list and try again.", { cause });
    error.status = 400;
    error.code = "INVALID_PAGINATION_CURSOR";
    throw error;
  }
}

function isValidCursorValue(value, depth = 0) {
  if (depth > 8) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 100 && value.every((entry) => isValidCursorValue(entry, depth + 1));
  if (!value || typeof value !== "object") return false;
  if (value.__cursorType === "date") return typeof value.value === "string" && Number.isFinite(Date.parse(value.value));
  if (Object.hasOwn(value, "_seconds") || Object.hasOwn(value, "_nanoseconds")) {
    return Number.isInteger(value._seconds) && Number.isInteger(value._nanoseconds)
      && value._nanoseconds >= 0 && value._nanoseconds < 1_000_000_000;
  }
  return Object.keys(value).length <= 100 && Object.values(value).every((entry) => isValidCursorValue(entry, depth + 1));
}

function decodeCursorValue(value) {
  if (value && typeof value === "object" && value.__cursorType === "date" && typeof value.value === "string") {
    return new Date(value.value);
  }
  if (value && typeof value === "object" && Number.isInteger(value._seconds) && Number.isInteger(value._nanoseconds)) {
    return new Timestamp(value._seconds, value._nanoseconds);
  }
  return value;
}

function stableSerialize(value) {
  if (value instanceof Date) return JSON.stringify({ __cursorType: "date", value: value.toISOString() });
  if (value && typeof value.toMillis === "function") return stableSerialize({ _seconds: value.seconds, _nanoseconds: value.nanoseconds });
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function cursorQueryHash({
  collection,
  where = [],
  orderBy = "createdAt",
  direction = "desc",
  search = "",
  searchFields = [],
  cursorScope = null,
  allowGlobal = false,
} = {}) {
  const identity = stableSerialize({ collection, where, orderBy, direction, search, searchFields, cursorScope, allowGlobal: Boolean(allowGlobal) });
  return crypto.createHash("sha256").update(identity).digest("hex");
}

export function encodeCursor(record, orderByField, direction = "desc", queryHash = "") {
  if (!record) return null;
  if (!/^[a-f0-9]{64}$/.test(queryHash)) throw new TypeError("A query-bound cursor hash is required");
  const value = record[orderByField] ?? null;
  const serializableValue = value instanceof Date
    ? { __cursorType: "date", value: value.toISOString() }
    : value && typeof value.toJSON === "function"
      ? value.toJSON()
      : value;
  return Buffer.from(JSON.stringify({ v: 2, orderBy: orderByField, direction, queryHash, value: serializableValue, id: String(record.id) })).toString("base64url");
}

function invalidCursorError() {
  const error = new Error("Pagination cursor does not match this list's filters or ordering. Refresh the list and try again.");
  error.status = 400;
  error.code = "INVALID_PAGINATION_CURSOR";
  return error;
}

function compareScalar(left, right) {
  if (left === right) return 0;
  const leftMissing = left === null || left === undefined;
  const rightMissing = right === null || right === undefined;
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return -1;
  if (rightMissing) return 1;
  const leftValue = typeof left?.toMillis === "function" ? left.toMillis() : left instanceof Date ? left.getTime() : left;
  const rightValue = typeof right?.toMillis === "function" ? right.toMillis() : right instanceof Date ? right.getTime() : right;
  if (typeof leftValue === "number" && typeof rightValue === "number") return leftValue < rightValue ? -1 : 1;
  const a = String(leftValue);
  const b = String(rightValue);
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareRecordToCursor(record, cursor, orderByField, direction) {
  const valueOrder = compareScalar(record[orderByField], decodeCursorValue(cursor.value));
  const idOrder = compareScalar(String(record.id || ""), String(cursor.id || ""));
  const tupleOrder = valueOrder || idOrder;
  return direction === "asc" ? tupleOrder : -tupleOrder;
}

function compareRecords(left, right, orderByField, direction) {
  const tupleOrder = compareScalar(left[orderByField], right[orderByField])
    || compareScalar(String(left.id || ""), String(right.id || ""));
  return direction === "asc" ? tupleOrder : -tupleOrder;
}

export function applyStableFirestoreOrdering(ref, { orderBy, direction = "desc", cursor = null } = {}) {
  let query = ref.orderBy(orderBy, direction).orderBy(FieldPath.documentId(), direction);
  if (cursor) query = query.startAfter(decodeCursorValue(cursor.value), String(cursor.id));
  return query;
}

export async function scanFirestoreSearchPages({ fetchPage, search, searchFields, limit, orderBy, direction = "desc", cursor = null, scanLimit = Math.max(limit + 1, 50) }) {
  const matchingDocs = [];
  let rawReadCount = 0;
  let scanCursor = cursor;
  while (matchingDocs.length <= limit) {
    const page = await fetchPage(scanCursor, scanLimit);
    rawReadCount += page.size;
    for (const doc of page.docs) {
      if (applySearch([{ ...doc.data(), id: doc.id }], search, searchFields).length) matchingDocs.push(doc);
    }
    if (matchingDocs.length > limit || page.size < scanLimit || !page.docs.length) break;
    const lastDoc = page.docs[page.docs.length - 1];
    scanCursor = { value: lastDoc.get(orderBy), id: lastDoc.id };
  }
  return { docs: matchingDocs, size: rawReadCount };
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

async function fallbackIndexedQuery({ collection, where, orderBy, direction, safeLimit, parsedCursor, offset = 0, search, searchFields, fields, maxLimit, queryHash }) {
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
  const snapshot = await ref.limit(fallbackLimit + 1).get();
  if (snapshot.size > fallbackLimit) {
    const error = new Error("A required Firestore index is missing; refresh later or contact support.");
    error.status = 503;
    error.code = "FIRESTORE_COMPOSITE_INDEX_REQUIRED";
    throw error;
  }
  recordFirestoreRead({ collection, operation: "query-fallback", documentsReturned: snapshot.size, estimatedReads: snapshot.size, limit: fallbackLimit + 1 });
  let rows = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
  rows = applySearch(rows, search, searchFields);
  rows = rows.sort((left, right) => compareRecords(left, right, orderBy, direction));
  if (parsedCursor) rows = rows.filter((row) => compareRecordToCursor(row, parsedCursor, orderBy, direction) > 0);
  if (offset) rows = rows.slice(offset);
  const hasMore = rows.length > safeLimit;
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
    nextCursor: hasMore ? encodeCursor(rows[rows.length - 1], orderBy, direction, queryHash) : null,
    indexFallback: true,
  };
}

export async function queryRecords(collection, {
  where = [],
  orderBy = "createdAt",
  direction = "desc",
  limit = 20,
  cursor = null,
  cursorScope = null,
  page = null,
  search = "",
  searchFields = [],
  fields = [],
  maxLimit = 100,
  allowGlobal = false,
} = {}) {
  const safeLimit = Math.min(clampQueryLimit(limit, 20), maxLimit);
  const hasSearch = Boolean(String(search || "").trim());
  const parsedCursor = parseCursor(cursor);
  const expectedCursorHash = cursorQueryHash({ collection, where, orderBy, direction, search, searchFields, cursorScope, allowGlobal });
  if (parsedCursor && (parsedCursor.orderBy !== orderBy || parsedCursor.direction !== direction || parsedCursor.queryHash !== expectedCursorHash)) throw invalidCursorError();
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
    let rows = applyMemoryWhere(memoryStore[collection] || [], where).filter((record) => Object.hasOwn(record, orderBy));
    rows = applySearch(rows, search, searchFields);
    rows = rows.sort((left, right) => compareRecords(left, right, orderBy, direction));
    if (parsedCursor) rows = rows.filter((row) => compareRecordToCursor(row, parsedCursor, orderBy, direction) > 0);
    if (offset) rows = rows.slice(offset);
    const page = rows.slice(0, safeLimit);
    const hasMore = rows.length > safeLimit;
    const memoryPage = {
      data: page.map((record) => selectFields(record, fields)),
      total: rows.length,
      limit: safeLimit,
      nextCursor: hasMore ? encodeCursor(page[page.length - 1], orderBy, direction, expectedCursorHash) : null,
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
      const buildQuery = (afterCursor) => {
        let ref = firestore.collection(collection);
        for (const clause of where) ref = ref.where(clause.field, clause.op || "==", clause.value);
        ref = applyStableFirestoreOrdering(ref, { orderBy, direction, cursor: afterCursor });
        if (!afterCursor && offset) ref = ref.offset(offset);
        const projection = [...new Set([
          ...fields.filter((field) => field !== "id"),
          ...(hasSearch ? searchFields : []),
          orderBy,
        ])];
        if (fields.length && projection.length && typeof ref.select === "function") ref = ref.select(...projection);
        return ref;
      };

      if (!hasSearch) return buildQuery(parsedCursor).limit(safeLimit + 1).get();
      if (!searchFields.length) return { docs: [], size: 0 };
      return scanFirestoreSearchPages({
        fetchPage: (afterCursor, pageLimit) => buildQuery(afterCursor).limit(pageLimit).get(),
        search,
        searchFields,
        limit: safeLimit,
        orderBy,
        direction,
        cursor: parsedCursor,
      });
    });
  } catch (error) {
    if (isMissingCompositeIndexError(error) && where.length) {
      assertCompositeIndexFallbackAllowed({ collection, where, orderBy });
      return fallbackIndexedQuery({ collection, where, orderBy, direction, safeLimit, parsedCursor, offset, search, searchFields, fields, maxLimit, queryHash: expectedCursorHash });
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
  let rows = snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
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
  if (!hasSearch) rows = applySearch(rows, search, searchFields);
  const hasMore = rows.length > safeLimit;
  rows = rows.slice(0, safeLimit);
  if (collection === "leads") rows = await withLeadCaseIds(rows, snapshot.docs.slice(0, rows.length));
  const resultPage = {
    data: rows.map((record) => selectFields(record, fields)),
    limit: safeLimit,
    nextCursor: hasMore ? encodeCursor(rows[rows.length - 1], orderBy, direction, expectedCursorHash) : null,
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
