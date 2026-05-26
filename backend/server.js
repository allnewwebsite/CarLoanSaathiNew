import cors from "cors";
import "dotenv/config";
import express from "express";
import morgan from "morgan";
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
import { sanitizeRequest } from "./middleware/sanitize.js";
import { corsOptions, globalRateLimit, requireHttps, securityHeaders } from "./middleware/securityMiddleware.js";

validateEnv();

const app = express();
const port = process.env.PORT || 8080;

app.use(requireHttps);
app.use(securityHeaders);
app.use(cors(corsOptions()));
app.use(globalRateLimit);
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static("uploads"));
app.use(sanitizeRequest);
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

app.get("/health", (_req, res) => res.json({ status: "ok", service: "CarLoanSaathi API" }));
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
app.use(errorHandler);

app.listen(port, () => {
  console.log(`CarLoanSaathi API running on port ${port}`);
});

if (process.env.DISABLE_SLA_ENGINE !== "true") {
  const intervalMs = Number(process.env.SLA_ENGINE_INTERVAL_MS || 60_000);
  setInterval(() => {
    processSlaBreaches().catch((error) => console.error("SLA engine failed", error));
  }, intervalMs).unref();
}

if (process.env.DISABLE_WHATSAPP_QUEUE !== "true") {
  const intervalMs = Number(process.env.WHATSAPP_QUEUE_INTERVAL_MS || 30_000);
  setInterval(() => {
    processWhatsAppQueue().catch((error) => console.error("WhatsApp queue failed", error));
  }, intervalMs).unref();
}
