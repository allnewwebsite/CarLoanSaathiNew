import { createRecord, deleteRecord, queryRecords, updateRecord } from "./firestore.service.js";
import { LEAD_STATUSES } from "../utils/status.constants.js";
import { GOVERNANCE_LIMITS } from "../config/governance.js";
import { logInfo, logWarn } from "./logger.service.js";

function olderThanDate(days) {
  return new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();
}

export async function archiveClosedLeads({
  retentionDays = Number(process.env.LEAD_ARCHIVE_AFTER_DAYS || 180),
  limit = Number(process.env.ARCHIVAL_BATCH_SIZE || 50),
  deleteSource = process.env.ARCHIVE_DELETE_SOURCE === "true",
} = {}) {
  const cutoff = olderThanDate(retentionDays);
  const statuses = [LEAD_STATUSES.REJECTED, LEAD_STATUSES.DISBURSED, LEAD_STATUSES.CLOSED];
  let archived = 0;
  for (const status of statuses) {
    const result = await queryRecords("leads", {
      where: [{ field: "status", value: status }, { field: "updatedAt", op: "<=", value: cutoff }],
      orderBy: "updatedAt",
      direction: "asc",
      limit,
      maxLimit: 100,
      allowGlobal: true,
    });
    for (const lead of result.data) {
      await createRecord("archivedLeads", {
        ...lead,
        sourceCollection: "leads",
        sourceId: lead.id,
        archivedAt: new Date().toISOString(),
        archiveReason: `closed-over-${retentionDays}-days`,
      });
      if (deleteSource) await deleteRecord("leads", lead.id);
      else await updateRecord("leads", lead.id, { archiveReady: true, archiveCopiedAt: new Date().toISOString() });
      archived += 1;
    }
  }
  await createRecord("archivalLogs", {
    type: "lead-archival",
    archived,
    retentionDays,
    deleteSource,
    createdAt: new Date().toISOString(),
  });
  logInfo("Archival run completed", { archived, retentionDays, deleteSource });
  return { archived, retentionDays, deleteSource };
}

export async function cleanupExpiredNotifications({ limit = 100 } = {}) {
  const now = new Date().toISOString();
  const result = await queryRecords("notifications", {
    where: [{ field: "expiresAt", op: "<=", value: now }],
    orderBy: "expiresAt",
    direction: "asc",
    limit,
    maxLimit: 500,
  });
  let cleaned = 0;
  for (const item of result.data) {
    await updateRecord("notifications", item.id, {
      cleanupReady: true,
      cleanupMarkedAt: now,
    });
    cleaned += 1;
  }
  if (cleaned) logWarn("Expired notifications marked for cleanup", { cleaned, ttlDays: GOVERNANCE_LIMITS.notifications.ttlDays });
  return { cleaned };
}
