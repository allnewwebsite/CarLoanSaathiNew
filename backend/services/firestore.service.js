import { firestore } from "../firebase/admin.js";
import { assertNonEmptyFirestoreData } from "../utils/firestoreSanitizer.js";
import { assertLeadMutable } from "../utils/archive.js";
import { assertLeadQueryScoped, assertPaginationSafe, clampQueryLimit, withQueryMonitoring } from "./queryGovernance.service.js";
import { logInfo, logWarn } from "./logger.service.js";
import { clearRequestCachedValue, getRequestCachedValue, recordFirestoreRead, recordFirestoreWrite, setRequestCachedValue } from "./requestScope.service.js";
import { logRealtimeTicketStep } from "./realtimeTicketLatency.service.js";
import { clearCachedValue } from "./ttlCache.service.js";
import crypto from "node:crypto";

const memoryStore = {
  leads: [],
  documents: [],
  leadAssignments: [],
  reassignmentLogs: [],
  dealers: [],
  dealerships: [],
  dealershipManagers: [],
  salespersons: [],
  financeManagers: [],
  financeDesk: [],
  financeDesks: [],
  onboardingRequests: [],
  cityMappings: [],
  bankCityMappings: [],
  dealerProfiles: [],
  banks: [],
  branches: [],
  branchManagers: [],
  loanExecutives: [],
  bankPartners: [],
  payouts: [],
  commissions: [],
  settings: [],
  partnerQueues: [],
  notifications: [],
  notificationEvents: [],
  notificationLogs: [],
  whatsappQueue: [],
  auditLogs: [],
  authAuditLogs: [],
  documentAuditLogs: [],
  leadTimeline: [],
  bankDocuments: [],
  analytics: [],
  metrics: [],
  dailyMetrics: [],
  monthlyMetrics: [],
  dealershipMetrics: [],
  bankMetrics: [],
  executiveMetrics: [],
  bankAnalyticsSummaries: [],
  bankAnalyticsLeadStates: [],
  bankExecutiveAnalytics: [],
  bankRecentCases: [],
  operationalMetrics: [],
  operationalEvents: [],
  operationalAlerts: [],
  archivalLogs: [],
  systemCounters: [],
  workflowLogViews: [],
  workflowLogArchives: [],
  bankBranchCatalog: [],
};

const PRODUCTION_FULL_SCAN_DENYLIST = new Set([
  "authAuditLogs",
  "auditLogs",
  "bankDocuments",
  "documents",
  "leadTimeline",
  "loginActivity",
  "notifications",
  "userSessions",
]);

const DIAGNOSTIC_QUERY_COLLECTIONS = new Set([
  "adminViews",
  "financeViews",
  "gmViews",
  "bankViews",
  "executiveViews",
  "leads",
]);

const DIRECT_ID_ONLY_COLLECTIONS = new Set([
  "auditLogs",
  "authAuditLogs",
  "bankAnalyticsLeadStates",
  "bankAnalyticsSummaries",
  "bankExecutiveAnalytics",
  "bankRecentCases",
  "bankDocuments",
  "documentAuditLogs",
  "documents",
  "leadTimeline",
  "loginActivity",
  "notificationEvents",
  "notificationLogs",
  "notifications",
  "operationalAlerts",
  "operationalEvents",
  "systemCounters",
  "users",
  "userSessions",
  "whatsappQueue",
]);

let memoryBackfillCounter = 0;

function hashValue(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? "")).digest("hex").slice(0, 12);
}

function readSignature(collection, operation, parts = []) {
  const normalized = parts
    .filter(Boolean)
    .map((part) => Array.isArray(part) ? part.join(":") : String(part))
    .sort()
    .join("|");
  return `${collection}:${operation}:${normalized}`;
}

function whereSignature(where = []) {
  return where.map((clause) => [
    clause.field || "unknown",
    clause.op || "==",
    hashValue(clause.value),
  ]);
}

function formatLeadCaseId(counter) {
  return `CLS-${String(counter).padStart(4, "0")}`;
}

