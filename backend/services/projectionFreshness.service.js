import { getRecord, queryRecords, upsertRecord } from "./firestore.service.js";
import { logInfo, logWarn } from "./logger.service.js";
import { recordMonitoringSignal } from "./monitoringCenter.service.js";
import {
  freshnessProblem,
  isoNow,
  latestTimestamp,
  LEAD_VIEW_COLLECTIONS,
  NOTIFICATION_VIEW_COLLECTIONS,
  PROJECTION_VALIDATION_SAMPLE_LIMIT,
  scopeId,
  timestampValue,
} from "./projectionShared.service.js";

const rebuilding = new Set();

const VALIDATED_PROJECTION_COLLECTIONS = [
  "adminViews",
  "financeViews",
  "gmViews",
  "bankViews",
  "executiveViews",
  "leadDetailsProjection",
  "staffViewProjection",
  "memberViewProjection",
  "salespersonSummaryProjection",
  "timelineProjection",
  "bankDealershipViews",
];

async function projectionRebuilders() {
  const projection = await import("./projection.service.js");
  return {
    syncLeadProjection: projection.syncLeadProjection,
    syncNotificationProjection: projection.syncNotificationProjection,
    syncTimelineProjection: projection.syncTimelineProjection,
    syncStaffViewProjection: projection.syncStaffViewProjection,
    syncMemberViewProjection: projection.syncMemberViewProjection,
    syncExecutiveSummaryProjection: projection.syncExecutiveSummaryProjection,
    syncSalespersonSummaryProjection: projection.syncSalespersonSummaryProjection,
  };
}

export async function markProjectionStale(collection, record = {}, reason = "stale") {
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
    const { syncLeadProjection } = await projectionRebuilders();
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
    const { syncNotificationProjection } = await projectionRebuilders();
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

export async function rebuildProjectionFromSource(collection, record = {}, reason = "stale") {
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
    const { syncTimelineProjection } = await projectionRebuilders();
    await syncTimelineProjection(event);
    recordMonitoringSignal("PROJECTION-REBUILD", { collection, projectionId: record.id, sourceId, sourceCollection: "leadTimeline", reason, durationMs: Date.now() - startedAt });
    return true;
  }
  if (["staffViewProjection", "memberViewProjection", "executiveSummaryProjection", "salespersonSummaryProjection"].includes(collection)) {
    const startedAt = Date.now();
    const sourceCollection = record.sourceCollection;
    const sourceId = scopeId(record.sourceId || record.id);
    if (!sourceCollection || !sourceId) return false;
    const source = await getRecord(sourceCollection, sourceId).catch(() => null);
    if (!source) return false;
    const {
      syncExecutiveSummaryProjection,
      syncMemberViewProjection,
      syncSalespersonSummaryProjection,
      syncStaffViewProjection,
    } = await projectionRebuilders();
    if (collection === "staffViewProjection") await syncStaffViewProjection({ ...source, sourceCollection });
    if (collection === "memberViewProjection") await syncMemberViewProjection({ ...source, sourceCollection });
    if (collection === "executiveSummaryProjection") await syncExecutiveSummaryProjection(source);
    if (collection === "salespersonSummaryProjection") await syncSalespersonSummaryProjection(source);
    recordMonitoringSignal("PROJECTION-REBUILD", { collection, projectionId: record.id, sourceId, sourceCollection, reason, durationMs: Date.now() - startedAt });
    return true;
  }
  recordMonitoringSignal("PROJECTION-REBUILD-SKIPPED", { collection, projectionId: record.id, sourceId: record.sourceId || record.leadId || null, sourceCollection: record.sourceCollection || null, reason: `${reason}:source_rebuild_not_available` });
  return false;
}

export async function ensureFreshProjection(collection, record = {}) {
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

export async function freshProjectionRows(collection, rows = []) {
  if (!rows.length) return rows;
  const checks = await Promise.all(rows.map((row) => ensureFreshProjection(collection, row)));
  return rows.filter((_, index) => checks[index]);
}

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
