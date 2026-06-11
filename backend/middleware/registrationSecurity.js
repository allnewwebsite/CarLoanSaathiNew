import { firebaseAdmin } from "../firebase/admin.js";
import { ALERT_SEVERITY, emitOperationalAlert, recordOperationalEvent } from "../services/observability.service.js";
import { logSecurity } from "../services/logger.service.js";

const HONEYPOT_FIELDS = ["website", "companyWebsite", "_gotcha", "hp", "middleNameConfirm"];

function hasHoneypotPayload(body = {}) {
  return HONEYPOT_FIELDS.some((field) => String(body[field] || "").trim());
}

async function verifyAppCheck(req) {
  const enforceAppCheck = process.env.ENFORCE_APP_CHECK === "true"
    || (process.env.NODE_ENV === "production" && process.env.ENFORCE_APP_CHECK !== "false");
  if (!enforceAppCheck) return true;
  const token = String(req.headers["x-firebase-appcheck"] || "").trim();
  if (!token) return false;
  if (!firebaseAdmin?.appCheck) return false;
  await firebaseAdmin.appCheck().verifyToken(token);
  return true;
}

function recordRegistrationAbuse(req, reason) {
  const meta = {
    requestId: req.requestId,
    endpoint: req.originalUrl,
    ip: req.ip,
    userAgent: req.headers["user-agent"] || "",
    reason,
  };
  logSecurity("Registration abuse blocked", meta);
  recordOperationalEvent({
    type: "registration_abuse_blocked",
    severity: ALERT_SEVERITY.MEDIUM,
    component: "registration",
    message: "Suspicious registration request blocked",
    requestId: req.requestId,
    meta,
  }).catch(() => {});
  emitOperationalAlert({
    type: "registration_abuse_blocked",
    severity: ALERT_SEVERITY.MEDIUM,
    component: "registration",
    title: "Suspicious registration request blocked",
    message: `${req.method} ${req.originalUrl} blocked`,
    entityId: req.ip,
    requestId: req.requestId,
    meta,
  }).catch(() => {});
}

export async function registrationSecurity(req, res, next) {
  try {
    if (hasHoneypotPayload(req.body)) {
      recordRegistrationAbuse(req, "honeypot_field_present");
      return res.status(400).json({ message: "Registration request rejected." });
    }

    const appCheckOk = await verifyAppCheck(req);
    if (!appCheckOk) {
      recordRegistrationAbuse(req, "invalid_app_check");
      return res.status(403).json({ message: "Registration verification failed." });
    }

    return next();
  } catch (error) {
    recordRegistrationAbuse(req, "app_check_verification_failed");
    return res.status(403).json({ message: "Registration verification failed." });
  }
}
