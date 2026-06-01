import { firestore } from "../firebase/admin.js";
import { assertNonEmptyFirestoreData } from "../utils/firestoreSanitizer.js";
import { assertLeadQueryScoped, clampQueryLimit, withQueryMonitoring } from "./queryGovernance.service.js";
import { logWarn } from "./logger.service.js";

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
};

let memoryBackfillCounter = 0;

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
    return record;
  }
  await firestore.collection(collection).doc(record.id).set(record);
  return record;
}

export async function listRecords(collection) {
  if (process.env.NODE_ENV === "production" && collection === "leads") {
    const error = new Error("Unbounded lead reads are disabled in production");
    error.status = 400;
    error.code = "UNBOUNDED_LEAD_READ_DISABLED";
    throw error;
  }
  if (!firestore) return memoryStore[collection] || [];
  const snapshot = await firestore.collection(collection).get();
  const pairs = snapshot.docs
    .map((doc) => ({ doc, record: { id: doc.id, ...doc.data() } }))
    .sort((left, right) => String(right.record.createdAt || "").localeCompare(String(left.record.createdAt || "")));
  const records = pairs.map((pair) => pair.record);
  if (collection === "leads") return withLeadCaseIds(records, pairs.map((pair) => pair.doc));
  return records;
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
    if (collection === "leads" && isMissingCompositeIndexError(error) && where.length) {
      return fallbackIndexedQuery({ collection, where, orderBy, direction, safeLimit, parsedCursor, offset, search, searchFields, fields, maxLimit });
    }
    throw error;
  }
  let rows = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
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
      return snapshot.data().count || 0;
    }
    const snapshot = await ref.select().get();
    return snapshot.size;
  });
}

export async function getRecord(collection, id) {
  if (!firestore) return (memoryStore[collection] || []).find((item) => item.id === id || (collection === "leads" && item.caseId === id)) || null;
  const ref = await resolveDocumentRef(collection, id);
  const doc = await ref.get();
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
    return updated;
  }
  const ref = await resolveDocumentRef(collection, id);
  await ref.update(update);
  const doc = await ref.get();
  return { ...doc.data(), id: doc.id };
}

export async function upsertRecord(collection, id, payload) {
  const cleanPayload = assertNonEmptyFirestoreData(payload);
  const update = { ...cleanPayload, updatedAt: new Date().toISOString() };
  if (!firestore) {
    memoryStore[collection] = memoryStore[collection] || [];
    const index = memoryStore[collection].findIndex((item) => item.id === id);
    if (index >= 0) {
      memoryStore[collection][index] = { ...memoryStore[collection][index], ...update };
      return memoryStore[collection][index];
    }
    const record = { id, ...update, createdAt: new Date().toISOString() };
    memoryStore[collection].push(record);
    return record;
  }
  await firestore.collection(collection).doc(id).set(update, { merge: true });
  return { id, ...update };
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
