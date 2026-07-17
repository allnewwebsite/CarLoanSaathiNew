import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { allowedOrigins } from "../config/env.js";
import { writeAuditLog } from "../services/audit.service.js";

function numberEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function loadTestRateLimitBypass(req) {
  if (!req.headers["x-load-test-run"]) return false;
  return process.env.NODE_ENV !== "production"
    || process.env.ALLOW_LOAD_TEST_RATE_LIMIT_BYPASS === "true";
}

function passwordResetLimitHandler(message, reason) {
  return (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    void writeAuditLog({
      req,
      actorId: email || "anonymous",
      actorRole: "unknown",
      actionType: "PASSWORD_RESET_ATTEMPT",
      targetEntity: "auth",
      targetId: email || null,
      sourcePortal: String(req.body?.portal || "").trim().toLowerCase() || "unknown",
      meta: { success: false, reason },
    }).catch(() => null);
    return res.status(429).json({ message, code: "PASSWORD_RESET_RATE_LIMITED" });
  };
}

function passwordChangeLimitHandler(req, res) {
  void writeAuditLog({
    req,
    actionType: "PASSWORD_CHANGE",
    targetEntity: "auth",
    targetId: req.user?.email || req.user?.uid || null,
    sourcePortal: req.user?.portal || req.user?.scope || "unknown",
    meta: { success: false, reason: "RATE_LIMIT" },
  }).catch(() => null);
  return res.status(429).json({
    message: "Too many incorrect attempts. Please try again later.",
    code: "PASSWORD_CHANGE_RATE_LIMITED",
  });
}

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "base-uri": ["'self'"],
      "frame-ancestors": ["'none'"],
      "object-src": ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
});

export function corsOptions() {
  return {
    origin(origin, callback) {
      if (process.env.NODE_ENV !== "production") return callback(null, true);
      const normalizedOrigin = origin ? origin.replace(/\/+$/, "") : origin;
      if (!normalizedOrigin || allowedOrigins().includes(normalizedOrigin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-Firebase-AppCheck", "X-Monitoring-Secret", "X-CLS-Warmup", "X-CLS-Portal", "X-Load-Test-Run"],
  };
}

export const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: numberEnv("RATE_LIMIT_MAX", 300),
  standardHeaders: true,
  legacyHeaders: false,
  skip: loadTestRateLimitBypass,
});

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: numberEnv("AUTH_RATE_LIMIT_MAX", 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many authentication attempts. Try again later." },
});

export const authLookupRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: numberEnv("AUTH_LOOKUP_RATE_LIMIT_MAX", 60),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many account checks. Try again later." },
});

export const loginFailureRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: numberEnv("LOGIN_FAILURE_RATE_LIMIT_MAX", 60),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login failure records. Try again later." },
});

export const passwordResetRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: numberEnv("PASSWORD_RESET_RATE_LIMIT_MAX", 5),
  standardHeaders: true,
  legacyHeaders: false,
  handler: passwordResetLimitHandler("Too many password reset attempts from this network. Try again later.", "IP_RATE_LIMIT"),
});

export const passwordResetEmailRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: numberEnv("PASSWORD_RESET_RATE_LIMIT_MAX", 5),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.body?.email || "").trim().toLowerCase() || "missing-email",
  handler: passwordResetLimitHandler("Too many password reset attempts for this email. Try again later.", "EMAIL_RATE_LIMIT"),
});

const passwordChangeLimitOptions = {
  windowMs: 15 * 60 * 1000,
  limit: numberEnv("PASSWORD_CHANGE_RATE_LIMIT_MAX", 5),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: passwordChangeLimitHandler,
};

export const passwordChangeIpRateLimit = rateLimit(passwordChangeLimitOptions);

export const passwordChangeAccountRateLimit = rateLimit({
  ...passwordChangeLimitOptions,
  keyGenerator: (req) => String(req.user?.email || req.user?.uid || "missing-account").trim().toLowerCase(),
});

export const registrationRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: numberEnv("REGISTRATION_RATE_LIMIT_MAX", 15),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many registration attempts. Try again later." },
});

export const publicLeadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: numberEnv("PUBLIC_LEAD_RATE_LIMIT_MAX", 8),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many loan applications from this network. Try again later." },
});

export const publicCatalogRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: numberEnv("PUBLIC_CATALOG_RATE_LIMIT_MAX", 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many catalog requests. Try again later." },
  skip: loadTestRateLimitBypass,
});

export const monitoringRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: numberEnv("MONITORING_RATE_LIMIT_MAX", 60),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many monitoring requests. Try again later." },
});

export const uploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: numberEnv("UPLOAD_RATE_LIMIT_MAX", 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many upload attempts. Try again later." },
});

export const billingRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: numberEnv("BILLING_RATE_LIMIT_MAX", 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many billing attempts. Try again later." },
});

export function requireHttps(req, res, next) {
  if (process.env.NODE_ENV !== "production") return next();
  const proto = req.headers["x-forwarded-proto"];
  if (req.secure || proto === "https") return next();
  return res.status(403).json({ message: "HTTPS is required" });
}
