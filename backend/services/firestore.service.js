import { firestore } from "../firebase/admin.js";
import { assertNonEmptyFirestoreData } from "../utils/firestoreSanitizer.js";
import { assertLeadQueryScoped, assertPaginationSafe, clampQueryLimit, withQueryMonitoring } from "./queryGovernance.service.js";
import { logWarn } from "./logger.service.js";
import { recordFirestoreRead } from "./requestScope.service.js";
import crypto from "node:crypto";

const memoryStore = {
  leads: [],
  documents: [],
  leadAssignments: [],
  slaLogs: [],
  slaMetrics: [],
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
  slaTracking: [],
  analytics: [],
  metrics: [],
  dailyMetrics: [],
  monthlyMetrics: [],
  dealershipMetrics: [],
  bankMetrics: [],
  executiveMetrics: [],
  operationalMetrics: [],
  operationalEvents: [],
  operationalAlerts: [],
  archivedLeads: [],
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
  "slaLogs",
  "userSessions",
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

export async function createRecord(collection, payload) {
  const cleanPayload = assertNonEmptyFirestoreData(payload);
  const record = { id: `${collection}-${Date.now()}`, ...cleanPayload, createdAt: new Date().toISOString() };
  if (!firestore) {
    memoryStore[collection] = memoryStore[collection] || [];
    memoryStore[collection].push(record);
    await syncWriteProjections(collection, record);
    return record;
  }
  await firestore.collection(collection).doc(record.id).set(record);
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
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 25);
  if (!firestore) return (memoryStore[collection] || []).filter((item) => item[field] === value).slice(0, safeLimit);
  const snapshot = await firestore.collection(collection).where(field, "==", value).limit(safeLimit).get();
  recordFirestoreRead({
    collection,
    operation: "find",
    signature: readSignature(collection, "find", [[field, "==", hashValue(value)], ["limit", safeLimit]]),
    documentsReturned: snapshot.size,
    estimatedReads: snapshot.size,
    limit: safeLimit,
  });
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
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
    if (op === ">=") return record[field] >= value;
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
  "slaLogs",
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
  if (!firestore) {
    memoryStore[collection] = memoryStore[collection] || [];
    const index = memoryStore[collection].findIndex((item) => item.id === id);
    if (index >= 0) memoryStore[collection][index] = { ...memoryStore[collection][index], ...payload };
    else memoryStore[collection].push({ id, ...payload });
    return;
  }
  await firestore.collection(collection).doc(id).set(payload, { merge: true });
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
}

function isMissingCompositeIndexError(error) {
  return Number(error?.code) === 9
    || String(error?.message || "").includes("FAILED_PRECONDITION")
    || String(error?.message || "").includes("requires an index");
}

async function fallbackIndexedQuery({ collection, where, orderBy, direction, safeLimit, parsedCursor, offset = 0, search, searchFields, fields, maxLimit }) {
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

  if (!firestore) {
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
    return {
      data: page.map((record) => selectFields(record, fields)),
      total: rows.length,
      limit: safeLimit,
      nextCursor: page.length === safeLimit ? encodeCursor(page[page.length - 1], orderBy) : null,
    };
  }

  let snapshot;
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
  return {
    data: rows.map((record) => selectFields(record, fields)),
    limit: safeLimit,
    nextCursor: hasMore ? encodeCursor(rows[rows.length - 1], orderBy) : null,
  };
}

export async function countRecords(collection, { where = [] } = {}) {
  if (collection === "leads") assertLeadQueryScoped(where, { allowGlobal: false });
  if (!firestore) return applyMemoryWhere(memoryStore[collection] || [], where).length;

  return withQueryMonitoring({ collection, operation: "count", where, limit: 0 }, async () => {
    let ref = firestore.collection(collection);
    for (const clause of where) {
      ref = ref.where(clause.field, clause.op || "==", clause.value);
    }
    if (typeof ref.count === "function") {
      const snapshot = await ref.count().get();
      recordFirestoreRead({ collection, operation: "count", signature: readSignature(collection, "count", whereSignature(where)), documentsReturned: 1, estimatedReads: 1 });
      return snapshot.data().count || 0;
    }
    const snapshot = await ref.select().get();
    recordFirestoreRead({ collection, operation: "count-fallback", signature: readSignature(collection, "count-fallback", whereSignature(where)), documentsReturned: snapshot.size, estimatedReads: snapshot.size });
    return snapshot.size;
  });
}

