import * as Sentry from "@sentry/node";
import { cleanLogMeta, logInfo } from "./logger.service.js";

let initialized = false;

export function initBackendMonitoring() {
  if (!process.env.SENTRY_DSN || initialized) return false;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    release: process.env.RENDER_GIT_COMMIT || process.env.npm_package_version,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE || 0),
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      return event;
    },
  });
  initialized = true;
  logInfo("Backend Sentry monitoring initialized");
  return true;
}

export function captureBackendError(error, meta = {}) {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    const clean = cleanLogMeta(meta);
    for (const [key, value] of Object.entries(clean)) scope.setExtra(key, value);
    if (meta.requestId) scope.setTag("requestId", meta.requestId);
    if (meta.severity) scope.setTag("severity", meta.severity);
    if (meta.component) scope.setTag("component", meta.component);
    Sentry.captureException(error);
  });
}

export function captureSecurityIncident(message, meta = {}) {
  if (!initialized) return;
  Sentry.captureMessage(message, {
    level: "warning",
    tags: { incident: "security", requestId: meta.requestId || "unknown", severity: meta.severity || "medium" },
    extra: cleanLogMeta(meta),
  });
}

export function captureOperationalIncident(message, meta = {}) {
  if (!initialized) return;
  Sentry.captureMessage(message, {
    level: meta.level || "warning",
    tags: {
      incident: meta.incidentType || "operational",
      severity: meta.severity || "medium",
      component: meta.component || "platform",
      requestId: meta.requestId || "system",
    },
    extra: cleanLogMeta(meta),
  });
}

export function setMonitoringUser(user = {}) {
  if (!initialized) return;
  Sentry.setUser({
    id: user.uid || user.id,
    email: user.email,
    role: user.role,
  });
}

export function monitoringRequestHandler(req, _res, next) {
  if (initialized) {
    Sentry.withScope((scope) => {
      scope.setTag("requestId", req.requestId || "unknown");
      scope.setTag("route", req.path);
      scope.setContext("request", {
        method: req.method,
        path: req.originalUrl,
        requestId: req.requestId,
      });
    });
  }
  next();
}

export { Sentry };
