import { queryRecords, updateRecord } from "./firestore.service.js";
import { GOVERNANCE_LIMITS } from "../config/governance.js";
import { logWarn } from "./logger.service.js";

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
