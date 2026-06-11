import { QUEUE_NAMES, registerWorker } from "./queue.service.js";
import { createNotification } from "./notification.service.js";
import { processNotificationEvents } from "./notificationWorker.service.js";
import { processWhatsAppQueue } from "./whatsapp.service.js";
import { archiveClosedLeads, cleanupExpiredNotifications } from "./archival.service.js";
import { applyLeadCreatedMetrics, applyLeadAssignedMetrics, applyStatusChangedMetrics } from "./analyticsEngine.service.js";
import { markWorkerHealth } from "./health.service.js";

export function registerQueueWorkers() {
  registerWorker(QUEUE_NAMES.NOTIFICATIONS, async (payload) => {
    if (payload?.jobKind === "notification-events-sweep") {
      if (process.env.ENABLE_NOTIFICATION_EVENT_SWEEP !== "true") return 0;
      return processNotificationEvents(payload);
    }
    return createNotification(payload);
  }, { concurrency: 1 });
  registerWorker(QUEUE_NAMES.WHATSAPP, async (payload) => processWhatsAppQueue({ queueId: payload?.queueId }), { concurrency: 2 });
  registerWorker(QUEUE_NAMES.ARCHIVAL, async (payload) => archiveClosedLeads(payload), { concurrency: 1 });
  registerWorker(QUEUE_NAMES.CLEANUP, async () => cleanupExpiredNotifications(), { concurrency: 1 });
  registerWorker(QUEUE_NAMES.METRICS, async (payload) => {
    if (payload.type === "lead-created") return applyLeadCreatedMetrics(payload.lead);
    if (payload.type === "status-changed") return applyStatusChangedMetrics(payload);
    if (payload.type === "lead-assigned") return applyLeadAssignedMetrics(payload.lead);
    return null;
  }, { concurrency: 5 });
  markWorkerHealth("queueWorkersRegisteredAt");
}