async function nextFirestoreLeadCaseId() {
  const counterId = "leads";
  return firestore.runTransaction(async (transaction) => {
    const ref = firestore.collection("systemCounters").doc(counterId);
    const snapshot = await transaction.get(ref);
    const data = snapshot.exists ? snapshot.data() : {};
    const current = Number(data?.current || 0);
    const next = current + 1;
    transaction.set(ref, {
      type: "leads",
      current: next,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return formatLeadCaseId(next);
  });
}

async function withLeadCaseIds(records, docs = []) {
  if (!records.length) return records;
  if (!firestore) {
    if (!memoryBackfillCounter) {
      memoryBackfillCounter = records
        .map((lead) => String(lead.caseId || ""))
        .map((value) => {
          const match = value.match(/^CLS-(?:\d{4}-)?(\d{4,})$/);
          return match ? Number(match[1]) : NaN;
        })
        .filter(Number.isFinite)
        .reduce((max, value) => Math.max(max, value), 0);
    }
    return records.map((lead) => {
      if (lead.caseId) return lead;
      memoryBackfillCounter += 1;
      lead.caseId = formatLeadCaseId(memoryBackfillCounter);
      return lead;
    });
  }

  const nextRecords = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.caseId) {
      nextRecords.push(record);
      continue;
    }
    const caseId = await nextFirestoreLeadCaseId();
    await docs[index].ref.update({ caseId });
    nextRecords.push({ ...record, caseId });
  }
  return nextRecords;
}

async function resolveDocumentRef(collection, id) {
  const directRef = firestore.collection(collection).doc(id);
  const directDoc = await directRef.get();
  if (directDoc.exists) return directRef;

  const snapshot = await firestore.collection(collection).where("id", "==", id).limit(1).get();
  if (!snapshot.empty) return snapshot.docs[0].ref;
  if (collection === "leads") {
    const caseSnapshot = await firestore.collection(collection).where("caseId", "==", id).limit(1).get();
    if (!caseSnapshot.empty) return caseSnapshot.docs[0].ref;
  }
  return directRef;
}

function stableCachePart(value) {
  return hashValue(value);
}

function readCacheKey(collection, operation, parts = {}) {
  return `fs:${collection}:${operation}:${stableCachePart(parts)}`;
}

function collectionCachePrefix(collection) {
  return `fs:${collection}:`;
}

function cloneCachedValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return JSON.parse(JSON.stringify(value));
}

function getRequestReadCache(key) {
  const value = getRequestCachedValue(key);
  return value === undefined ? undefined : cloneCachedValue(value);
}

function setRequestReadCache(key, value) {
  setRequestCachedValue(key, cloneCachedValue(value));
  return value;
}

function clearCollectionReadCache(collection) {
  clearRequestCachedValue(collectionCachePrefix(collection));
}

function recordWriteMetric({ collection, operation, id = "", documentsWritten = 1, startedAt = Date.now() }) {
  recordFirestoreWrite({
    collection,
    operation,
    signature: readSignature(collection, operation, id ? [["id", hashValue(id)]] : []),
    documentsWritten,
    estimatedWrites: documentsWritten,
    durationMs: Date.now() - startedAt,
  });
}

function clearAuthCacheForWrite(collection, id = "") {
  if (collection === "users") {
    clearCachedValue("identity:candidates:");
    clearCachedValue("auth:identity:");
    clearCachedValue("auth:verified-identity:");
    clearCachedValue("auth:firebase-email-verified:");
  }
  if (collection === "userSessions") {
    if (id) clearCachedValue(`auth:session:${id}`);
    else clearCachedValue("auth:session:");
  }
  if (collection === "dealerships" || collection === "approvedDealerships") {
    if (id) clearCachedValue(`auth:dealership:${String(id).trim().toLowerCase()}`);
    else clearCachedValue("auth:dealership:");
  }
}

export async function createRecord(collection, payload) {
  const startedAt = Date.now();
  clearCollectionReadCache(collection);
  clearAuthCacheForWrite(collection, payload?.id);
  const cleanPayload = assertNonEmptyFirestoreData(payload);
  const record = {
    id: `${collection}-${Date.now()}`,
    ...(collection === "leads" ? { isArchived: false } : {}),
    ...cleanPayload,
    createdAt: new Date().toISOString(),
  };
  if (!firestore) {
    memoryStore[collection] = memoryStore[collection] || [];
    memoryStore[collection].push(record);
    await syncWriteProjections(collection, record);
    recordWriteMetric({ collection, operation: "create", id: record.id, startedAt });
    return record;
  }
  await firestore.collection(collection).doc(record.id).set(record);
  recordWriteMetric({ collection, operation: "create", id: record.id, startedAt });
  await syncWriteProjections(collection, record).catch((error) => {
    logWarn("Projection write skipped after create", { collection, error: error.message });
  });
  return record;
}

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

