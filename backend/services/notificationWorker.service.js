import { createRecord, queryRecords, updateRecord } from "./firestore.service.js";
import { createNotification } from "./notification.service.js";
import { GOVERNANCE_LIMITS } from "../config/governance.js";
import { logError, logInfo } from "./logger.service.js";

function backoffDelayMs(retryCount) {
  return GOVERNANCE_LIMITS.notifications.retryBaseDelayMs * Math.max(1, 2 ** retryCount);
}

export async function enqueueNotificationEvent({ type, recipient, priority = "medium", payload = {}, requestId = null }) {
  return createRecord("notificationEvents", {
    eventId: `notification-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    recipient,
    priority,
    payload,
    status: "queued",
    retryCount: 0,
    requestId,
    nextAttemptAt: new Date().toISOString(),
  });
}

export async function processNotificationEvents({ limit = 25 } = {}) {
  const result = await queryRecords("notificationEvents", {
    where: [{ field: "status", value: "queued" }],
    orderBy: "status",
    direction: "asc",
    limit,
    maxLimit: Math.min(Math.max(Number(limit) || 25, 1), 25),
    fields: ["id", "eventId", "type", "recipient", "priority", "payload", "status", "retryCount", "requestId", "nextAttemptAt", "createdAt"],
  });
  let processed = 0;
  const events = (result.data || [])
    .sort((left, right) => String(left.nextAttemptAt || left.createdAt || "").localeCompare(String(right.nextAttemptAt || right.createdAt || "")));
  for (const event of events) {
    const retryCount = Number(event.retryCount || 0);
    const nextAttemptAt = event.nextAttemptAt ? new Date(event.nextAttemptAt).getTime() : 0;
    if (nextAttemptAt > Date.now()) continue;
    try {
      await createNotification({
        type: event.type,
        priority: event.priority,
        recipientId: event.recipient?.id,
        recipientRole: event.recipient?.role,
        userId: event.recipient?.userId,
        ...event.payload,
        requestId: event.requestId,
        source: "worker",
      });
      await updateRecord("notificationEvents", event.id, {
        status: "processed",
        processedAt: new Date().toISOString(),
      });
      processed += 1;
    } catch (error) {
      const nextRetry = retryCount + 1;
      const dead = nextRetry >= GOVERNANCE_LIMITS.notifications.maxRetryCount;
      await updateRecord("notificationEvents", event.id, {
        status: dead ? "dead-lettered" : "queued",
        retryCount: nextRetry,
        lastError: error.message,
        nextAttemptAt: new Date(Date.now() + backoffDelayMs(nextRetry)).toISOString(),
      });
      logError("Notification event processing failed", { eventId: event.eventId, dead, error: error.message });
    }
  }
  if (processed) logInfo("Notification events processed", { processed });
  return processed;
}
