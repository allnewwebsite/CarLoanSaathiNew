import { countRecords, getRecord, queryRecords, upsertRecord } from "./firestore.service.js";
import { decorateMetric } from "./analyticsEngine.service.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";
import { logInfo } from "./logger.service.js";

const zero = {
  totalLeads: 0,
  pendingLeads: 0,
  disbursedLeads: 0,
  rejectedLeads: 0,
  pendingDocuments: 0,
  bankProcess: 0,
  assignedLeads: 0,
  completedLeads: 0,
  processingTimeTotalMinutes: 0,
  activeDealerships: 0,
  bankPartners: 0,
  activeBanks: 0,
};

function dayKey(value = new Date().toISOString()) {
  return String(value).slice(0, 10);
}

function monthKey(value = new Date().toISOString()) {
  return String(value).slice(0, 7);
}

function statusField(status) {
  const normalized = normalizeStatus(status);
  if (normalized === LEAD_STATUSES.DISBURSED || normalized === LEAD_STATUSES.CLOSED) return "disbursedLeads";
  if (normalized === LEAD_STATUSES.REJECTED) return "rejectedLeads";
  if ([LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING].includes(normalized)) return "pendingDocuments";
  if ([LEAD_STATUSES.CONTACTED, LEAD_STATUSES.ALL_DOCUMENTS_RECEIVED, LEAD_STATUSES.UNDER_BANK_PROCESS, LEAD_STATUSES.ASSIGNED, LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW, LEAD_STATUSES.APPROVED].includes(normalized)) return "bankProcess";
  return "pendingLeads";
}

function bump(map, collection, id, base, lead) {
  const key = `${collection}/${id}`;
  const current = map.get(key) || { ...zero, ...base };
  const field = statusField(lead.status);
  current.totalLeads += 1;
  current[field] += 1;
  if (lead.assignedExecutiveId) current.assignedLeads += 1;
  if ([LEAD_STATUSES.DISBURSED, LEAD_STATUSES.REJECTED, LEAD_STATUSES.CLOSED].includes(normalizeStatus(lead.status))) {
    current.completedLeads += 1;
    if (lead.createdAt && (lead.updatedAt || lead.statusUpdatedAt)) {
      current.processingTimeTotalMinutes += Math.max(Math.round((new Date(lead.updatedAt || lead.statusUpdatedAt) - new Date(lead.createdAt)) / 60000), 0);
    }
  }
  map.set(key, current);
}

export async function rebuildHistoricalMetrics({ limit = 250, dryRun = true, runId = `backfill-${Date.now()}` } = {}) {
  let cursor = null;
  let processed = 0;
  const map = new Map();
  do {
    const page = await queryRecords("leads", {
      orderBy: "createdAt",
      direction: "asc",
      limit,
      cursor,
      maxLimit: 500,
      allowGlobal: true,
    });
    for (const lead of page.data) {
      const createdAt = lead.createdAt || new Date().toISOString();
      bump(map, "dailyMetrics", `global:${dayKey(createdAt)}`, { id: `global:${dayKey(createdAt)}`, scopeType: "global", scopeId: "global", period: dayKey(createdAt) }, lead);
      bump(map, "monthlyMetrics", `global:${monthKey(createdAt)}`, { id: `global:${monthKey(createdAt)}`, scopeType: "global", scopeId: "global", period: monthKey(createdAt) }, lead);
      if (lead.isDeadCase === true) {
        processed += 1;
        continue;
      }
      bump(map, "metrics", "global", { id: "global", scopeType: "global", scopeId: "global", period: null }, lead);
      if (lead.dealershipId) bump(map, "dealershipMetrics", lead.dealershipId, { id: lead.dealershipId, scopeType: "dealership", scopeId: lead.dealershipId, period: null }, lead);
      if (lead.bankId) bump(map, "bankMetrics", lead.bankId, { id: lead.bankId, scopeType: "bank", scopeId: lead.bankId, period: null }, lead);
      if (lead.assignedExecutiveId) bump(map, "executiveMetrics", lead.assignedExecutiveId, { id: lead.assignedExecutiveId, scopeType: "executive", scopeId: lead.assignedExecutiveId, period: null }, lead);
      processed += 1;
    }
    cursor = page.nextCursor;
    await upsertRecord("operationalMetrics", `metrics-backfill:${runId}`, {
      type: "metrics-backfill",
      runId,
      processed,
      dryRun,
      status: cursor ? "running" : "completed",
      updatedAt: new Date().toISOString(),
    });
  } while (cursor);

  const platformCounters = {
    activeDealerships: await countRecords("dealerships", { where: [{ field: "active", value: true }] }).catch(() => 0),
    bankPartners: await countRecords("bankPartners", { where: [{ field: "active", value: true }] }).catch(() => 0),
    activeBanks: await countRecords("banks", { where: [{ field: "active", value: true }] }).catch(() => 0),
  };
  const globalKey = "metrics/global";
  map.set(globalKey, {
    ...(map.get(globalKey) || { ...zero, id: "global", scopeType: "global", scopeId: "global", period: null }),
    ...platformCounters,
  });

  if (!dryRun) {
    for (const [key, value] of map.entries()) {
      const [collection, id] = key.split("/");
      await upsertRecord(collection, id, {
        ...decorateMetric(value),
        rebuiltAt: new Date().toISOString(),
        rebuildRunId: runId,
      });
    }
  }

  const summary = { runId, processed, metricDocuments: map.size, platformCounters, dryRun };
  logInfo("Historical metrics backfill completed", summary);
  return summary;
}

export async function validateMetricsIntegrity() {
  const global = await getRecord("metrics", "global");
  return {
    hasGlobalMetrics: Boolean(global),
    totalLeads: Number(global?.totalLeads || 0),
    checkedAt: new Date().toISOString(),
  };
}