export async function getRecord(collection, id) {
  if (!firestore) return (memoryStore[collection] || []).find((item) => item.id === id || (collection === "leads" && item.caseId === id)) || null;
  const ref = await resolveDocumentRef(collection, id);
  const doc = await ref.get();
  recordFirestoreRead({ collection, operation: "get", signature: readSignature(collection, "get", [["id", hashValue(id)]]), documentsReturned: doc.exists ? 1 : 0, estimatedReads: 1 });
  if (!doc.exists) return null;
  return { ...doc.data(), id: doc.id };
}

export async function updateRecord(collection, id, payload) {
  const cleanPayload = assertNonEmptyFirestoreData(payload);
  const update = { ...cleanPayload, updatedAt: new Date().toISOString() };
  if (!firestore) {
    let updated = { id, ...update };
    memoryStore[collection] = (memoryStore[collection] || []).map((item) => {
      if (item.id !== id) return item;
      updated = { ...item, ...update };
      return updated;
    });
    await syncWriteProjections(collection, updated);
    return updated;
  }
  const ref = await resolveDocumentRef(collection, id);
  await ref.update(update);
  const doc = await ref.get();
  recordFirestoreRead({ collection, operation: "update-readback", signature: readSignature(collection, "update-readback", [["id", hashValue(id)]]), documentsReturned: doc.exists ? 1 : 0, estimatedReads: 1 });
  const record = { ...doc.data(), id: doc.id };
  await syncWriteProjections(collection, record).catch((error) => {
    logWarn("Projection write skipped after update", { collection, id, error: error.message });
  });
  return record;
}

export async function upsertRecord(collection, id, payload) {
  const cleanPayload = assertNonEmptyFirestoreData(payload);
  const update = { ...cleanPayload, updatedAt: new Date().toISOString() };
  if (!firestore) {
    memoryStore[collection] = memoryStore[collection] || [];
    const index = memoryStore[collection].findIndex((item) => item.id === id);
    if (index >= 0) {
      memoryStore[collection][index] = { ...memoryStore[collection][index], ...update };
      await syncWriteProjections(collection, memoryStore[collection][index]);
      return memoryStore[collection][index];
    }
    const record = { id, ...update, createdAt: new Date().toISOString() };
    memoryStore[collection].push(record);
    await syncWriteProjections(collection, record);
    return record;
  }
  await firestore.collection(collection).doc(id).set(update, { merge: true });
  const doc = await firestore.collection(collection).doc(id).get();
  recordFirestoreRead({ collection, operation: "upsert-readback", signature: readSignature(collection, "upsert-readback", [["id", hashValue(id)]]), documentsReturned: doc.exists ? 1 : 0, estimatedReads: 1 });
  const record = { id: doc.id, ...doc.data() };
  await syncWriteProjections(collection, record).catch((error) => {
    logWarn("Projection write skipped after upsert", { collection, id, error: error.message });
  });
  return record;
}

export async function incrementRecord(collection, id, increments = {}, base = {}) {
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
    return next;
  }
  const { FieldValue } = await import("firebase-admin/firestore");
  const update = { ...base, updatedAt: now };
  for (const [key, value] of Object.entries(increments)) {
    update[key] = FieldValue.increment(Number(value || 0));
  }
  await firestore.collection(collection).doc(id).set(update, { merge: true });
  const doc = await firestore.collection(collection).doc(id).get();
  return { id: doc.id, ...doc.data() };
}

export async function deleteRecord(collection, id) {
  if (!firestore) {
    memoryStore[collection] = (memoryStore[collection] || []).filter((item) => item.id !== id);
    return true;
  }
  const ref = await resolveDocumentRef(collection, id);
  await ref.delete();
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
