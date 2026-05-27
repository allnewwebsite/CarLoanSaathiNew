import crypto from "crypto";
import { GOVERNANCE_LIMITS } from "../config/governance.js";
import { logWarn } from "../services/logger.service.js";
import { observeApiRequest } from "../services/observability.service.js";

export function requestContext(req, res, next) {
  const requestId = req.headers["x-request-id"] || crypto.randomUUID();
  res.locals.requestId = requestId;
  res.locals.startedAt = Date.now();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  res.on("finish", () => {
    const durationMs = Date.now() - res.locals.startedAt;
    observeApiRequest(req, res, durationMs).catch(() => {});
    if (durationMs >= GOVERNANCE_LIMITS.api.slowRequestMs) {
      logWarn("Slow API request", {
        requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs,
      });
    }
  });
  next();
}
