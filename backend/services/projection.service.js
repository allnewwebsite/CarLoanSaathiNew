import { getRecord, queryRecords, upsertRecord } from "./firestore.service.js";
import { pageResponse, paginationParams } from "../utils/pagination.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";
import { logInfo, logWarn } from "./logger.service.js";
import { recordMonitoringSignal } from "./monitoringCenter.service.js";

export const PROJECTION_VERSION = Number(process.env.PROJECTION_VERSION || 2);
const PROJECTION_VALIDATION_SAMPLE_LIMIT = Number(process.env.PROJECTION_VALIDATION_SAMPLE_LIMIT || 3);
const rebuilding = new Set();
const LEAD_VIEW_COLLECTIONS = new Set(["adminViews", "financeViews", "gmViews", "bankViews", "executiveViews", "leadDetailsProjection", "bankDealershipViews"]);
const NOTIFICATION_VIEW_COLLECTIONS = new Set(["adminViews", "financeViews", "gmViews", "bankViews", "executiveViews"]);

const VIEW_LEAD_FIELDS = [
  "id",
  "caseId",
  "fullName",
  "customerName",
  "mobile",
  "city",
  "carPrice",
  "carOnRoadPrice",
  "loanAmount",
  "requiredLoanAmount",
  "status",
  "createdAt",
  "updatedAt",
  "generatedAt",
  "statusUpdatedAt",
  "dealershipId",
  "dealershipEmail",
  "dealershipName",
  "dealershipCity",
  "dealerName",
  "dealerEmail",
  "dealerMobile",
  "salespersonId",
  "salespersonName",
  "salespersonJobId",
  "salespersonEmail",
  "assignedSalesperson",
  "financeManagerId",
  "financeManagerName",
  "financeManagerMobile",
  "financeManagerEmail",
  "financeManagerEmployeeId",
  "assignedFinanceManager",
  "bankId",
  "bankName",
  "assignedBankName",
  "assignedBankIfsc",
  "ifscCode",
  "assignedExecutiveId",
  "assignedExecutiveEmail",
  "assignedExecutiveName",
  "assignedExecutiveMobile",
  "pendingDocuments",
  "pendingDocumentReason",
  "updatedByExecutiveName",
  "loanExecutiveRemarks",
  "bankRemarks",
  "sanctionLetterDocumentId",
  "sanctionLetterUploadedAt",
];

const VIEW_SEARCH_FIELDS = ["caseId", "fullName", "customerName", "mobile", "city", "bankName", "assignedBankName", "assignedExecutiveName", "salespersonName", "salespersonJobId", "salespersonEmail", "assignedSalesperson", "financeManagerName", "financeManagerEmployeeId", "financeManagerEmail", "assignedFinanceManager"];
const PROJECTION_META_FIELDS = [
  "projectionVersion",
  "projectionType",
  "projectionUpdatedAt",
  "projectionLastUpdatedAt",
  "sourceUpdatedAt",
  "projectionLagMs",
  "projectionHealthStatus",
  "projectionHealthCheckedAt",
  "projectionHealthReason",
];

function pick(record = {}, fields = VIEW_LEAD_FIELDS) {
  return fields.reduce((next, field) => {
    if (Object.prototype.hasOwnProperty.call(record, field)) next[field] = record[field];
    return next;
  }, { id: record.id });
}

function scopeId(value) {
  return String(value || "").trim();
}

function safeDocId(value) {
  return String(value || "").trim().replace(/[^\w.@-]/g, "_").slice(0, 420);
}