const WORKFLOW_LOG_SOURCES = new Set([
  "leadAssignments",
  "reassignmentLogs",
  "payouts",
  "commissions",
  "notifications",
  "settings",
]);

const BANK_CATALOG_SOURCES = new Set([
  "banks",
  "bankPartners",
  "branches",
  "branchManagers",
  "pendingBankApprovals",
]);

function safeProjectionId(...parts) {
  return parts
    .filter(Boolean)
    .join("__")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 240);
}

function workflowLogProjection(collection, record = {}) {
  const timestamp = record.updatedAt || record.createdAt || record.timestamp || record.approvedAt || record.completedAt || new Date().toISOString();
  return {
    id: safeProjectionId(collection, record.id || timestamp),
    sourceCollection: collection,
    sourceId: record.id || null,
    logType: collection,
    timestamp,
    createdAt: record.createdAt || timestamp,
    updatedAt: record.updatedAt || timestamp,
    leadId: record.leadId || record.caseId || record.entityId || record.targetId || null,
    caseId: record.caseId || null,
    entityId: record.entityId || record.targetId || record.leadId || null,
    actorEmail: record.actorEmail || record.createdBy || record.updatedBy || record.approvedBy || record.userEmail || record.recipientEmail || null,
    actorName: record.actorName || record.createdByName || record.userName || null,
    status: record.status || record.newStatus || record.approvalStatus || null,
    action: record.action || record.actionType || record.type || record.eventType || collection,
    title: record.title || record.subject || record.action || record.actionType || collection,
    summary: record.message || record.description || record.reason || record.title || record.action || record.actionType || "",
  };
}

function bankBranchCatalogProjection(collection, record = {}) {
  const ifscCode = String(record.ifscCode || record.ifsc || record.bankIfsc || "").trim().toUpperCase();
  if (!ifscCode) return null;
  const status = String(record.status || record.approvalStatus || "").trim().toLowerCase();
  const approved = record.approved === true || ["approved", "active"].includes(status);
  const active = record.active !== false && status !== "suspended" && status !== "rejected";
  const bankName = String(record.bankName || record.name || record.companyName || "").trim();
  const branchName = String(record.branchName || record.branchLocation || record.bankBranchLocation || record.city || "").trim();
  if (!bankName || !branchName) return null;
  return {
    id: ifscCode,
    sourceCollection: collection,
    sourceId: record.id || null,
    bankId: record.bankId || record.id || ifscCode,
    branchId: record.branchId || record.id || record.bankId || ifscCode,
    bankBranchId: record.bankBranchId || record.branchId || record.id || record.bankId || ifscCode,
    ifscCode,
    bankName,
    branchName,
    address: record.address || "",
    city: String(record.city || record.branchCity || record.branchLocation || record.bankBranchLocation || "").trim(),
    state: String(record.state || "Haryana").trim(),
    contactPerson: record.contactPerson || record.managerName || "",
    phone: record.phone || record.mobile || "",
    email: record.email || record.officialEmail || "",
    approvalStatus: approved ? "approved" : (record.approvalStatus || record.status || "pending"),
    approved,
    active,
    approvedAt: record.approvedAt || null,
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || new Date().toISOString(),
  };
}

async function writeProjectionRecord(collection, id, payload) {
  if (!payload || !id) return;
  const startedAt = Date.now();
  if (!firestore) {
    memoryStore[collection] = memoryStore[collection] || [];
    const index = memoryStore[collection].findIndex((item) => item.id === id);
    if (index >= 0) memoryStore[collection][index] = { ...memoryStore[collection][index], ...payload };
    else memoryStore[collection].push({ id, ...payload });
    recordWriteMetric({ collection, operation: "projection-write", id, startedAt });
    return;
  }
  await firestore.collection(collection).doc(id).set(payload, { merge: true });
  recordWriteMetric({ collection, operation: "projection-write", id, startedAt });
}

