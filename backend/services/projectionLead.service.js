import { deleteRecord, queryRecords, upsertRecord } from "./firestore.service.js";
import { pageResponse, paginationParams } from "../utils/pagination.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";
import { logInfo, logWarn } from "./logger.service.js";
import { recordMonitoringSignal } from "./monitoringCenter.service.js";
import { clearCachedValue, getCachedValue, setCachedValue } from "./ttlCache.service.js";
import { freshProjectionRows } from "./projectionFreshness.service.js";
import { syncLeadDetailProjection } from "./projectionLeadDetail.service.js";
import { leadDetailProjectionPayload } from "./projectionLeadDetail.service.js";
import { removeBankDealershipLeadProjection, syncBankDealershipProjection } from "./projectionBankDealership.service.js";
import {
  cacheDigest,
  latestTimestamp,
  LEAD_QUERY_CACHE_TTL_MS,
  pick,
  PROJECTION_META_FIELDS,
  PROJECTION_VERSION,
  projectionWhereSignature,
  safeDocId,
  scopeId,
  VIEW_LEAD_FIELDS,
  VIEW_SEARCH_FIELDS,
  withProjectionMetadata,
} from "./projectionShared.service.js";
import { executiveIdentityValues } from "./roleIdentity.service.js";
import { currentWorkflowLocation } from "./automationPolicy.service.js";

export { PROJECTION_VERSION } from "./projectionShared.service.js";
const projectionMissBackfills = new Set();

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
    workflowLocation: currentWorkflowLocation(lead),
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
  [lead.assignedExecutiveId, lead.assignedExecutiveEmail, lead.assignedExecutiveMobile, lead.executiveMobile]
    .map(scopeId)
    .filter(Boolean)
    .forEach((executiveScope) => {
    targets.push({ collection: "executiveViews", scopeType: "executive", scopeId: executiveScope, docId: safeDocId(`lead_${lead.id}_${executiveScope}`) });
  });
  return targets;
}

export function leadOwnershipProjectionPlan(lead = {}) {
  if (!lead?.id) return { writes: [], executiveDocIds: [] };
  const targets = leadTargets(lead);
  const detailPayload = leadDetailProjectionPayload(lead);
  return {
    writes: [
      ...targets.map((target) => ({
        collection: target.collection,
        docId: target.docId,
        payload: projectionPayload(lead, target),
      })),
      ...(detailPayload ? [{
        collection: "leadDetailsProjection",
        docId: safeDocId(lead.id),
        payload: detailPayload,
      }] : []),
    ],
    executiveDocIds: targets
      .filter((target) => target.collection === "executiveViews")
      .map((target) => target.docId),
  };
}

function rawLeadWhereForProjectionMiss({ role, where = [], query = {} } = {}) {
  const rawWhere = [];
  const scope = where.find((clause) => clause.field === "scopeId")?.value;

  if (role === "finance-desk" || role === "gm") {
    if (scope) rawWhere.push({ field: "dealershipId", value: scope });
  } else if (role === "bank-manager") {
    if (scope) rawWhere.push({ field: "bankId", value: scope });
  } else if (role === "loan-executive") {
    if (scope) rawWhere.push({ field: "assignedExecutiveId", value: scope });
    if (query.assignedExecutiveEmail) rawWhere.push({ field: "assignedExecutiveEmail", value: scopeId(query.assignedExecutiveEmail) });
    if (query.assignedExecutiveMobile) rawWhere.push({ field: "assignedExecutiveMobile", value: scopeId(query.assignedExecutiveMobile) });
  }

  for (const clause of where) {
    if (["viewType", "scopeId"].includes(clause.field)) continue;
    if (["status", "dealershipId", "salespersonId", "financeManagerId", "assignedExecutiveId"].includes(clause.field)) {
      rawWhere.push({ field: clause.field, op: clause.op, value: clause.value });
    }
  }
  return rawWhere;
}

