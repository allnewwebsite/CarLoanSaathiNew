import crypto from "node:crypto";
import { firestore } from "../firebase/admin.js";
import { recordFirestoreWrite, clearRequestCachedValue, getRequestCachedValue, setRequestCachedValue } from "./requestScope.service.js";
import { clearCachedValue } from "./ttlCache.service.js";

export const memoryStore = {
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
  systemCounters: [],
  workflowLogViews: [],
  bankBranchCatalog: [],
};

export const PRODUCTION_FULL_SCAN_DENYLIST = new Set([
  "authAuditLogs",
  "auditLogs",
  "bankDocuments",
  "documents",
  "leadTimeline",
  "loginActivity",
  "notifications",
  "userSessions",
]);

export const DIAGNOSTIC_QUERY_COLLECTIONS = new Set([
  "adminViews",
  "financeViews",
  "gmViews",
  "bankViews",
  "executiveViews",
  "leads",
]);

export const DIRECT_ID_ONLY_COLLECTIONS = new Set([
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

export function hashValue(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value ?? "")).digest("hex").slice(0, 12);
}

export function readSignature(collection, operation, parts = []) {
  const normalized = parts
    .filter(Boolean)
    .map((part) => Array.isArray(part) ? part.join(":") : String(part))
    .sort()
    .join("|");
  return `${collection}:${operation}:${normalized}`;
}

export function whereSignature(where = []) {
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

export async function withLeadCaseIds(records, docs = []) {
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

export async function resolveDocumentRef(collection, id) {
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

export function readCacheKey(collection, operation, parts = {}) {
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

export function getRequestReadCache(key) {
  const value = getRequestCachedValue(key);
  return value === undefined ? undefined : cloneCachedValue(value);
}

export function setRequestReadCache(key, value) {
  setRequestCachedValue(key, cloneCachedValue(value));
  return value;
}

export function clearCollectionReadCache(collection) {
  clearRequestCachedValue(collectionCachePrefix(collection));
}

export function recordWriteMetric({ collection, operation, id = "", documentsWritten = 1, startedAt = Date.now() }) {
  recordFirestoreWrite({
    collection,
    operation,
    signature: readSignature(collection, operation, id ? [["id", hashValue(id)]] : []),
    documentsWritten,
    estimatedWrites: documentsWritten,
    durationMs: Date.now() - startedAt,
  });
}

export function clearAuthCacheForWrite(collection, id = "") {
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
    if (id) {
      const normalizedId = String(id).trim().toLowerCase();
      clearCachedValue(`auth:dealership:${normalizedId}`);
      clearCachedValue(`auth:approved-dealership:${normalizedId}`);
      clearCachedValue("auth:approved-dealership:");
    } else {
      clearCachedValue("auth:dealership:");
      clearCachedValue("auth:approved-dealership:");
    }
  }
}
