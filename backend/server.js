import cors from "cors";
import "dotenv/config";
import express from "express";
import { validateEnv } from "./config/env.js";
import authRoutes from "./routes/auth.routes.js";
import leadRoutes from "./routes/lead.routes.js";
import documentRoutes from "./routes/document.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import catalogRoutes from "./routes/catalog.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import dealerRoutes from "./routes/dealer.routes.js";
import gmRoutes from "./routes/gm.routes.js";
import bankRoutes from "./routes/bank.routes.js";
import timelineRoutes from "./routes/timeline.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { processSlaBreaches } from "./services/assignment.service.js";
import { processWhatsAppQueue } from "./services/whatsapp.service.js";
import { processNotificationEvents } from "./services/notificationWorker.service.js";
import { sanitizeRequest } from "./middleware/sanitize.js";
import { corsOptions, globalRateLimit, requireHttps, securityHeaders } from "./middleware/securityMiddleware.js";
import { requestContext } from "./middleware/requestContext.js";
import { attachApiResponse } from "./utils/apiResponse.js";
import { auditMiddleware } from "./middleware/auditMiddleware.js";
import { logError, logInfo } from "./services/logger.service.js";
import { initBackendMonitoring } from "./services/monitoring.service.js";
import { logQueueDisabled, queueHealth } from "./services/queue.service.js";
import { registerQueueWorkers } from "./services/queueWorkers.service.js";
import { registerScheduledOperations } from "./services/scheduler.service.js";
import { markWorkerHealth, observabilitySnapshot, productionHealth } from "./services/health.service.js";
import { monitoringRequestHandler } from "./services/monitoring.service.js";

validateEnv();

const app = express();
const port = process.env.PORT || 8080;

initBackendMonitoring();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(requestContext);
app.use(monitoringRequestHandler);
app.use(attachApiResponse);
app.use(requireHttps);
app.use(securityHeaders);
app.use(cors(corsOptions()));
app.options("*", cors(corsOptions()));
app.use(globalRateLimit);
app.use(express.json({ limit: "2mb" }));
if (process.env.NODE_ENV !== "production") {
  app.use("/uploads", express.static("uploads"));
}
app.use(sanitizeRequest);
app.use(auditMiddleware);

app.get("/health", async (_req, res, next) => {
  try {
    const health = await productionHealth({ deep: false });
    res.set("Cache-Control", "no-store").json(health);
  } catch (error) {
    next(error);
  }
});
app.get("/health/deep", async (_req, res, next) => {
  try {
    const health = await productionHealth({ deep: true });
    res.set("Cache-Control", "no-store").status(health.status === "down" ? 503 : 200).json(health);
  } catch (error) {
    next(error);
  }
});
app.get("/health/queues", async (_req, res, next) => {
  try {
    res.set("Cache-Control", "no-store").json(await queueHealth());
  } catch (error) {
    next(error);
  }
});
app.get("/health/observability", async (_req, res, next) => {
  try {
    res.set("Cache-Control", "no-store").json(await observabilitySnapshot());
  } catch (error) {
    next(error);
  }
});
app.use("/api", catalogRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/dealer", dealerRoutes);
app.use("/api/gm", gmRoutes);
app.use("/api/bank", bankRoutes);
app.use("/api/timeline", timelineRoutes);
app.use("/api/notifications", notificationRoutes);
app.use((_req, res) => res.status(404).json({
  success: false,
  errorCode: "ROUTE_NOT_FOUND",
  message: "API route not found",
  requestId: res.locals.requestId || null,
}));
app.use(errorHandler);

const server = app.listen(port, () => {
  logInfo("CarLoanSaathi API started", { port });
  logQueueDisabled();
  registerQueueWorkers();
  registerScheduledOperations();
});

function shutdown(signal) {
  logInfo("Shutdown requested", { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

if (process.env.DISABLE_SLA_ENGINE !== "true") {
  const intervalMs = Number(process.env.SLA_ENGINE_INTERVAL_MS || 60_000);
  setInterval(() => {
    markWorkerHealth("slaWorkerLastRunAt");
    processSlaBreaches().catch((error) => logError("SLA engine failed", { error: error.message }));
  }, intervalMs).unref();
}

if (process.env.DISABLE_WHATSAPP_QUEUE !== "true") {
  const intervalMs = Number(process.env.WHATSAPP_QUEUE_INTERVAL_MS || 30_000);
  setInterval(() => {
    markWorkerHealth("whatsappWorkerLastRunAt");
    processWhatsAppQueue().catch((error) => logError("WhatsApp queue failed", { error: error.message }));
  }, intervalMs).unref();
}

if (process.env.DISABLE_NOTIFICATION_WORKER !== "true") {
  const intervalMs = Number(process.env.NOTIFICATION_WORKER_INTERVAL_MS || 15_000);
  setInterval(() => {
    markWorkerHealth("notificationWorkerLastRunAt");
    processNotificationEvents().catch((error) => logError("Notification worker failed", { error: error.message }));
  }, intervalMs).unref();
}
