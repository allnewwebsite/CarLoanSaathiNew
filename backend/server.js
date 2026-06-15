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
import realtimeRoutes from "./routes/realtime.routes.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { processWhatsAppQueue, validateWhatsAppEnvironment } from "./services/whatsapp.service.js";
import { processNotificationEvents } from "./services/notificationWorker.service.js";
import { sanitizeRequest } from "./middleware/sanitize.js";
import { corsOptions, globalRateLimit, monitoringRateLimit, requireHttps, securityHeaders } from "./middleware/securityMiddleware.js";
import { requireMonitoringAccess } from "./middleware/monitoringAuth.js";
import { requestContext } from "./middleware/requestContext.js";
import { attachApiResponse } from "./utils/apiResponse.js";
import { auditMiddleware } from "./middleware/auditMiddleware.js";
import { gzipCompression } from "./middleware/compressionMiddleware.js";
import { logError, logInfo } from "./services/logger.service.js";
import { initBackendMonitoring } from "./services/monitoring.service.js";
import { addQueueJob, logQueueDisabled, queueEnabled, queueHealth, QUEUE_NAMES } from "./services/queue.service.js";
import { registerQueueWorkers } from "./services/queueWorkers.service.js";
import { registerScheduledOperations } from "./services/scheduler.service.js";
import { markWorkerHealth, observabilitySnapshot, productionHealth } from "./services/health.service.js";
import { monitoringRequestHandler } from "./services/monitoring.service.js";
import { handleRazorpayWebhook } from "./controllers/razorpayWebhook.controller.js";

validateEnv();

const app = express();
const port = process.env.PORT || 8080;

initBackendMonitoring();
validateWhatsAppEnvironment();
app.disable("x-powered-by");
app.set("trust proxy", 1);
const portalWarmupPaths = [/^\/api\/(bank|gm|dealer|admin)(\/|$)/i];
let firstPortalRequestLogged = false;

app.use(requestContext);
app.use(monitoringRequestHandler);
app.use(attachApiResponse);
app.use((req, _res, next) => {
  const warmupHeader = String(req.headers["x-cls-warmup"] || "").toLowerCase() === "true";
  if (portalWarmupPaths.some((pattern) => pattern.test(req.path))) {
    if (!firstPortalRequestLogged) {
      firstPortalRequestLogged = true;
      logInfo("First portal request received", {
        requestId: req.requestId,
        path: req.originalUrl,
        method: req.method,
        warmup: warmupHeader,
      });
    }
    if (warmupHeader) {
      logInfo("Portal warmup request", {
        requestId: req.requestId,
        path: req.originalUrl,
        method: req.method,
      });
    }
  }
  next();
});
app.use(requireHttps);
app.use(securityHeaders);
app.use(cors(corsOptions()));
app.options("*", cors(corsOptions()));
app.use(globalRateLimit);
app.use(gzipCompression());
app.post(
  "/api/webhooks/razorpay",
  express.raw({ type: "application/json", limit: "256kb" }),
  handleRazorpayWebhook,
);
app.use(express.json({ limit: "2mb" }));
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({
      success: false,
      code: "MALFORMED_JSON",
      message: "Request body must be valid JSON.",
      requestId: req.requestId,
    });
  }
  return next(error);
});
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
app.get("/api/health", async (_req, res, next) => {
  try {
    const health = await productionHealth({ deep: false });
    res.set("Cache-Control", "no-store").json(health);
  } catch (error) {
    next(error);
  }
});
app.get("/api/warmup", async (req, res, next) => {
  try {
    const route = String(req.query.route || "").trim();
    const warmupHeader = String(req.headers["x-cls-warmup"] || "").toLowerCase() === "true";
    const health = await productionHealth({ deep: false });
    if (warmupHeader || route) {
      logInfo("Backend warmup endpoint hit", {
        requestId: req.requestId,
        path: req.originalUrl,
        route: route || null,
        warmup: warmupHeader,
      });
    }
    res.set("Cache-Control", "no-store").json({ status: health.status, route: route || null, health });
  } catch (error) {
    next(error);
  }
});
app.get("/health/deep", monitoringRateLimit, requireMonitoringAccess, async (_req, res, next) => {
  try {
    const health = await productionHealth({ deep: true });
    res.set("Cache-Control", "no-store").status(health.status === "down" ? 503 : 200).json(health);
  } catch (error) {
    next(error);
  }
});
app.get("/health/queues", monitoringRateLimit, requireMonitoringAccess, async (_req, res, next) => {
  try {
    res.set("Cache-Control", "no-store").json(await queueHealth());
  } catch (error) {
    next(error);
  }
});
app.get("/health/observability", monitoringRateLimit, requireMonitoringAccess, async (_req, res, next) => {
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
app.use("/api/realtime", realtimeRoutes);
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

function runWorkerTick({ workerName, queueName, jobName, payload = {}, inlineTask, fallback, healthKey, errorMessage }) {
  markWorkerHealth(healthKey);
  if (queueEnabled()) {
    addQueueJob(queueName, jobName, payload, { priority: "low", fallback })
      .catch((error) => logError(errorMessage, { error: error.message }));
    return;
  }
  inlineTask().catch((error) => logError(errorMessage, { error: error.message }));
}

if (process.env.DISABLE_WHATSAPP_QUEUE !== "true") {
  const intervalMs = Number(process.env.WHATSAPP_QUEUE_INTERVAL_MS || 30_000);
  setInterval(() => {
    runWorkerTick({
      workerName: "whatsapp",
      queueName: QUEUE_NAMES.WHATSAPP,
      jobName: "whatsapp-queue-sweep",
      inlineTask: processWhatsAppQueue,
      fallback: processWhatsAppQueue,
      healthKey: "whatsappWorkerLastRunAt",
      errorMessage: "WhatsApp queue failed",
    });
  }, intervalMs).unref();
}

if (process.env.ENABLE_NOTIFICATION_EVENT_SWEEP === "true" && process.env.DISABLE_NOTIFICATION_WORKER !== "true") {
  const intervalMs = Number(process.env.NOTIFICATION_WORKER_INTERVAL_MS || 60_000);
  setInterval(() => {
    runWorkerTick({
      workerName: "notifications",
      queueName: QUEUE_NAMES.NOTIFICATIONS,
      jobName: "notification-events-sweep",
      payload: { jobKind: "notification-events-sweep" },
      inlineTask: processNotificationEvents,
      fallback: processNotificationEvents,
      healthKey: "notificationWorkerLastRunAt",
      errorMessage: "Notification worker failed",
    });
  }, intervalMs).unref();
}
