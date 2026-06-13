import { createRecord, queryRecords, updateRecord } from "./firestore.service.js";
import { LEAD_STATUSES } from "../utils/status.constants.js";
import { GOVERNANCE_LIMITS } from "../config/governance.js";
import { logInfo, logWarn } from "./logger.service.js";
import { archiveRuleForLead, shouldArchiveLead } from "../utils/archive.js";
import { applyLeadArchivedMetrics } from "./analyticsEngine.service.js";
import { removeLeadProjections } from "./projection.service.js";
import { publishRealtimeEvent, REALTIME_EVENTS } from "./realtime.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "./audit.service.js";
import { clearCachedValue } from "./ttlCache.service.js";

function olderThanDate(days) {
  return new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();
}

export async function archiveClosedLeads({
  limit = Number(process.env.ARCHIVAL_BATCH_SIZE || 50),
} = {}) {
  const now = new Date();
  const rules = [
    { status: LEAD_STATUSES.REJECTED, cutoff: olderThanDate(90) },
    { status: LEAD_STATUSES.DISBURSED, cutoff: olderThanDate(180) },
  ];
  let archived = 0;
  const archivedIds = [];
  for (const rule of rules) {
    const candidatePages = await Promise.all(["statusUpdatedAt", "updatedAt"].map((dateField) => queryRecords("leads", {
      where: [{ field: "status", value: rule.status }, { field: dateField, op: "<=", value: rule.cutoff }],
      orderBy: dateField,
      direction: "asc",
      limit,
      maxLimit: 100,
      allowGlobal: true,
    })));
    const candidates = new Map(candidatePages.flatMap((page) => page.data).map((lead) => [lead.id, lead]));
    for (const lead of [...candidates.values()].slice(0, limit)) {
      if (!shouldArchiveLead(lead, now)) continue;
      const archiveRule = archiveRuleForLead(lead);
      const archivedAt = now.toISOString();
      const updated = await updateRecord("leads", lead.id, {
        isArchived: true,
        archivedAt,
        archiveReason: archiveRule.reason,
        archivedBy: "system",
      });
      await Promise.all([
        removeLeadProjections(updated),
        applyLeadArchivedMetrics(updated),
        writeAuditLog({
          actorId: "system",
          actorRole: "system",
          actionType: AUDIT_ACTIONS.LEAD_ARCHIVED,
          targetEntity: "lead",
          targetId: lead.id,
          leadId: lead.id,
          oldValue: { isArchived: false },
          newValue: {
            isArchived: true,
            archivedAt,
            archiveReason: archiveRule.reason,
          },
          meta: {
            caseId: lead.caseId,
            dealershipId: lead.dealershipId,
            bankId: lead.bankId,
          },
        }),
      ]);
      publishRealtimeEvent({
        eventType: REALTIME_EVENTS.LEAD_ARCHIVED,
        lead: updated,
        data: {
          status: updated.status,
          archivedAt,
          archiveReason: archiveRule.reason,
        },
      });
      archivedIds.push(lead.id);
      archived += 1;
    }
  }
  await createRecord("archivalLogs", {
    type: "lead-archival",
    archived,
    archivedIds,
    policy: {
      rejectedDays: 90,
      disbursedDays: 180,
    },
    createdAt: new Date().toISOString(),
  });
  if (archived) {
    ["admin:", "dealer:", "finance:", "gm:", "bank:", "lead-query:"].forEach(clearCachedValue);
  }
  logInfo("Archival run completed", { archived, archivedIds });
  return { archived, archivedIds };
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
