import { authenticate } from "./auth.js";
import { ALERT_SEVERITY, emitOperationalAlert, recordOperationalEvent } from "../services/observability.service.js";
import { logSecurity } from "../services/logger.service.js";

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function monitoringSecret(req) {
  return String(req.headers["x-monitoring-secret"] || bearerToken(req) || "").trim();
}

function hasValidMonitoringSecret(req) {
  const configured = String(process.env.MONITORING_SECRET || "").trim();
  return configured && monitoringSecret(req) === configured;
}

function recordDeniedMonitoringAccess(req, reason) {
  const meta = {
    requestId: req.requestId,
    endpoint: req.originalUrl,
    ip: req.ip,
    userAgent: req.headers["user-agent"] || "",
    reason,
  };
  logSecurity("Monitoring endpoint access denied", meta);
  recordOperationalEvent({
    type: "monitoring_access_denied",
    severity: ALERT_SEVERITY.MEDIUM,
    component: "observability",
    message: "Protected monitoring endpoint access denied",
    requestId: req.requestId,
    meta,
  }).catch(() => {});
  emitOperationalAlert({
    type: "monitoring_access_denied",
    severity: ALERT_SEVERITY.MEDIUM,
    component: "observability",
    title: "Monitoring endpoint access denied",
    message: `${req.method} ${req.originalUrl} denied`,
    entityId: req.ip,
    requestId: req.requestId,
    meta,
  }).catch(() => {});
}

export function requireMonitoringAccess(req, res, next) {
  if (hasValidMonitoringSecret(req)) {
    recordOperationalEvent({
      type: "monitoring_access",
      severity: ALERT_SEVERITY.LOW,
      component: "observability",
      message: "Monitoring endpoint accessed with monitoring secret",
      requestId: req.requestId,
      meta: { endpoint: req.originalUrl, ip: req.ip },
    }).catch(() => {});
    return next();
  }

  return authenticate(req, res, (error) => {
    if (error) return next(error);
    if (req.user?.role === "super-admin") return next();
    recordDeniedMonitoringAccess(req, "super_admin_or_monitoring_secret_required");
    return res.status(403).json({ message: "Monitoring access denied" });
  });
}
