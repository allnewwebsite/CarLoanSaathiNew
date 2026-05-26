import { logError } from "../services/logger.service.js";

export function errorHandler(error, _req, res, _next) {
  logError("API error", {
    requestId: res.getHeader("X-Request-Id"),
    status: error.status || 500,
    message: error.message,
    stack: process.env.NODE_ENV === "production" ? undefined : error.stack,
  });
  if (error?.issues) {
    return res.status(400).json({
      success: false,
      errorCode: "VALIDATION_ERROR",
      message: "Validation failed",
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
      errors: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
      requestId: res.locals.requestId || null,
    });
  }
  if (error?.message === "Not allowed by CORS") {
    return res.status(403).json({
      success: false,
      errorCode: "CORS_ORIGIN_DENIED",
      message: "Origin is not allowed",
      requestId: res.locals.requestId || null,
    });
  }
  const status = error.status || 500;
  const publicMessage = process.env.NODE_ENV === "production" && status >= 500
    ? "Unexpected server error"
    : error.message || "Unexpected server error";
  res.status(status).json({
    success: false,
    errorCode: error.code || (status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : "API_ERROR"),
    message: publicMessage,
    details: null,
    requestId: res.locals.requestId || null,
  });
}