async function backfillLeadProjectionsFromMiss({ collection, role, where, limit, query, requestId }) {
  const rawWhere = rawLeadWhereForProjectionMiss({ role, where, query });
  const allowGlobal = role === "super-admin" && rawWhere.length === 0;
  if (!allowGlobal && !rawWhere.length) return;
  const key = `${collection}:${role}:${projectionWhereSignature(where)}`;
  if (projectionMissBackfills.has(key)) return;
  projectionMissBackfills.add(key);
  try {
    recordMonitoringSignal("PROJECTION-REBUILD", {
      requestId,
      collection,
      role,
      reason: "projection_miss_backfill_started",
      queryScope: rawWhere.map((clause) => ({ field: clause.field, op: clause.op || "==" })),
    });
    const page = await queryRecords("leads", {
      where: rawWhere,
      orderBy: "createdAt",
      direction: "desc",
      limit: Math.min(Math.max(Number(limit || 20), 20), 50),
      maxLimit: 50,
      search: query.search,
      searchFields: VIEW_SEARCH_FIELDS,
      allowGlobal,
    }).catch(() => ({ data: [] }));
    const rows = Array.isArray(page.data) ? page.data.filter((lead) => lead?.id) : [];
    await Promise.all(rows.map((lead) => syncLeadProjection(lead).catch(() => null)));
    recordMonitoringSignal("PROJECTION-REBUILD", {
      requestId,
      collection,
      role,
      resultCount: rows.length,
      reason: "projection_miss_backfill_completed",
    });
  } catch (error) {
    recordMonitoringSignal("PROJECTION-REBUILD-SKIPPED", {
      requestId,
      collection,
      role,
      reason: error.code || error.message || "projection_miss_backfill_failed",
    });
    logWarn("Projection miss backfill failed", {
      requestId,
      collection,
      role,
      error: error.code || error.message,
    });
  } finally {
    projectionMissBackfills.delete(key);
  }
}

async function projectionScopeHasRows({ collection, where, requestId, role }) {
  const page = await queryRecords(collection, {
    where,
    orderBy: "createdAt",
    direction: "desc",
    limit: 1,
    maxLimit: 1,
    fields: ["sourceId", "viewType", "scopeId", "createdAt"],
  }).catch((error) => {
    logWarn("Projection scope presence check failed", {
      requestId,
      collection,
      role,
      error: error.code || error.message,
    });
    return null;
  });
  return Array.isArray(page?.data) && page.data.length > 0;
}