function timestampValue(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime() || 0;
  if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function latestTimestamp(...values) {
  return values
    .filter(Boolean)
    .sort((left, right) => timestampValue(right) - timestampValue(left))[0] || "";
}

function isoNow() {
  return new Date().toISOString();
}

function recordProjectionMetric(tag, meta = {}) {
  recordMonitoringSignal(tag, meta);
  logInfo(tag, {
    tag,
    requestId: meta.requestId || null,
    collection: meta.collection || null,
    role: meta.role || null,
    resultCount: meta.resultCount || 0,
    durationMs: meta.durationMs || 0,
    reason: meta.reason || null,
  });
}

function projectionMetadata({ sourceCollection, sourceId, sourceUpdatedAt, projectionType }) {
  const projectionUpdatedAt = isoNow();
  const sourceTime = timestampValue(sourceUpdatedAt);
  const projectionTime = timestampValue(projectionUpdatedAt);
  return {
    projectionVersion: PROJECTION_VERSION,
    projectionType,
    projectionUpdatedAt,
    projectionLastUpdatedAt: projectionUpdatedAt,
    sourceCollection,
    sourceId: sourceId || null,
    sourceUpdatedAt: sourceUpdatedAt || projectionUpdatedAt,
    projectionLagMs: sourceTime ? Math.max(0, projectionTime - sourceTime) : 0,
    projectionHealthStatus: "fresh",
    projectionHealthCheckedAt: projectionUpdatedAt,
  };
}

function withProjectionMetadata(payload = {}, meta = {}) {
  return {
    ...payload,
    ...projectionMetadata({
      sourceCollection: meta.sourceCollection || payload.sourceCollection,
      sourceId: meta.sourceId || payload.sourceId,
      sourceUpdatedAt: meta.sourceUpdatedAt || payload.updatedAt || payload.createdAt,
      projectionType: meta.projectionType || payload.viewType || payload.projectionType || "projection",
    }),
  };
}

function freshnessProblem(record = {}) {
  if (!record) return "missing";
  if (Number(record.projectionVersion || 0) !== PROJECTION_VERSION) return "version_mismatch";
  if (!record.projectionUpdatedAt || !record.sourceUpdatedAt) return "missing_freshness_metadata";
  if (record.projectionHealthStatus === "stale" || record.projectionHealthStatus === "rebuild-failed") return record.projectionHealthStatus;
  return "";
}

async function markProjectionStale(collection, record = {}, reason = "stale") {
  if (!record?.id) return;
  if (record.projectionHealthStatus === "stale" && record.projectionHealthReason === reason) return;
  recordMonitoringSignal("PROJECTION-STALE", {
    collection,
    projectionId: record.id,
    sourceId: record.sourceId || record.leadId || null,
    sourceCollection: record.sourceCollection || null,
    reason,
    projectionLagMs: Number(record.projectionLagMs || 0),
  });
  await upsertRecord(collection, record.id, {
    projectionHealthStatus: "stale",
    projectionHealthReason: reason,
    projectionHealthCheckedAt: isoNow(),
  }).catch(() => {});
}

async function rebuildLeadBasedProjection(collection, record = {}, reason = "stale") {
  const startedAt = Date.now();
  const leadId = scopeId(record.leadId || record.sourceId);
  if (!leadId) return false;
  const key = `lead:${leadId}`;
  if (rebuilding.has(key)) return true;
  rebuilding.add(key);
  try {
    const lead = await getRecord("leads", leadId).catch(() => null);
    if (!lead) return false;
    await syncLeadProjection(lead);
    recordMonitoringSignal("PROJECTION-REBUILD", {
      collection,
      projectionId: record.id,
      sourceId: leadId,
      sourceCollection: "leads",
      reason,
      durationMs: Date.now() - startedAt,
      projectionLagMs: Math.max(0, Date.now() - timestampValue(record.sourceUpdatedAt)),
    });
    logInfo("Projection self-heal rebuild completed", {
      tag: "PROJECTION-REBUILD",
      collection,
      leadId,
      reason,
      durationMs: Date.now() - startedAt,
    });
    return true;
  } catch (error) {
    logWarn("Projection self-heal rebuild failed", { leadId, reason, error: error.message });
    return false;
  } finally {
    rebuilding.delete(key);
  }
}

async function rebuildNotificationProjection(collection, record = {}, reason = "stale") {
  const startedAt = Date.now();
  const notificationId = scopeId(record.sourceId || record.id);
  if (!notificationId) return false;
  const key = `notification:${notificationId}`;
  if (rebuilding.has(key)) return true;
  rebuilding.add(key);
  try {
    const notification = await getRecord("notifications", notificationId).catch(() => null);
    if (!notification) return false;
    await syncNotificationProjection(notification);
    recordMonitoringSignal("PROJECTION-REBUILD", {
      collection,
      projectionId: record.id,
      sourceId: notificationId,
      sourceCollection: "notifications",
      reason,
      durationMs: Date.now() - startedAt,
      projectionLagMs: Math.max(0, Date.now() - timestampValue(record.sourceUpdatedAt)),
    });
    logInfo("Projection self-heal rebuild completed", {
      tag: "PROJECTION-REBUILD",
      collection,
      notificationId,
      reason,
      durationMs: Date.now() - startedAt,
    });
    return true;
  } catch (error) {
    logWarn("Notification projection self-heal rebuild failed", { collection, notificationId, reason, error: error.message });
    return false;
  } finally {
    rebuilding.delete(key);
  }
}

async function rebuildProjectionFromSource(collection, record = {}, reason = "stale") {
  if (LEAD_VIEW_COLLECTIONS.has(collection) && (record.viewType === "lead" || record.viewType === "lead-detail" || record.viewType === "bank-dealership" || record.sourceCollection === "leads")) {
    return rebuildLeadBasedProjection(collection, record, reason);
  }
  if (NOTIFICATION_VIEW_COLLECTIONS.has(collection) && (record.viewType === "notification" || record.sourceCollection === "notifications")) {
    return rebuildNotificationProjection(collection, record, reason);
  }
  if (collection === "timelineProjection") {
    const startedAt = Date.now();
    const sourceId = scopeId(record.sourceId || record.id);
    if (!sourceId) return false;
    const event = await getRecord("leadTimeline", sourceId).catch(() => null);
    if (!event) return false;
    await syncTimelineProjection(event);
    recordMonitoringSignal("PROJECTION-REBUILD", { collection, projectionId: record.id, sourceId, sourceCollection: "leadTimeline", reason, durationMs: Date.now() - startedAt });
    return true;
  }
  if (["staffViewProjection", "executiveSummaryProjection", "salespersonSummaryProjection"].includes(collection)) {
    const startedAt = Date.now();
    const sourceCollection = record.sourceCollection;
    const sourceId = scopeId(record.sourceId || record.id);
    if (!sourceCollection || !sourceId) return false;
    const source = await getRecord(sourceCollection, sourceId).catch(() => null);
    if (!source) return false;
    if (collection === "staffViewProjection") await syncStaffViewProjection({ ...source, sourceCollection });
    if (collection === "executiveSummaryProjection") await syncExecutiveSummaryProjection(source);
    if (collection === "salespersonSummaryProjection") await syncSalespersonSummaryProjection(source);
    recordMonitoringSignal("PROJECTION-REBUILD", { collection, projectionId: record.id, sourceId, sourceCollection, reason, durationMs: Date.now() - startedAt });
    return true;
  }
  recordMonitoringSignal("PROJECTION-REBUILD-SKIPPED", { collection, projectionId: record.id, sourceId: record.sourceId || record.leadId || null, sourceCollection: record.sourceCollection || null, reason: `${reason}:source_rebuild_not_available` });
  return false;
}

async function ensureFreshProjection(collection, record = {}) {
  const reason = freshnessProblem(record);
  if (!reason) {
    recordMonitoringSignal("PROJECTION-FRESHNESS", {
      collection,
      projectionLagMs: Number(record.projectionLagMs || 0),
    });
    return true;
  }
  await markProjectionStale(collection, record, reason);
  rebuildProjectionFromSource(collection, record, reason).catch(() => {});
  return false;
}

async function freshProjectionRows(collection, rows = []) {
  if (!rows.length) return rows;
  const checks = await Promise.all(rows.map((row) => ensureFreshProjection(collection, row)));
  return rows.filter((_, index) => checks[index]);
}

function projectionPayload(lead = {}, { scopeType, scopeId: scope }) {
  const projected = pick(lead);
  const updatedAt = latestTimestamp(lead.statusUpdatedAt, lead.updatedAt, lead.generatedAt, lead.createdAt) || new Date().toISOString();
  return withProjectionMetadata({
    ...projected,
    viewType: "lead",
    sourceCollection: "leads",
    sourceId: lead.id,
    scopeType,
    scopeId: scope,
    createdAt: lead.createdAt || updatedAt,
    updatedAt,
    status: lead.status || "NEW",
    searchText: VIEW_SEARCH_FIELDS.map((field) => lead[field]).filter(Boolean).join(" ").toLowerCase(),
  }, { sourceCollection: "leads", sourceId: lead.id, sourceUpdatedAt: updatedAt, projectionType: "lead-view" });
}

function leadTargets(lead = {}) {
  const targets = [{ collection: "adminViews", scopeType: "admin", scopeId: "global", docId: safeDocId(`lead_${lead.id}`) }];
  const dealershipId = scopeId(lead.dealershipId || lead.dealershipEmail || lead.dealerEmail);
  if (dealershipId) {
    targets.push({ collection: "financeViews", scopeType: "dealership", scopeId: dealershipId, docId: safeDocId(`lead_${lead.id}`) });
    targets.push({ collection: "gmViews", scopeType: "dealership", scopeId: dealershipId, docId: safeDocId(`lead_${lead.id}`) });
  }
  const bankId = scopeId(lead.bankId || lead.assignedBankId || lead.assignedPartnerId);
  if (bankId) targets.push({ collection: "bankViews", scopeType: "bank", scopeId: bankId, docId: safeDocId(`lead_${lead.id}`) });
  [lead.assignedExecutiveId, lead.assignedExecutiveEmail].map(scopeId).filter(Boolean).forEach((executiveScope) => {
    targets.push({ collection: "executiveViews", scopeType: "executive", scopeId: executiveScope, docId: safeDocId(`lead_${lead.id}_${executiveScope}`) });
  });
  return targets;
}

export async function syncLeadProjection(lead = {}) {
  if (!lead?.id) return null;
  const targets = leadTargets(lead);
  await Promise.all(targets.map((target) => upsertRecord(
    target.collection,
    target.docId,
    projectionPayload(lead, target),
  )));
  await Promise.all([
    syncLeadDetailProjection(lead),
    syncBankDealershipProjection(lead),
  ]);
  return { synced: targets.length, leadId: lead.id };
}

export function syncLeadProjectionSoon(lead = {}) {
  Promise.resolve().then(() => syncLeadProjection(lead)).catch(() => {});
}

function notificationTargets(notification = {}) {
  const targets = [{ collection: "adminViews", scopeType: "admin", scopeId: "global", docId: safeDocId(`notification_${notification.id}`) }];
  const dealershipId = scopeId(notification.dealershipId || notification.dealerEmail || notification.meta?.dealershipId || notification.meta?.dealershipEmail);
  if (dealershipId) {
    targets.push({ collection: "financeViews", scopeType: "dealership", scopeId: dealershipId, docId: safeDocId(`notification_${notification.id}`) });
    targets.push({ collection: "gmViews", scopeType: "dealership", scopeId: dealershipId, docId: safeDocId(`notification_${notification.id}`) });
  }
  const bankId = scopeId(notification.bankId || notification.partnerId || notification.meta?.bankId || notification.meta?.assignedBankId || notification.meta?.assignedPartnerId);
  if (bankId) targets.push({ collection: "bankViews", scopeType: "bank", scopeId: bankId, docId: safeDocId(`notification_${notification.id}`) });
  const executiveScope = scopeId(notification.assignedExecutiveId || notification.recipientId || notification.meta?.assignedExecutiveId || notification.meta?.assignedExecutiveEmail);
  if (notification.recipientRole === "loan-executive" && executiveScope) {
    targets.push({ collection: "executiveViews", scopeType: "executive", scopeId: executiveScope, docId: safeDocId(`notification_${notification.id}_${executiveScope}`) });
  }
  return targets;
}

export async function syncNotificationProjection(notification = {}) {
  if (!notification?.id) return null;
  const targets = notificationTargets(notification);
  const updatedAt = notification.updatedAt || notification.readAt || notification.createdAt || new Date().toISOString();
  const payload = withProjectionMetadata({
    id: notification.id,
    sourceId: notification.id,
    sourceCollection: "notifications",
    viewType: "notification",
    title: notification.title || "",
    message: notification.message || "",
    read: notification.read === true,
    type: notification.type || notification.notificationType || "",
    priority: notification.priority || "normal",
    leadId: notification.leadId || null,
    caseId: notification.caseId || null,
    customerName: notification.leadSnapshot?.customerName || notification.meta?.customerName || "",
    status: notification.leadSnapshot?.status || notification.meta?.status || notification.status || "",
    actor: notification.actor || notification.actorName || notification.meta?.actor || "",
    createdAt: notification.createdAt || updatedAt,
    updatedAt,
  }, { sourceCollection: "notifications", sourceId: notification.id, sourceUpdatedAt: updatedAt, projectionType: "notification-view" });
  await Promise.all(targets.map((target) => upsertRecord(target.collection, target.docId, {
    ...payload,
    scopeType: target.scopeType,
    scopeId: target.scopeId,
  })));
  return { synced: targets.length, notificationId: notification.id };
}

export function syncNotificationProjectionSoon(notification = {}) {
  Promise.resolve().then(() => syncNotificationProjection(notification)).catch(() => {});
}

export async function queryLeadProjectionForUser({ user = {}, query = {}, fields = VIEW_LEAD_FIELDS, requestId = null, recordMetrics = true } = {}) {
  const projectionStartedAt = Date.now();
  const { limit, cursor, page } = paginationParams(query);
  const role = user.role;
  let collection = "adminViews";
  const where = [{ field: "viewType", value: "lead" }];

  if (role === "finance-desk") {
    collection = "financeViews";
    where.push({ field: "scopeId", value: scopeId(user.dealershipId || user.email || user.uid) });
  } else if (role === "gm-sm") {
    collection = "gmViews";
    where.push({ field: "scopeId", value: scopeId(user.dealershipId || user.email || user.uid) });
  } else if (role === "bank-manager") {
    collection = "bankViews";
    where.push({ field: "scopeId", value: scopeId(user.bankId || user.bankName || user.email || user.uid) });
  } else if (role === "loan-executive") {
    collection = "executiveViews";
    where.push({ field: "scopeId", value: scopeId(user.uid || user.email) });
  } else if (role !== "super-admin") {
    return null;
  }

  const statuses = statusValuesForProjectionQuery(query.status);
  if (statuses.length === 1) where.push({ field: "status", value: statuses[0] });
  if (statuses.length > 1 && statuses.length <= 10) where.push({ field: "status", op: "in", value: statuses });
  if (query.dealershipId) where.push({ field: "dealershipId", value: scopeId(query.dealershipId) });
  if (query.salespersonId) where.push({ field: "salespersonId", value: scopeId(query.salespersonId) });
  if (query.financeManagerId) where.push({ field: "financeManagerId", value: scopeId(query.financeManagerId) });
  try {
    const result = await queryRecords(collection, {
      where,
      orderBy: "createdAt",
      direction: "desc",
      limit,
      cursor,
      page,
      search: query.search,
      searchFields: ["searchText", ...VIEW_SEARCH_FIELDS],
      fields: [...new Set(["sourceId", "viewType", "scopeId", "leadId", ...PROJECTION_META_FIELDS, ...fields])],
      maxLimit: 100,
    });
    const durationMs = Date.now() - projectionStartedAt;
    const resultCount = Array.isArray(result.data) ? result.data.length : 0;
    logInfo("Lead projection lookup completed", {
      tag: "PROJECTION-LATENCY",
      requestId,
      collection,
      queryType: "lead-projection",
      role,
      durationMs,
      resultCount,
      returnedNull: resultCount === 0,
      fallbackTriggered: resultCount === 0,
      where: where.map((clause) => ({ field: clause.field, op: clause.op || "==" })),
      limit,
      page: page || null,
      cursor: Boolean(cursor),
      search: Boolean(query.search),
    });
    if (!resultCount) {
      if (recordMetrics) recordProjectionMetric("PROJECTION-MISS", { requestId, collection, role, resultCount, durationMs, reason: "empty_projection_result" });
      return null;
    }
    const freshRows = await freshProjectionRows(collection, result.data);
    if (!freshRows.length) {
      if (recordMetrics) recordProjectionMetric("PROJECTION-MISS", { requestId, collection, role, resultCount, durationMs: Date.now() - projectionStartedAt, reason: "stale_projection_rows" });
      return null;
    }
    const mapStartedAt = Date.now();
    const data = freshRows.map((item) => ({ ...item, id: item.sourceId || item.id }));
    const mapEndedAt = Date.now();
    const shapeStartedAt = Date.now();
    const response = pageResponse({ data, limit, nextCursor: result.nextCursor });
    const shapeEndedAt = Date.now();
    logInfo("Lead projection response shaping completed", {
      tag: "SERIALIZATION-LATENCY",
      requestId,
      function: "queryLeadProjectionForUser",
      collection,
      projectionMapDurationMs: mapEndedAt - mapStartedAt,
      responseShapeDurationMs: shapeEndedAt - shapeStartedAt,
      inputCount: resultCount,
      outputCount: data.length,
      financeManagerLookupCount: 0,
      executiveLookupCount: 0,
      dealershipLookupCount: 0,
      documentFormattingCount: 0,
    });
    if (recordMetrics) recordProjectionMetric("PROJECTION-HIT", { requestId, collection, role, resultCount: data.length, durationMs: Date.now() - projectionStartedAt });
    return response;
  } catch (error) {
    if (recordMetrics) recordProjectionMetric("PROJECTION-MISS", {
      requestId,
      collection,
      role,
      durationMs: Date.now() - projectionStartedAt,
      reason: error.code || error.message,
    });
    logWarn("Lead projection lookup failed", {
      tag: "PROJECTION-LATENCY",
      requestId,
      collection,
      queryType: "lead-projection",
      role,
      durationMs: Date.now() - projectionStartedAt,
      error: error.code || error.message,
      timeout: error.code === "FIRESTORE_QUERY_TIMEOUT",
      fallbackTriggered: true,
      where: where.map((clause) => ({ field: clause.field, op: clause.op || "==" })),
      limit,
      page: page || null,
      cursor: Boolean(cursor),
      search: Boolean(query.search),
    });
    throw error;
  }
}

function statusValuesForProjectionQuery(status) {
  const value = String(status || "").trim();
  if (!value) return [];
  const normalized = normalizeStatus(value);
  if (normalized === LEAD_STATUSES.NEW || value === "New Lead" || value === "New") return [LEAD_STATUSES.NEW, LEAD_STATUSES.ASSIGNED];
  if (value === "Bank Processing") return [LEAD_STATUSES.CONTACTED, LEAD_STATUSES.ALL_DOCUMENTS_RECEIVED, LEAD_STATUSES.UNDER_BANK_PROCESS, LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW];
  if (value === "Pending Documents") return [LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.DOCUMENT_RECEIVED, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING];
  if (value === "Disbursed") return [LEAD_STATUSES.DISBURSED, LEAD_STATUSES.CLOSED];
  if (value === "Rejected With Reason") return [LEAD_STATUSES.REJECTED];
  return [normalized];
}

function bankDealershipScope(lead = {}) {
  const bankId = scopeId(lead.bankId || lead.assignedBankId || lead.assignedPartnerId);
  const dealershipId = scopeId(lead.dealershipId || lead.dealershipEmail || lead.dealerEmail);
  if (!bankId || !dealershipId) return null;
  return { bankId, dealershipId };
}

function isDisbursedStatus(status) {
  return normalizeStatus(status) === LEAD_STATUSES.DISBURSED;
}

function isActiveStatus(status) {
  const normalized = normalizeStatus(status);
  return ![LEAD_STATUSES.DISBURSED, LEAD_STATUSES.REJECTED].includes(normalized);
}

function dealershipSummarySeed(lead = {}, scope = bankDealershipScope(lead)) {
  const updatedAt = latestTimestamp(lead.statusUpdatedAt, lead.updatedAt, lead.generatedAt, lead.createdAt) || new Date().toISOString();
  return withProjectionMetadata({
    id: safeDocId(`bank_dealership_${scope.bankId}_${scope.dealershipId}`),
    viewType: "bank-dealership",
    sourceCollection: "leads",
    sourceId: lead.id,
    leadId: lead.id,
    bankId: scope.bankId,
    dealershipId: scope.dealershipId,
    dealershipName: lead.dealershipName || lead.dealerName || lead.dealerBusinessName || lead.dealershipEmail || lead.dealerEmail || scope.dealershipId,
    dealershipEmail: lead.dealershipEmail || lead.dealerEmail || "",
    dealerName: lead.dealerName || lead.dealershipName || "",
    dealerMobile: lead.dealerMobile || lead.dealershipMobile || "",
    city: lead.dealershipCity || lead.dealerCity || lead.city || "",
    dealershipCity: lead.dealershipCity || lead.dealerCity || lead.city || "",
    bankName: lead.bankName || lead.assignedBankName || "",
    bankIfsc: lead.assignedBankIfsc || lead.ifscCode || "",
    firstLeadAt: lead.createdAt || updatedAt,
    lastLeadAt: updatedAt,
    updatedAt,
    searchText: [
      lead.dealershipName,
      lead.dealerName,
      lead.dealershipEmail,
      lead.dealerEmail,
      lead.dealershipCity,
      lead.dealerCity,
      lead.city,
      lead.assignedBankName,
    ].filter(Boolean).join(" ").toLowerCase(),
  }, { sourceCollection: "leads", sourceId: lead.id, sourceUpdatedAt: updatedAt, projectionType: "bank-dealership" });
}

async function applyBankDealershipDelta({ summaryId, seed, totalDelta = 0, disbursedDelta = 0, activeDelta = 0 }) {
  const current = await getRecord("bankDealershipViews", summaryId).catch(() => null);
  const nextTotal = Math.max(0, Number(current?.totalCases || 0) + totalDelta);
  const nextDisbursed = Math.max(0, Number(current?.totalDisbursedCases || 0) + disbursedDelta);
  const nextActive = Math.max(0, Number(current?.activeCases || 0) + activeDelta);
  await upsertRecord("bankDealershipViews", summaryId, {
    ...(current || {}),
    ...seed,
    totalCases: nextTotal,
    totalDisbursedCases: nextDisbursed,
    activeCases: nextActive,
    updatedAt: seed.updatedAt,
    lastLeadAt: seed.lastLeadAt || current?.lastLeadAt || seed.updatedAt,
  });
}

export async function syncBankDealershipProjection(lead = {}) {
  if (!lead?.id) return null;
  const scope = bankDealershipScope(lead);
  if (!scope) return null;
  const now = new Date().toISOString();
  const markerId = safeDocId(`bank_dealership_lead_${lead.id}`);
  const previous = await getRecord("bankDealershipLeadProjection", markerId).catch(() => null);
  const summaryId = safeDocId(`bank_dealership_${scope.bankId}_${scope.dealershipId}`);
  const seed = dealershipSummarySeed(lead, scope);
  const currentDisbursed = isDisbursedStatus(lead.status);
  const currentActive = isActiveStatus(lead.status);
  const sameRelationship = previous?.bankId === scope.bankId && previous?.dealershipId === scope.dealershipId;

  if (previous && !sameRelationship) {
    const previousSummaryId = safeDocId(`bank_dealership_${previous.bankId}_${previous.dealershipId}`);
    await applyBankDealershipDelta({
      summaryId: previousSummaryId,
      seed: {
        id: previousSummaryId,
        viewType: "bank-dealership",
        bankId: previous.bankId,
        dealershipId: previous.dealershipId,
        updatedAt: now,
      },
      totalDelta: -1,
      disbursedDelta: previous.isDisbursed ? -1 : 0,
      activeDelta: previous.isActive ? -1 : 0,
    });
  }

  await applyBankDealershipDelta({
    summaryId,
    seed,
    totalDelta: sameRelationship ? 0 : 1,
    disbursedDelta: (currentDisbursed ? 1 : 0) - (sameRelationship && previous?.isDisbursed ? 1 : 0),
    activeDelta: (currentActive ? 1 : 0) - (sameRelationship && previous?.isActive ? 1 : 0),
  });

  const marker = withProjectionMetadata({
    id: markerId,
    sourceCollection: "leads",
    sourceId: lead.id,
    leadId: lead.id,
    caseId: lead.caseId || lead.id,
    bankId: scope.bankId,
    dealershipId: scope.dealershipId,
    status: lead.status || LEAD_STATUSES.NEW,
    isDisbursed: currentDisbursed,
    isActive: currentActive,
    updatedAt: now,
    createdAt: previous?.createdAt || lead.createdAt || now,
  }, { sourceCollection: "leads", sourceId: lead.id, sourceUpdatedAt: now, projectionType: "bank-dealership-marker" });
  await upsertRecord("bankDealershipLeadProjection", markerId, marker);
  return marker;
}

export function syncBankDealershipProjectionSoon(lead = {}) {
  Promise.resolve().then(() => syncBankDealershipProjection(lead)).catch(() => {});
}

export async function queryBankDealershipProjection({ bankId, query = {} } = {}) {
  const scope = scopeId(bankId);
  if (!scope) return null;
  const { limit, cursor, page } = paginationParams({ ...query, limit: query.limit || 20 });
  const result = await queryRecords("bankDealershipViews", {
    where: [
      { field: "viewType", value: "bank-dealership" },
      { field: "bankId", value: scope },
    ],
    orderBy: "lastLeadAt",
    direction: "desc",
    limit,
    cursor,
    page,
    search: query.search,
    searchFields: ["searchText"],
    fields: [
      "id",
      "viewType",
      "sourceId",
      "leadId",
      ...PROJECTION_META_FIELDS,
      "bankId",
      "dealershipId",
      "dealershipName",
      "dealershipEmail",
      "dealerName",
      "dealerMobile",
      "city",
      "dealershipCity",
      "bankName",
      "bankIfsc",
      "totalCases",
      "activeCases",
      "totalDisbursedCases",
      "firstLeadAt",
      "lastLeadAt",
      "updatedAt",
    ],
    maxLimit: 100,
  });
  const freshRows = await freshProjectionRows("bankDealershipViews", result.data);
  if (!freshRows.length) return null;
  return pageResponse({ data: freshRows, limit, nextCursor: result.nextCursor });
}

export async function queryNotificationProjectionForUser({ user = {}, query = {} } = {}) {
  const { limit, cursor, page } = paginationParams({ ...query, limit: query.limit || 40 });
  const role = user.role;
  let collection = "adminViews";
  const where = [{ field: "viewType", value: "notification" }];

  if (role === "finance-desk") {
    collection = "financeViews";
    where.push({ field: "scopeId", value: scopeId(user.dealershipId || user.email || user.uid) });
  } else if (role === "gm-sm") {
    collection = "gmViews";
    where.push({ field: "scopeId", value: scopeId(user.dealershipId || user.email || user.uid) });
  } else if (role === "bank-manager") {
    collection = "bankViews";
    where.push({ field: "scopeId", value: scopeId(user.bankId || user.bankName || user.email || user.uid) });
  } else if (role === "loan-executive") {
    collection = "executiveViews";
    where.push({ field: "scopeId", value: scopeId(user.uid || user.email) });
  } else if (role !== "super-admin") {
    return null;
  }

  const result = await queryRecords(collection, {
    where,
    orderBy: "createdAt",
    direction: "desc",
    limit,
    cursor,
    page,
    maxLimit: 100,
    fields: [
      "sourceId",
      "viewType",
      "scopeId",
      ...PROJECTION_META_FIELDS,
      "title",
      "message",
      "read",
      "type",
      "priority",
      "leadId",
      "caseId",
      "status",
      "actor",
      "createdAt",
      "updatedAt",
    ],
  });
  if (!result.data.length) return null;
  const freshRows = await freshProjectionRows(collection, result.data);
  if (!freshRows.length) return null;
  return pageResponse({
    data: freshRows.map((item) => ({ ...item, id: item.sourceId || item.id })),
    limit,
    nextCursor: result.nextCursor,
  });
}

export async function syncLeadDetailProjection(lead = {}, extras = {}) {
  if (!lead?.id) return null;
  const updatedAt = latestTimestamp(lead.statusUpdatedAt, lead.updatedAt, lead.generatedAt, lead.createdAt) || new Date().toISOString();
  const documentCounts = extras.documentCounts || {
    documents: Array.isArray(extras.documents) ? extras.documents.length : Number(lead.documentCount || 0),
    bankDocuments: Array.isArray(extras.bankDocuments) ? extras.bankDocuments.length : Number(lead.bankDocumentCount || 0),
    pendingDocuments: Array.isArray(lead.pendingDocuments) ? lead.pendingDocuments.length : 0,
  };
  const payload = withProjectionMetadata({
    ...pick(lead),
    sourceCollection: "leads",
    sourceId: lead.id,
    viewType: "lead-detail",
    leadId: lead.id,
    caseId: lead.caseId || lead.id,
    customerSummary: {
      name: lead.fullName || lead.customerName || "",
      mobile: lead.mobile || "",
      city: lead.city || "",
    },
    executiveSummary: {
      id: lead.assignedExecutiveId || "",
      email: lead.assignedExecutiveEmail || "",
      name: lead.assignedExecutiveName || "",
      mobile: lead.assignedExecutiveMobile || "",
    },
    statusSummary: {
      status: lead.status || "NEW",
      statusUpdatedAt: lead.statusUpdatedAt || updatedAt,
      updatedByExecutiveName: lead.updatedByExecutiveName || "",
      loanExecutiveRemarks: lead.loanExecutiveRemarks || "",
    },
    documentCounts,
    timelineSummary: extras.timelineSummary || lead.timelineSummary || null,
    updatedAt,
    createdAt: lead.createdAt || updatedAt,
    searchText: VIEW_SEARCH_FIELDS.map((field) => lead[field]).filter(Boolean).join(" ").toLowerCase(),
  }, { sourceCollection: "leads", sourceId: lead.id, sourceUpdatedAt: updatedAt, projectionType: "lead-detail" });
  if (Array.isArray(extras.documents)) payload.documents = extras.documents;
  if (Array.isArray(extras.bankDocuments)) payload.bankDocuments = extras.bankDocuments;
  await upsertRecord("leadDetailsProjection", safeDocId(lead.id), payload);
  return payload;
}

export function syncLeadDetailProjectionSoon(lead = {}, extras = {}) {
  Promise.resolve().then(() => syncLeadDetailProjection(lead, extras)).catch(() => {});
}

export async function getLeadDetailProjection(leadId) {
  const id = scopeId(leadId);
  if (!id) return null;
  const direct = await queryRecords("leadDetailsProjection", {
    where: [{ field: "leadId", value: id }],
    orderBy: "updatedAt",
    direction: "desc",
    limit: 1,
    maxLimit: 1,
  });
  const row = direct.data[0] || null;
  if (!row) return null;
  return await ensureFreshProjection("leadDetailsProjection", row) ? row : null;
}

export async function syncTimelineProjection(event = {}) {
  if (!event?.id) return null;
  const metadata = event.metadata || {};
  const timestamp = event.createdAt || event.updatedAt || new Date().toISOString();
  const payload = withProjectionMetadata({
    id: event.id,
    sourceCollection: "leadTimeline",
    sourceId: event.id,
    viewType: "timeline",
    leadId: event.leadId || "",
    caseId: event.caseId || metadata.caseId || "",
    eventType: event.eventType || event.type || "",
    title: event.title || "",
    description: event.description || "",
    actorId: event.actorId || "",
    actorName: event.actorName || "",
    actorRole: event.actorRole || "",
    status: metadata.nextStatus || metadata.status || event.status || "",
    dealershipId: event.dealershipId || event.dealershipEmail || metadata.dealershipId || metadata.dealershipEmail || "",
    dealershipEmail: event.dealershipEmail || metadata.dealershipEmail || "",
    bankId: event.bankId || metadata.bankId || metadata.assignedBankId || metadata.assignedPartnerId || "",
    branchId: event.branchId || metadata.branchId || metadata.bankBranchId || metadata.ifscCode || metadata.assignedBankIfsc || "",
    assignedExecutiveId: event.assignedExecutiveId || metadata.assignedExecutiveId || event.assignedExecutiveEmail || metadata.assignedExecutiveEmail || "",
    assignedExecutiveEmail: event.assignedExecutiveEmail || metadata.assignedExecutiveEmail || "",
    visibility: event.visibility || [],
    metadata,
    searchText: [
      event.leadId,
      event.caseId,
      event.title,
      event.description,
      event.actorName,
      event.actorRole,
      event.eventType,
      metadata.customerName,
      metadata.executiveName,
    ].filter(Boolean).join(" ").toLowerCase(),
    createdAt: timestamp,
    updatedAt: event.updatedAt || timestamp,
  }, { sourceCollection: "leadTimeline", sourceId: event.id, sourceUpdatedAt: event.updatedAt || timestamp, projectionType: "timeline" });
  await upsertRecord("timelineProjection", safeDocId(event.id), payload);
  return payload;
}

export function syncTimelineProjectionSoon(event = {}) {
  Promise.resolve().then(() => syncTimelineProjection(event)).catch(() => {});
}

export async function queryTimelineProjection({ leadId = "", query = {}, actor = {} } = {}) {
  const { limit, cursor, page } = paginationParams({ ...query, limit: query.limit || 20 });
  const where = [{ field: "viewType", value: "timeline" }];
  if (leadId) where.push({ field: "leadId", value: leadId });
  if (query.eventType) where.push({ field: "eventType", value: String(query.eventType).trim() });
  if (actor.role === "finance-desk" || actor.role === "gm-sm") {
    where.push({ field: "dealershipId", value: scopeId(actor.dealershipId || actor.email || actor.uid) });
  } else if (actor.role === "bank-manager") {
    where.push({ field: "bankId", value: scopeId(actor.bankId || actor.bankName || actor.email || actor.uid) });
  } else if (actor.role === "loan-executive") {
    where.push({ field: "assignedExecutiveId", value: scopeId(actor.uid || actor.email) });
  }
  const result = await queryRecords("timelineProjection", {
    where,
    orderBy: "createdAt",
    direction: "desc",
    limit,
    cursor,
    page,
    maxLimit: 100,
    search: query.search,
    searchFields: ["searchText"],
  });
  if (!result.data.length) return null;
  const freshRows = await freshProjectionRows("timelineProjection", result.data);
  if (!freshRows.length) return null;
  return pageResponse({
    data: freshRows.map((item) => ({ ...item, id: item.sourceId || item.id })),
    limit,
    nextCursor: result.nextCursor,
  });
}

function staffProjectionPayload(record = {}) {
  const email = scopeId(record.email || record.officialEmail || record.id).toLowerCase();
  const dealershipId = scopeId(record.dealershipId || record.dealershipEmail);
  return withProjectionMetadata({
    id: safeDocId(`staff_${dealershipId}_${email}`),
    sourceId: record.id || email,
    sourceCollection: record.sourceCollection || record.sourceCollections?.[0] || "staff",
    viewType: "staff",
    dealershipId,
    dealershipEmail: dealershipId,
    uid: record.uid || record.authUid || "",
    email,
    officialEmail: email,
    fullName: record.fullName || record.name || record.headName || email,
    name: record.name || record.fullName || record.headName || email,
    mobile: record.mobile || record.headMobile || record.officialMobile || "",
    employeeId: record.employeeId || record.jobId || record.employeeCode || "",
    jobId: record.jobId || record.employeeId || "",
    role: record.role || "",
    roleLabel: record.roleLabel || record.role || "",
    portal: record.portal || record.portalType || "",
    status: record.active === false || record.accountActive === false ? "inactive" : record.status || record.accountStatus || "active",
    active: record.active !== false && record.accountActive !== false,
    branch: record.branch || record.city || record.location || record.dealershipCity || "",
    city: record.city || record.branch || "",
    caseCounts: record.caseCounts || {},
    permissions: record.permissions || [],
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || new Date().toISOString(),
  }, {
    sourceCollection: record.sourceCollection || record.sourceCollections?.[0] || "staff",
    sourceId: record.id || email,
    sourceUpdatedAt: record.updatedAt || record.createdAt || new Date().toISOString(),
    projectionType: "staff",
  });
}

export async function syncStaffViewProjection(record = {}) {
  const payload = staffProjectionPayload(record);
  if (!payload.email || !payload.dealershipId) return null;
  await upsertRecord("staffViewProjection", payload.id, payload);
  return payload;
}

export function syncStaffViewProjectionSoon(record = {}) {
  Promise.resolve().then(() => syncStaffViewProjection(record)).catch(() => {});
}

export async function queryStaffViewProjection({ dealershipId, query = {} } = {}) {
  const scope = scopeId(dealershipId);
  if (!scope) return null;
  const { limit, cursor, page } = paginationParams({ ...query, limit: query.limit || 100 });
  const result = await queryRecords("staffViewProjection", {
    where: [{ field: "dealershipId", value: scope }],
    orderBy: "createdAt",
    direction: "desc",
    limit,
    cursor,
    page,
    maxLimit: 100,
  });
  if (!result.data.length) return null;
  const freshRows = await freshProjectionRows("staffViewProjection", result.data);
  return freshRows.length ? freshRows : null;
}

export async function syncExecutiveSummaryProjection(executive = {}, counts = {}) {
  const bankId = scopeId(executive.bankId || executive.bankPartnerId || executive.partnerId);
  const executiveId = scopeId(executive.id || executive.jobId || executive.email || executive.mobile);
  if (!bankId || !executiveId) return null;
  const updatedAt = executive.updatedAt || new Date().toISOString();
  const payload = withProjectionMetadata({
    ...executive,
    id: safeDocId(`executive_${bankId}_${executiveId}`),
    sourceId: executive.id || executiveId,
    viewType: "executive-summary",
    bankId,
    executiveId,
    email: executive.email || executive.officialEmail || "",
    mobile: executive.mobile || "",
    name: executive.name || executive.fullName || executive.email || "",
    totalAssignedCases: Number(counts.totalAssignedCases || executive.totalAssignedCases || 0),
    currentActiveCases: Number(counts.currentActiveCases || executive.currentActiveCases || 0),
    status: executive.active === false ? "inactive" : executive.status || "active",
    updatedAt,
    createdAt: executive.createdAt || updatedAt,
  }, { sourceCollection: "loanExecutives", sourceId: executive.id || executiveId, sourceUpdatedAt: updatedAt, projectionType: "executive-summary" });
  await upsertRecord("executiveSummaryProjection", payload.id, payload);
  return payload;
}

export function syncExecutiveSummaryProjectionSoon(executive = {}, counts = {}) {
  Promise.resolve().then(() => syncExecutiveSummaryProjection(executive, counts)).catch(() => {});
}

export async function queryExecutiveSummaryProjection({ bankId, query = {} } = {}) {
  const scope = scopeId(bankId);
  if (!scope) return null;
  const { limit, cursor, page } = paginationParams({ ...query, limit: query.limit || 100 });
  const result = await queryRecords("executiveSummaryProjection", {
    where: [{ field: "bankId", value: scope }],
    orderBy: "createdAt",
    direction: "desc",
    limit,
    cursor,
    page,
    maxLimit: 100,
  });
  if (!result.data.length) return null;
  const freshRows = await freshProjectionRows("executiveSummaryProjection", result.data);
  return freshRows.length ? freshRows : null;
}

export async function syncSalespersonSummaryProjection(person = {}, counts = {}) {
  const dealershipId = scopeId(person.dealershipId || person.dealershipEmail);
  const salespersonId = scopeId(person.id || person.jobId || person.email || person.mobile);
  if (!dealershipId || !salespersonId) return null;
  const updatedAt = person.updatedAt || new Date().toISOString();
  const payload = withProjectionMetadata({
    ...person,
    id: safeDocId(`salesperson_${dealershipId}_${salespersonId}`),
    sourceId: person.id || salespersonId,
    viewType: "salesperson-summary",
    dealershipId,
    salespersonId,
    name: person.name || person.fullName || person.email || "",
    mobile: person.mobile || "",
    jobId: person.jobId || person.employeeId || "",
    email: person.email || "",
    active: person.active !== false,
    totalCases: Number(counts.totalCases || person.totalCases || 0),
    disbursedCases: Number(counts.disbursedCases || person.disbursedCases || 0),
    rejectedCases: Number(counts.rejectedCases || person.rejectedCases || 0),
    pendingCases: Number(counts.pendingCases || person.pendingCases || 0),
    updatedAt,
    createdAt: person.createdAt || updatedAt,
  }, { sourceCollection: person.sourceCollection || "salespersons", sourceId: person.id || salespersonId, sourceUpdatedAt: updatedAt, projectionType: "salesperson-summary" });
  await upsertRecord("salespersonSummaryProjection", payload.id, payload);
  return payload;
}

export function syncSalespersonSummaryProjectionSoon(person = {}, counts = {}) {
  Promise.resolve().then(() => syncSalespersonSummaryProjection(person, counts)).catch(() => {});
}

export async function querySalespersonSummaryProjection({ dealershipId, query = {} } = {}) {
  const scope = scopeId(dealershipId);
  if (!scope) return null;
  const { limit, cursor, page } = paginationParams({ ...query, limit: query.limit || 100 });
  const result = await queryRecords("salespersonSummaryProjection", {
    where: [{ field: "dealershipId", value: scope }],
    orderBy: "createdAt",
    direction: "desc",
    limit,
    cursor,
    page,
    maxLimit: 100,
  });
  if (!result.data.length) return null;
  const freshRows = await freshProjectionRows("salespersonSummaryProjection", result.data);
  return freshRows.length ? freshRows : null;
}

const VALIDATED_PROJECTION_COLLECTIONS = [
  "adminViews",
  "financeViews",
  "gmViews",
  "bankViews",
  "executiveViews",
  "leadDetailsProjection",
  "staffViewProjection",
  "salespersonSummaryProjection",
  "timelineProjection",
  "bankDealershipViews",
];

async function projectionDriftReason(record = {}) {
  const metadataReason = freshnessProblem(record);
  if (metadataReason) return metadataReason;
  if (!record.sourceCollection || !record.sourceId) return "";
  const source = await getRecord(record.sourceCollection, record.sourceId).catch(() => null);
  if (!source) return "source_missing";
  const sourceUpdatedAt = latestTimestamp(source.statusUpdatedAt, source.updatedAt, source.generatedAt, source.createdAt);
  if (timestampValue(sourceUpdatedAt) > timestampValue(record.sourceUpdatedAt)) return "source_newer_than_projection";
  return "";
}

export async function validateProjectionFreshness({ sampleLimit = PROJECTION_VALIDATION_SAMPLE_LIMIT } = {}) {
  const startedAt = Date.now();
  const summary = {
    checkedCollections: VALIDATED_PROJECTION_COLLECTIONS.length,
    checked: 0,
    stale: 0,
    rebuildQueued: 0,
    durationMs: 0,
  };

  for (const collection of VALIDATED_PROJECTION_COLLECTIONS) {
    const page = await queryRecords(collection, {
      orderBy: "projectionUpdatedAt",
      direction: "asc",
      limit: sampleLimit,
      maxLimit: Math.min(Math.max(sampleLimit, 1), 10),
    }).catch(() => ({ data: [] }));
    for (const row of page.data || []) {
      summary.checked += 1;
      const reason = await projectionDriftReason(row);
      if (!reason) continue;
      summary.stale += 1;
      await markProjectionStale(collection, row, reason);
      rebuildProjectionFromSource(collection, row, reason).catch(() => {});
      summary.rebuildQueued += 1;
    }
  }

  summary.durationMs = Date.now() - startedAt;
  recordMonitoringSignal("PROJECTION-FRESHNESS", {
    collection: "all",
    resultCount: summary.checked,
    durationMs: summary.durationMs,
    staleProjectionCount: summary.stale,
  });
  logInfo("Projection freshness validation completed", {
    tag: "PROJECTION-FRESHNESS",
    ...summary,
  });
  return summary;
}
