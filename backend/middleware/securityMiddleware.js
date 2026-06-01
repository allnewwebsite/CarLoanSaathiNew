import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { allowedOrigins } from "../config/env.js";

function numberEnv(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
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
    allowedHeaders: ["Authorization", "Content-Type", "X-Firebase-AppCheck", "X-Monitoring-Secret", "X-CLS-Warmup"],
  };
}

export const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: numberEnv("RATE_LIMIT_MAX", 300),
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: numberEnv("AUTH_RATE_LIMIT_MAX", 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many authentication attempts. Try again later." },
});

export const passwordResetRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: numberEnv("PASSWORD_RESET_RATE_LIMIT_MAX", 5),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many password reset attempts. Try again later." },
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

export function requireHttps(req, res, next) {
  if (process.env.NODE_ENV !== "production") return next();
  const proto = req.headers["x-forwarded-proto"];
  if (req.secure || proto === "https") return next();
  return res.status(403).json({ message: "HTTPS is required" });
}
