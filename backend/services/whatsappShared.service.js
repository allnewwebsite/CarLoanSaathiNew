import { upsertRecord } from "./firestore.service.js";
import { logWarn } from "./logger.service.js";
import { getWorkflowSettings } from "./settings.service.js";

export const DEFAULT_PROVIDER = process.env.WHATSAPP_PROVIDER || "twilio";
export const DAY_MS = 24 * 60 * 60 * 1000;

export const whatsappRuntime = {
  queued: 0,
  sentToday: 0,
  failedToday: 0,
  pending: 0,
  lastSuccessAt: null,
  lastFailedAt: null,
  lastError: null,
  lastMessageSid: null,
  twilioConnectionStatus: "not-checked",
  events: [],
};

export let missingCredentialWarningLogged = false;
export function markMissingCredentialWarningLogged() {
  missingCredentialWarningLogged = true;
}

export const processingWhatsAppKeys = new Set();

export function nowIso() {
  return new Date().toISOString();
}

export function normalizePhone(phoneNumber) {
  const raw = String(phoneNumber || "").trim();
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (hasPlus) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return `+${digits}`;
}

export function normalizeTwilioAddress(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("whatsapp:")) return trimmed;
  return `whatsapp:${normalizePhone(trimmed)}`;
}

export function recipientKey(phone = "") {
  const digits = normalizePhone(phone).replace(/\D/g, "");
  if (!digits) return "";
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function canonicalEventType(eventType = "") {
  const key = String(eventType || "").trim().toUpperCase().replace(/-/g, "_");
  const aliases = {
    LEAD_ASSIGNED: "LEAD_ASSIGNED",
    NEW_LEAD_ASSIGNED: "LEAD_ASSIGNED",
    EXECUTIVE_ASSIGNED: "LEAD_ASSIGNED",
    EXECUTIVE_REASSIGNED: "LEAD_REASSIGNED",
    LEAD_REASSIGNED: "LEAD_REASSIGNED",
    DOCUMENTS_REQUIRED: "DOCUMENTS_REQUIRED",
    PENDING_DOCUMENTS: "DOCUMENTS_REQUIRED",
    DOCUMENT_REQUESTED: "DOCUMENTS_REQUIRED",
    REQUEST_DOCUMENT: "DOCUMENTS_REQUIRED",
    STATUS_UPDATE: "STATUS_UPDATED",
    STATUS_UPDATED: "STATUS_UPDATED",
    CASE_APPROVED: "CASE_APPROVED",
    APPROVAL: "CASE_APPROVED",
    APPROVED: "CASE_APPROVED",
    CASE_REJECTED: "CASE_REJECTED",
    REJECTION: "CASE_REJECTED",
    REJECTED: "CASE_REJECTED",
    DOCUMENTS_UPLOADED: "DOCUMENTS_UPLOADED",
  };
  return aliases[key] || key || "WHATSAPP_MESSAGE";
}

export function notificationIdentity({ leadId, caseId: rawCaseId, eventType, phoneNumber, metadata = {} } = {}) {
  const resolvedLeadId = leadId || metadata.leadId || null;
  const resolvedCaseId = rawCaseId || metadata.caseId || resolvedLeadId || "UNKNOWN_LEAD";
  const recipient = recipientKey(phoneNumber);
  const canonicalType = canonicalEventType(eventType);
  const eventVersion = String(
    metadata.eventVersion
      || metadata.notificationEventId
      || metadata.eventId
      || "",
  ).trim();
  const notificationKey = [resolvedCaseId, canonicalType, recipient || "NO_PHONE", eventVersion]
    .filter(Boolean)
    .join("_")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_");
  return {
    notificationKey,
    canonicalType,
    leadId: resolvedLeadId,
    caseId: resolvedCaseId,
    recipient,
  };
}

export function isTerminalNotificationStatus(status = "") {
  return ["sent", "delivered", "queued", "processing", "provider-accepted", "missing-phone"].includes(String(status || "").toLowerCase());
}

export async function logWhatsAppNotification({
  notificationKey,
  type,
  eventType,
  recipientRole,
  recipientId,
  recipient,
  phone,
  message,
  leadId,
  caseId,
  status,
  retryCount = 0,
  provider,
  queueId,
  messageSid = null,
  deliveryResult = null,
  error = null,
  metadata = {},
}) {
  const timestamp = nowIso();
  return upsertRecord("notificationLogs", notificationKey, {
    id: notificationKey,
    notificationKey,
    type,
    eventType,
    recipientRole,
    recipientId,
    recipient: recipientId || recipient || null,
    phoneNumber: phone,
    phone,
    message,
    leadId,
    caseId,
    status,
    retryCount,
    provider,
    queueId,
    messageSid,
    deliveryResult,
    error,
    metadata,
    timestamp,
  });
}

export function enabledByEnv() {
  return String(process.env.WHATSAPP_ENABLED || "").toLowerCase() === "true";
}

export async function enabledBySettings() {
  try {
    const settings = await getWorkflowSettings();
    return settings.notificationSettings?.whatsappEnabled !== false;
  } catch (error) {
    logWarn("WhatsApp settings lookup failed; disabling this send attempt", { error: error.message });
    return false;
  }
}

export function twilioConfig() {
  return {
    accountSid: String(process.env.TWILIO_ACCOUNT_SID || "").trim(),
    authToken: String(process.env.TWILIO_AUTH_TOKEN || "").trim(),
    from: normalizeTwilioAddress(process.env.TWILIO_WHATSAPP_FROM),
  };
}

export function twilioConfigured() {
  const config = twilioConfig();
  return Boolean(config.accountSid && config.authToken && config.from);
}

export function safeErrorDetail(value) {
  const text = String(value || "");
  if (!text) return null;
  return text.replace(/AC[a-z0-9]+/gi, "[redacted-account]").slice(0, 500);
}

export function pushRuntimeEvent(event) {
  whatsappRuntime.events.unshift({ ...event, timestamp: nowIso() });
  whatsappRuntime.events = whatsappRuntime.events.slice(0, 50);
}

export function recordSuccess({ messageSid, eventType }) {
  whatsappRuntime.sentToday += 1;
  whatsappRuntime.lastSuccessAt = nowIso();
  whatsappRuntime.lastMessageSid = messageSid || whatsappRuntime.lastMessageSid;
  whatsappRuntime.twilioConnectionStatus = "ok";
  pushRuntimeEvent({ status: "delivered", eventType, messageSid });
}

export function recordFailure({ error, eventType, status = "failed" }) {
  whatsappRuntime.failedToday += 1;
  whatsappRuntime.lastFailedAt = nowIso();
  whatsappRuntime.lastError = safeErrorDetail(error);
  if (status === "provider-not-configured") whatsappRuntime.twilioConnectionStatus = "not-configured";
  else whatsappRuntime.twilioConnectionStatus = "failed";
  pushRuntimeEvent({ status, eventType, error: whatsappRuntime.lastError });
}

export function customerName(lead = {}) {
  return lead.fullName || lead.customerName || lead.customer || "Customer";
}

export function caseId(lead = {}) {
  return lead.caseId || lead.leadId || lead.id || "-";
}

export function assignedExecutivePhone(lead = {}) {
  return lead.assignedExecutiveMobile
    || lead.executiveMobile
    || lead.assignedExecutivePhone
    || lead.loanExecutiveMobile
    || "";
}

export function financeManagerPhone(lead = {}) {
  return lead.financeManagerMobile
    || lead.assignedFinanceManagerMobile
    || lead.financeDeskMobile
    || lead.dealerMobile
    || "";
}
