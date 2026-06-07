import crypto from "crypto";
import { GOVERNANCE_LIMITS } from "../config/governance.js";
import { logWarn } from "../services/logger.service.js";
import { observeApiRequest } from "../services/observability.service.js";
import { flushFirestoreReadReport, runRequestScope } from "../services/requestScope.service.js";

export function requestContext(req, res, next) {
  const requestId = req.headers["x-request-id"] || crypto.randomUUID();
  res.locals.requestId = requestId;
  res.locals.startedAt = Date.now();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (!res.locals.responseBytes) {
      try {
        res.locals.responseBytes = Buffer.byteLength(JSON.stringify(body));
      } catch {
        res.locals.responseBytes = null;
      }
    }
    return originalJson(body);
  };
  runRequestScope(req, () => {
    res.on("finish", () => {
      const durationMs = Date.now() - res.locals.startedAt;
      const responseBytes = Number(res.getHeader("content-length") || 0) || res.locals.responseBytes || null;
      flushFirestoreReadReport({ statusCode: res.statusCode, durationMs, responseBytes });
      observeApiRequest(req, res, durationMs).catch(() => {});
      if (durationMs >= 500) {
        const tier = durationMs >= 2000 ? "2000ms" : durationMs >= 1000 ? "1000ms" : "500ms";
        logWarn("API performance threshold exceeded", {
          requestId,
          tier,
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs,
          responseBytes,
          userId: req.user?.uid || null,
          role: req.user?.role || null,
        });
      }
      if (durationMs >= GOVERNANCE_LIMITS.api.slowRequestMs) {
        logWarn("Slow API request", {
          requestId,
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs,
          responseBytes,
        });
      }
    });
    next();
  });
}