export async function syncWriteProjections(collection, record = {}) {
  if (WORKFLOW_LOG_SOURCES.has(collection)) {
    const projection = workflowLogProjection(collection, record);
    await writeProjectionRecord("workflowLogViews", projection.id, projection);
  }
  if (BANK_CATALOG_SOURCES.has(collection)) {
    const projection = bankBranchCatalogProjection(collection, record);
    if (projection) await writeProjectionRecord("bankBranchCatalog", projection.id, projection);
  }
  if (collection === "leads" && record?.id) {
    const { syncBankAnalyticsAggregate } = await import("./bankAnalyticsAggregate.service.js");
    await syncBankAnalyticsAggregate(record);
  }
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

export async function getRecord(collection, id) {
  const startedAt = Date.now();
  const cacheKey = readCacheKey(collection, "get", { id });
  const cachedRecord = getRequestReadCache(cacheKey);
  if (cachedRecord !== undefined) {
    logRealtimeTicketStep(`firestore_get_cache:${collection}`, Date.now() - startedAt, { collection, operation: "get", cacheStatus: "request-cache-hit" });
    return cachedRecord;
  }
  if (!firestore) return (memoryStore[collection] || []).find((item) => item.id === id || (collection === "leads" && item.caseId === id)) || null;
  try {
    const directDoc = await firestore.collection(collection).doc(id).get();
    recordFirestoreRead({ collection, operation: "get", signature: readSignature(collection, "get", [["id", hashValue(id)]]), documentsReturned: directDoc.exists ? 1 : 0, estimatedReads: 1 });
    if (directDoc.exists) return setRequestReadCache(cacheKey, { ...directDoc.data(), id: directDoc.id });
    if (DIRECT_ID_ONLY_COLLECTIONS.has(collection)) return setRequestReadCache(cacheKey, null);

    const idSnapshot = await firestore.collection(collection).where("id", "==", id).limit(1).get();
    recordFirestoreRead({ collection, operation: "find", signature: readSignature(collection, "find", [["id", "==", hashValue(id)], ["limit", 1]]), documentsReturned: idSnapshot.size, estimatedReads: idSnapshot.size, limit: 1 });
    if (!idSnapshot.empty) {
      const doc = idSnapshot.docs[0];
      return setRequestReadCache(cacheKey, { id: doc.id, ...doc.data() });
    }

    if (collection === "leads") {
      const caseSnapshot = await firestore.collection(collection).where("caseId", "==", id).limit(1).get();
      recordFirestoreRead({ collection, operation: "find", signature: readSignature(collection, "find", [["caseId", "==", hashValue(id)], ["limit", 1]]), documentsReturned: caseSnapshot.size, estimatedReads: caseSnapshot.size, limit: 1 });
      if (!caseSnapshot.empty) {
        const doc = caseSnapshot.docs[0];
        return setRequestReadCache(cacheKey, { id: doc.id, ...doc.data() });
      }
    }

    return setRequestReadCache(cacheKey, null);
  } finally {
    logRealtimeTicketStep(`firestore_get:${collection}`, Date.now() - startedAt, { collection, operation: "get", firestore: true });
  }
}

export async function updateRecord(collection, id, payload) {
  const startedAt = Date.now();
  clearCollectionReadCache(collection);
  clearAuthCacheForWrite(collection, id);
  const cleanPayload = assertNonEmptyFirestoreData(payload);
  const update = { ...cleanPayload, updatedAt: new Date().toISOString() };
  if (!firestore) {
    if (collection === "leads") {
      const existing = (memoryStore[collection] || []).find((item) => item.id === id);
      if (existing) assertLeadMutable(existing);
    }
    let updated = { id, ...update };
    memoryStore[collection] = (memoryStore[collection] || []).map((item) => {
      if (item.id !== id) return item;
      updated = { ...item, ...update };
      return updated;
    });
    await syncWriteProjections(collection, updated);
    recordWriteMetric({ collection, operation: "update", id, startedAt });
    return updated;
  }
  const ref = await resolveDocumentRef(collection, id);
  if (collection === "leads") {
    const existing = await ref.get();
    if (existing.exists) assertLeadMutable({ id: existing.id, ...existing.data() });
  }
  await ref.update(update);
  recordWriteMetric({ collection, operation: "update", id, startedAt });
  const doc = await ref.get();
  recordFirestoreRead({ collection, operation: "update-readback", signature: readSignature(collection, "update-readback", [["id", hashValue(id)]]), documentsReturned: doc.exists ? 1 : 0, estimatedReads: 1 });
  const record = { ...doc.data(), id: doc.id };
  await syncWriteProjections(collection, record).catch((error) => {
    logWarn("Projection write skipped after update", { collection, id, error: error.message });
  });
  return record;
}

export async function runRecordTransaction(handler) {
  if (!firestore) return handler({
    get: getRecord,
    set: upsertRecord,
    update: updateRecord,
    create: createRecord,
    delete: deleteRecord,
  });
  const { FieldValue } = await import("firebase-admin/firestore");
  return firestore.runTransaction(async (transaction) => {
    const read = async (collection, id) => {
      const ref = firestore.collection(collection).doc(id);
      const doc = await transaction.get(ref);
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    };
    const write = (collection, id, payload, { merge = true } = {}) => {
      const ref = firestore.collection(collection).doc(id);
      transaction.set(ref, assertNonEmptyFirestoreData({ id, ...payload }), { merge });
    };
    const patch = (collection, id, payload) => {
      const ref = firestore.collection(collection).doc(id);
      transaction.update(ref, assertNonEmptyFirestoreData(payload));
    };
    const remove = (collection, id) => {
      const ref = firestore.collection(collection).doc(id);
      transaction.delete(ref);
    };
    return handler({
      get: read,
      set: write,
      update: patch,
      delete: remove,
      serverTimestamp: FieldValue.serverTimestamp,
    });
  });
}

export async function upsertRecord(collection, id, payload) {
  const startedAt = Date.now();
  clearCollectionReadCache(collection);
  clearAuthCacheForWrite(collection, id);
  const cleanPayload = assertNonEmptyFirestoreData(payload);
  const update = { ...cleanPayload, updatedAt: new Date().toISOString() };
  if (!firestore) {
    memoryStore[collection] = memoryStore[collection] || [];
    const index = memoryStore[collection].findIndex((item) => item.id === id);
    if (index >= 0) {
      if (collection === "leads") assertLeadMutable(memoryStore[collection][index]);
      memoryStore[collection][index] = { ...memoryStore[collection][index], ...update };
      await syncWriteProjections(collection, memoryStore[collection][index]);
      recordWriteMetric({ collection, operation: "upsert", id, startedAt });
      return memoryStore[collection][index];
    }
    const record = { id, ...update, createdAt: new Date().toISOString() };
    memoryStore[collection].push(record);
    await syncWriteProjections(collection, record);
    recordWriteMetric({ collection, operation: "upsert", id, startedAt });
    return record;
  }
  if (collection === "leads") {
    const existing = await firestore.collection(collection).doc(id).get();
    if (existing.exists) assertLeadMutable({ id: existing.id, ...existing.data() });
  }
  await firestore.collection(collection).doc(id).set(update, { merge: true });
  recordWriteMetric({ collection, operation: "upsert", id, startedAt });
  const doc = await firestore.collection(collection).doc(id).get();
  recordFirestoreRead({ collection, operation: "upsert-readback", signature: readSignature(collection, "upsert-readback", [["id", hashValue(id)]]), documentsReturned: doc.exists ? 1 : 0, estimatedReads: 1 });
  const record = { id: doc.id, ...doc.data() };
  await syncWriteProjections(collection, record).catch((error) => {
    logWarn("Projection write skipped after upsert", { collection, id, error: error.message });
  });
  return record;
}

export async function incrementRecord(collection, id, increments = {}, base = {}) {
  const startedAt = Date.now();
  const now = new Date().toISOString();
  if (!firestore) {
    memoryStore[collection] = memoryStore[collection] || [];
    const index = memoryStore[collection].findIndex((item) => item.id === id);
    const current = index >= 0 ? memoryStore[collection][index] : { id, ...base, createdAt: now };
    const next = { ...current, ...base, updatedAt: now };
    for (const [key, value] of Object.entries(increments)) {
      next[key] = Number(next[key] || 0) + Number(value || 0);
    }
    if (index >= 0) memoryStore[collection][index] = next;
    else memoryStore[collection].push(next);
    recordWriteMetric({ collection, operation: "increment", id, startedAt });
    return next;
  }
  const { FieldValue } = await import("firebase-admin/firestore");
  const update = { ...base, updatedAt: now };
  for (const [key, value] of Object.entries(increments)) {
    update[key] = FieldValue.increment(Number(value || 0));
  }
  await firestore.collection(collection).doc(id).set(update, { merge: true });
  recordWriteMetric({ collection, operation: "increment", id, startedAt });
  const doc = await firestore.collection(collection).doc(id).get();
  return { id: doc.id, ...doc.data() };
}

export async function bulkUpsertRecords(collection, records = []) {
  const startedAt = Date.now();
  const rows = records.filter((record) => record?.id);
  if (!rows.length) return 0;
  clearCollectionReadCache(collection);
  if (!firestore) {
    memoryStore[collection] = memoryStore[collection] || [];
    const byId = new Map(memoryStore[collection].map((record) => [record.id, record]));
    for (const record of rows) {
      byId.set(record.id, {
        ...(byId.get(record.id) || {}),
        ...record,
        updatedAt: record.updatedAt || new Date().toISOString(),
      });
    }
    memoryStore[collection] = [...byId.values()];
    recordWriteMetric({ collection, operation: "bulk-upsert", documentsWritten: rows.length, startedAt });
    return rows.length;
  }
  const writer = firestore.bulkWriter();
  for (const record of rows) {
    const { id, ...payload } = assertNonEmptyFirestoreData(record);
    writer.set(firestore.collection(collection).doc(id), payload, { merge: true });
  }
  await writer.close();
  recordWriteMetric({ collection, operation: "bulk-upsert", documentsWritten: rows.length, startedAt });
  return rows.length;
}

export async function deleteRecord(collection, id) {
  const startedAt = Date.now();
  const deletedLead = collection === "leads" ? await getRecord(collection, id).catch(() => null) : null;
  if (!firestore) {
    memoryStore[collection] = (memoryStore[collection] || []).filter((item) => item.id !== id);
    if (deletedLead) {
      const { removeBankAnalyticsAggregate } = await import("./bankAnalyticsAggregate.service.js");
      await removeBankAnalyticsAggregate(deletedLead);
    }
    recordWriteMetric({ collection, operation: "delete", id, startedAt });
    return true;
  }
  const ref = await resolveDocumentRef(collection, id);
  await ref.delete();
  recordWriteMetric({ collection, operation: "delete", id, startedAt });
  if (deletedLead) {
    const { removeBankAnalyticsAggregate } = await import("./bankAnalyticsAggregate.service.js");
    await removeBankAnalyticsAggregate(deletedLead);
  }
  return true;
}

export async function deleteRecordsByIds(collection, ids = []) {
  const uniqueIds = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!uniqueIds.length) return 0;
  if (!firestore) {
    const before = (memoryStore[collection] || []).length;
    memoryStore[collection] = (memoryStore[collection] || []).filter((item) => !uniqueIds.includes(String(item.id || "")));
    return before - memoryStore[collection].length;
  }
  await Promise.all(uniqueIds.map((id) => deleteRecord(collection, id)));
  return uniqueIds.length;
}

export async function deleteRecordsByQuery(collection, {
  where = [],
  limit = 250,
  maxPasses = 20,
} = {}) {
  const clauses = where.filter((clause) => clause?.field && clause.value !== undefined && clause.value !== null && clause.value !== "");
  if (!clauses.length) {
    const error = new Error("Refusing unscoped deleteRecordsByQuery call");
    error.status = 400;
    error.code = "UNSCOPED_DELETE_QUERY";
    throw error;
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 250, 1), 500);
  let deleted = 0;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const page = await queryRecords(collection, {
      where: clauses,
      orderBy: clauses[0].field,
      direction: "asc",
      limit: safeLimit,
      maxLimit: safeLimit,
      fields: ["id"],
      allowGlobal: collection === "leads",
    });
    const ids = page.data.map((item) => item.id).filter(Boolean);
    if (!ids.length) break;
    deleted += await deleteRecordsByIds(collection, ids);
    if (ids.length < safeLimit) break;
  }
  return deleted;
}
