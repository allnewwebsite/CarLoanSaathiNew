import "dotenv/config";
import { archiveClosedLeads, cleanupExpiredNotifications } from "../services/archival.service.js";
import { queueHealth } from "../services/queue.service.js";
import { validateMetricsIntegrity } from "../services/metricsBackfill.service.js";
import { reconcileSubscriptionPayments } from "../services/paymentReconciliation.service.js";

const mode = process.env.MAINTENANCE_MODE || "all";
const output = {};

if (["all", "archive"].includes(mode)) output.archive = await archiveClosedLeads();
if (["all", "notifications"].includes(mode)) output.notifications = await cleanupExpiredNotifications();
if (["all", "metrics"].includes(mode)) output.metrics = await validateMetricsIntegrity();
if (["all", "queues"].includes(mode)) output.queues = await queueHealth();
if (["all", "billing"].includes(mode)) output.billing = await reconcileSubscriptionPayments();

console.log(JSON.stringify({ mode, output }, null, 2));
