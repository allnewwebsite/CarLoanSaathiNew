import { deleteRecordsByIds, queryRecords, runRecordTransaction } from "./firestore.service.js";
import { logInfo, logWarn } from "./logger.service.js";
import { publishRealtimeEvent, REALTIME_EVENTS } from "./realtime.service.js";
import { safeDocId } from "./projectionShared.service.js";
import { clearCachedTags } from "./ttlCache.service.js";

const DEFAULT_TIME_ZONE = "Asia/Kolkata";
const CLEANUP_BATCH_SIZE = 500;
const CLEANUP_LEASE_MS = 10 * 60 * 1000;

function zonedParts(date, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
}

function offsetAt(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const representedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return representedAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function notificationDayBoundary(now = new Date(), timeZone = process.env.NOTIFICATION_TIME_ZONE || DEFAULT_TIME_ZONE) {
  const parts = zonedParts(now, timeZone);
  const dayKey = `${parts.year}-${parts.month}-${parts.day}`;
  const wallClockMidnight = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  let cutoffMs = wallClockMidnight - offsetAt(new Date(wallClockMidnight), timeZone);
  cutoffMs = wallClockMidnight - offsetAt(new Date(cutoffMs), timeZone);
  return { dayKey, cutoff: new Date(cutoffMs).toISOString(), timeZone };
}

function projectionIds(notification = {}) {
  const role = String(notification.recipientRole || notification.role || "").trim();
  const sourceId = notification.id;
  const targets = [];
  if (!role || role === "super-admin") targets.push(["adminViews", safeDocId(`notification_${sourceId}`)]);
  const dealershipId = notification.dealershipId || notification.dealerEmail || notification.meta?.dealershipId || notification.meta?.dealershipEmail;
  if (dealershipId && (!role || role === "finance-desk")) targets.push(["financeViews", safeDocId(`notification_${sourceId}`)]);
  if (dealershipId && (!role || role === "gm")) targets.push(["gmViews", safeDocId(`notification_${sourceId}`)]);
  const bankId = notification.bankId || notification.partnerId || notification.meta?.bankId || notification.meta?.assignedBankId || notification.meta?.assignedPartnerId;
  if (bankId && (!role || role === "bank-manager")) targets.push(["bankViews", safeDocId(`notification_${sourceId}`)]);
  const executiveId = notification.assignedExecutiveId || notification.recipientId || notification.meta?.assignedExecutiveId || notification.meta?.assignedExecutiveEmail;
  if (role === "loan-executive" && executiveId) targets.push(["executiveViews", safeDocId(`notification_${sourceId}_${executiveId}`)]);
  return targets;
}

async function claimDailyCleanup({ dayKey, now }) {
  const id = `notification-cleanup-${dayKey}`;
  return runRecordTransaction(async (transaction) => {
    const existing = await transaction.get("systemJobRuns", id);
    const activeLease = existing?.status === "RUNNING" && Date.parse(existing.leaseUntil || "") > now.getTime();
    if (existing?.status === "COMPLETED" || activeLease) return { claimed: false, id, existing };
    const startedAt = now.toISOString();
    await transaction.set("systemJobRuns", id, {
      id,
      job: "notification-daily-cleanup",
      dayKey,
      status: "RUNNING",
      startedAt,
      leaseUntil: new Date(now.getTime() + CLEANUP_LEASE_MS).toISOString(),
      attempts: Number(existing?.attempts || 0) + 1,
    }, { merge: true });
    return { claimed: true, id, startedAt };
  });
}

export async function cleanupExpiredNotifications({ limit = CLEANUP_BATCH_SIZE, now = new Date() } = {}) {
  const serverNow = now instanceof Date ? now : new Date(now);
  const { dayKey, cutoff, timeZone } = notificationDayBoundary(serverNow);
  const claim = await claimDailyCleanup({ dayKey, now: serverNow });
  if (!claim.claimed) return { cleaned: 0, skipped: true, dayKey, cutoff, timeZone };

  const safeLimit = Math.min(Math.max(Number(limit) || CLEANUP_BATCH_SIZE, 1), CLEANUP_BATCH_SIZE);
  let cleaned = 0;
  try {
    for (let pass = 0; pass < 100; pass += 1) {
      const page = await queryRecords("notifications", {
        where: [{ field: "createdAt", op: "<", value: cutoff }],
        orderBy: "createdAt",
        direction: "asc",
        limit: safeLimit,
        maxLimit: safeLimit,
      });
      if (!page.data.length) break;

      const projectionTargets = new Map();
      page.data.flatMap(projectionIds).forEach(([collection, id]) => {
        if (!projectionTargets.has(collection)) projectionTargets.set(collection, []);
        projectionTargets.get(collection).push(id);
      });
      await Promise.all([
        ...[...projectionTargets.entries()].map(([collection, ids]) => deleteRecordsByIds(collection, ids)),
        deleteRecordsByIds("notifications", page.data.map((item) => item.id)),
      ]);
      cleaned += page.data.length;
      if (page.data.length < safeLimit) break;
    }

    const completedAt = new Date().toISOString();
    await runRecordTransaction(async (transaction) => transaction.set("systemJobRuns", claim.id, {
      status: "COMPLETED",
      completedAt,
      leaseUntil: completedAt,
      cleaned,
      cutoff,
      timeZone,
    }, { merge: true }));
    clearCachedTags(["notifications", "dashboard:fast"]);
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.NOTIFICATIONS_CLEANED,
      data: { broadcastAllAuthenticated: true, cleaned, cutoff, dayKey, timeZone },
    });
    logInfo("Daily notification cleanup completed", { cleaned, cutoff, dayKey, timeZone });
    return { cleaned, skipped: false, dayKey, cutoff, timeZone };
  } catch (error) {
    await runRecordTransaction(async (transaction) => transaction.set("systemJobRuns", claim.id, {
      status: "FAILED",
      failedAt: new Date().toISOString(),
      leaseUntil: new Date().toISOString(),
      error: String(error.message || error).slice(0, 500),
    }, { merge: true })).catch(() => {});
    logWarn("Daily notification cleanup failed", { error: error.message, cutoff, dayKey, timeZone });
    throw error;
  }
}
