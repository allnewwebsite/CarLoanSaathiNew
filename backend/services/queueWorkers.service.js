import { QUEUE_NAMES, registerWorker } from "./queue.service.js";
import { createNotification } from "./notification.service.js";
import { processNotificationEvents } from "./notificationWorker.service.js";
import { processWhatsAppQueue } from "./whatsapp.service.js";
import { archiveClosedLeads, cleanupExpiredNotifications } from "./archival.service.js";
import { processSlaBreaches } from "./assignment.service.js";
import { applyLeadCreatedMetrics, applyLeadAssignedMetrics, applyStatusChangedMetrics, applySlaBreachMetrics } from "./analyticsEngine.service.js";
import { markWorkerHealth } from "./health.service.js";

export function registerQueueWorkers() {
  registerWorker(QUEUE_NAMES.NOTIFICATIONS, async (payload) => {
    if (payload?.jobKind === "notification-events-sweep") return processNotificationEvents(payload);
    return createNotification(payload);
  }, { concurrency: 1 });
  registerWorker(QUEUE_NAMES.WHATSAPP, async () => processWhatsAppQueue(), { concurrency: 2 });
  registerWorker(QUEUE_NAMES.SLA, async () => processSlaBreaches(), { concurrency: 1 });
  registerWorker(QUEUE_NAMES.ARCHIVAL, async (payload) => archiveClosedLeads(payload), { concurrency: 1 });
  registerWorker(QUEUE_NAMES.CLEANUP, async () => cleanupExpiredNotifications(), { concurrency: 1 });
  registerWorker(QUEUE_NAMES.METRICS, async (payload) => {
    if (payload.type === "lead-created") return applyLeadCreatedMetrics(payload.lead);
    if (payload.type === "status-changed") return applyStatusChangedMetrics(payload);
    if (payload.type === "lead-assigned") return applyLeadAssignedMetrics(payload.lead);
    if (payload.type === "sla-breached") return applySlaBreachMetrics(payload.lead);
    return null;
  }, { concurrency: 5 });
  markWorkerHealth("queueWorkersRegisteredAt");
}