export async function syncLeadProjection(lead = {}) {
  if (!lead?.id) return null;
  clearCachedValue("lead-query:");
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

export async function removeLeadProjections(lead = {}) {
  if (!lead?.id) return { removed: 0, leadId: lead?.id || null };
  clearCachedValue("lead-query:");
  const targets = leadTargets(lead);
  const detailTargets = [
    { collection: "leadDetailsProjection", docId: safeDocId(lead.id) },
  ];
  const allTargets = [...targets, ...detailTargets];
  await Promise.all([
    ...allTargets.map((target) => deleteRecord(target.collection, target.docId).catch(() => false)),
    removeBankDealershipLeadProjection(lead.id),
  ]);
  return { removed: allTargets.length + 1, leadId: lead.id };
}

export function syncLeadProjectionSoon(lead = {}) {
  Promise.resolve().then(() => syncLeadProjection(lead)).catch(() => {});
}

export async function removeLeadExecutiveProjection({ leadId, executiveId }) {
  const cleanLeadId = scopeId(leadId);
  const cleanExecutiveId = scopeId(executiveId);
  if (!cleanLeadId || !cleanExecutiveId) return false;
  clearCachedValue("lead-query:");
  return deleteRecord("executiveViews", safeDocId(`lead_${cleanLeadId}_${cleanExecutiveId}`)).catch(() => false);
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
  } else if (role === "gm") {
    collection = "gmViews";
    where.push({ field: "scopeId", value: scopeId(user.dealershipId || user.email || user.uid) });
  } else if (role === "bank-manager") {
    collection = "bankViews";
    where.push({ field: "scopeId", value: scopeId(user.bankId || user.bankName || user.email || user.uid) });
  } else if (role === "loan-executive") {
    collection = "executiveViews";
    const executiveScopes = [...new Set(executiveIdentityValues(user).map(scopeId).filter(Boolean))].slice(0, 10);
    if (executiveScopes.length > 1) where.push({ field: "scopeId", op: "in", value: executiveScopes });
    else where.push({ field: "scopeId", value: executiveScopes[0] || scopeId(user.email || user.uid || user.mobile) });
  } else if (role !== "super-admin") {
    return null;
  }

  const scopeWhere = [...where];
  const statuses = statusValuesForProjectionQuery(query.status);
  const archiveTerminal = ["1", "true"].includes(String(query.archiveTerminal || query.terminalArchive || "").toLowerCase());
  if (statuses.length === 1) where.push({ field: "status", value: statuses[0] });
  if (statuses.length > 1 && statuses.length <= 10) where.push({ field: "status", op: "in", value: statuses });
  if (!statuses.length) {
    where.push(archiveTerminal
      ? { field: "workflowLocation", op: "in", value: ["rejected", "disbursed"] }
      : { field: "workflowLocation", value: "active" });
  }
  if (query.dealershipId) where.push({ field: "dealershipId", value: scopeId(query.dealershipId) });
  if (query.salespersonId) where.push({ field: "salespersonId", value: scopeId(query.salespersonId) });
  if (query.financeManagerId) where.push({ field: "financeManagerId", value: scopeId(query.financeManagerId) });
  if (query.assignedExecutiveId) where.push({ field: "assignedExecutiveId", value: scopeId(query.assignedExecutiveId) });
  const projectionFields = [...new Set(["sourceId", "viewType", "scopeId", "leadId", ...PROJECTION_META_FIELDS, ...fields])];
  const cacheKey = `lead-query:projection:${collection}:${cacheDigest({
    role,
    where,
    orderBy: "createdAt",
    direction: "desc",
    limit,
    cursor,
    page,
    search: query.search || "",
    searchFields: ["searchText", ...VIEW_SEARCH_FIELDS],
    fields: projectionFields,
  })}`;
  try {
    const cachedResponse = getCachedValue(cacheKey);
    if (cachedResponse !== null) {
      recordMonitoringSignal("PROJECTION-CACHE-HIT", {
        requestId,
        collection,
        role,
        cacheKey: "projection:lead-query",
        resultCount: Array.isArray(cachedResponse.data) ? cachedResponse.data.length : 0,
      });
      return cachedResponse;
    }
    recordMonitoringSignal("PROJECTION-CACHE-MISS", {
      requestId,
      collection,
      role,
      cacheKey: "projection:lead-query",
    });
    const response = await (async () => {
      const result = await queryRecords(collection, {
        where,
        orderBy: "createdAt",
        direction: "desc",
        limit,
        cursor,
        page,
        search: query.search,
        searchFields: ["searchText", ...VIEW_SEARCH_FIELDS],
        fields: projectionFields,
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
        const narrowedProjectionQuery = Boolean(
          query.search
          || statuses.length
          || query.dealershipId
          || query.salespersonId
          || query.financeManagerId
          || query.assignedExecutiveId
        );
        if (narrowedProjectionQuery && await projectionScopeHasRows({ collection, where: scopeWhere, requestId, role })) {
          const emptyResponse = pageResponse({ data: [], limit, nextCursor: null });
          if (recordMetrics) recordProjectionMetric("PROJECTION-HIT", {
            requestId,
            collection,
            role,
            resultCount: 0,
            durationMs: Date.now() - projectionStartedAt,
            reason: "empty_filtered_projection_result",
          });
          return emptyResponse;
        }
        if (recordMetrics) recordProjectionMetric("PROJECTION-MISS", { requestId, collection, role, resultCount, durationMs, reason: "empty_projection_result" });
        backfillLeadProjectionsFromMiss({ collection, role, where, limit, query, requestId }).catch(() => {});
        return null;
      }
      const freshRows = await freshProjectionRows(collection, result.data);
      if (!freshRows.length) {
        if (recordMetrics) recordProjectionMetric("PROJECTION-MISS", { requestId, collection, role, resultCount, durationMs: Date.now() - projectionStartedAt, reason: "stale_projection_rows" });
        return null;
      }
      const mapStartedAt = Date.now();
      const data = freshRows
        .filter((item) => item.isDeadCase !== true)
        .filter((item) => {
          const status = normalizeStatus(item.status);
          if (![LEAD_STATUSES.REJECTED, LEAD_STATUSES.DISBURSED].includes(status)) return true;
          const location = currentWorkflowLocation(item);
          return archiveTerminal ? location !== "active" : location === "active";
        })
        .map((item) => ({ ...item, id: item.sourceId || item.id, currentLocation: currentWorkflowLocation(item) }));
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
    })();
    return response === null ? null : setCachedValue(cacheKey, response, LEAD_QUERY_CACHE_TTL_MS);
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
  if (value === "Pending Documents") return [LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING];
  if (value === "Document Received") return [LEAD_STATUSES.DOCUMENT_RECEIVED, LEAD_STATUSES.ALL_DOCUMENTS_RECEIVED];
  if (value === "Under Bank Process") return [LEAD_STATUSES.UNDER_BANK_PROCESS, LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW, LEAD_STATUSES.APPROVED];
  if (value === "Disbursed") return [LEAD_STATUSES.DISBURSED, LEAD_STATUSES.CLOSED];
  if (value === "Rejected With Reason") return [LEAD_STATUSES.REJECTED];
  return [normalized];
}

