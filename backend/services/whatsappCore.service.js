import { getRecord, queryRecords, updateRecord, upsertRecord } from "./firestore.service.js";
import { logError, logInfo, logWarn } from "./logger.service.js";
import { addQueueJob, QUEUE_NAMES } from "./queue.service.js";
import { getWorkflowSettings } from "./settings.service.js";
import { buildWhatsAppMessage } from "./whatsappTemplates.service.js";

const DEFAULT_PROVIDER = process.env.WHATSAPP_PROVIDER || "twilio";
const DAY_MS = 24 * 60 * 60 * 1000;

const whatsappRuntime = {
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

let missingCredentialWarningLogged = false;
const processingWhatsAppKeys = new Set();

function nowIso() {
  return new Date().toISOString();
}

function normalizePhone(phoneNumber) {
  const raw = String(phoneNumber || "").trim();
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (hasPlus) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return `+${digits}`;
}

function normalizeTwilioAddress(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("whatsapp:")) return trimmed;
  return `whatsapp:${normalizePhone(trimmed)}`;
}

function recipientKey(phone = "") {
  const digits = normalizePhone(phone).replace(/\D/g, "");
  if (!digits) return "";
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function canonicalEventType(eventType = "") {
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

function notificationIdentity({ leadId, caseId: rawCaseId, eventType, phoneNumber, metadata = {} } = {}) {
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

function isTerminalNotificationStatus(status = "") {
  return ["sent", "delivered", "queued", "processing", "provider-accepted", "missing-phone"].includes(String(status || "").toLowerCase());
}

async function logWhatsAppNotification({
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

function enabledByEnv() {
  return String(process.env.WHATSAPP_ENABLED || "").toLowerCase() === "true";
}

async function enabledBySettings() {
  try {
    const settings = await getWorkflowSettings();
    return settings.notificationSettings?.whatsappEnabled !== false;
  } catch (error) {
    logWarn("WhatsApp settings lookup failed; disabling this send attempt", { error: error.message });
    return false;
  }
}

function twilioConfig() {
  return {
    accountSid: String(process.env.TWILIO_ACCOUNT_SID || "").trim(),
    authToken: String(process.env.TWILIO_AUTH_TOKEN || "").trim(),
    from: normalizeTwilioAddress(process.env.TWILIO_WHATSAPP_FROM),
  };
}

function twilioConfigured() {
  const config = twilioConfig();
  return Boolean(config.accountSid && config.authToken && config.from);
}

function safeErrorDetail(value) {
  const text = String(value || "");
  if (!text) return null;
  return text.replace(/AC[a-z0-9]+/gi, "[redacted-account]").slice(0, 500);
}

function pushRuntimeEvent(event) {
  whatsappRuntime.events.unshift({ ...event, timestamp: nowIso() });
  whatsappRuntime.events = whatsappRuntime.events.slice(0, 50);
}

function recordSuccess({ messageSid, eventType }) {
  whatsappRuntime.sentToday += 1;
  whatsappRuntime.lastSuccessAt = nowIso();
  whatsappRuntime.lastMessageSid = messageSid || whatsappRuntime.lastMessageSid;
  whatsappRuntime.twilioConnectionStatus = "ok";
  pushRuntimeEvent({ status: "delivered", eventType, messageSid });
}

function recordFailure({ error, eventType, status = "failed" }) {
  whatsappRuntime.failedToday += 1;
  whatsappRuntime.lastFailedAt = nowIso();
  whatsappRuntime.lastError = safeErrorDetail(error);
  if (status === "provider-not-configured") whatsappRuntime.twilioConnectionStatus = "not-configured";
  else whatsappRuntime.twilioConnectionStatus = "failed";
  pushRuntimeEvent({ status, eventType, error: whatsappRuntime.lastError });
}

export function validateWhatsAppEnvironment() {
  if (!enabledByEnv()) {
    whatsappRuntime.twilioConnectionStatus = "disabled";
    return { enabled: false, configured: false, status: "disabled" };
  }
  if (!twilioConfigured()) {
    whatsappRuntime.twilioConnectionStatus = "not-configured";
    if (!missingCredentialWarningLogged) {
      missingCredentialWarningLogged = true;
      logWarn("WhatsApp is enabled but Twilio credentials are incomplete; WhatsApp delivery disabled gracefully", {
        hasAccountSid: Boolean(process.env.TWILIO_ACCOUNT_SID),
        hasAuthToken: Boolean(process.env.TWILIO_AUTH_TOKEN),
        hasFrom: Boolean(process.env.TWILIO_WHATSAPP_FROM),
      });
    }
    return { enabled: true, configured: false, status: "not-configured" };
  }
  whatsappRuntime.twilioConnectionStatus = whatsappRuntime.twilioConnectionStatus === "not-checked"
    ? "configured"
    : whatsappRuntime.twilioConnectionStatus;
  return { enabled: true, configured: true, status: whatsappRuntime.twilioConnectionStatus };
}

function customerName(lead = {}) {
  return lead.fullName || lead.customerName || lead.customer || "Customer";
}

function caseId(lead = {}) {
  return lead.caseId || lead.leadId || lead.id || "-";
}

function assignedExecutivePhone(lead = {}) {
  return lead.assignedExecutiveMobile
    || lead.executiveMobile
    || lead.assignedExecutivePhone
    || lead.loanExecutiveMobile
    || "";
}

function financeManagerPhone(lead = {}) {
  return lead.financeManagerMobile
    || lead.assignedFinanceManagerMobile
    || lead.financeDeskMobile
    || lead.dealerMobile
    || "";
}

async function sendViaTwilio({ to, message, eventType, metadata = {} }) {
  const envStatus = validateWhatsAppEnvironment();
  if (!envStatus.enabled) return { ok: false, status: "disabled", error: "WhatsApp is disabled" };
  if (!envStatus.configured) return { ok: false, status: "provider-not-configured", error: "Twilio WhatsApp credentials are not configured" };

  const config = twilioConfig();
  const toAddress = normalizeTwilioAddress(to);
  if (!toAddress || toAddress === "whatsapp:") return { ok: false, status: "missing-phone", error: "Recipient WhatsApp number is missing" };

  const body = new URLSearchParams({
    From: config.from,
    To: toAddress,
    Body: message,
  });

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const providerResponse = await response.json().catch(async () => ({ raw: await response.text().catch(() => "") }));
  const result = {
    ok: response.ok,
    status: response.ok ? providerResponse.status || "queued" : "failed",
    messageSid: providerResponse.sid || null,
    provider: "twilio",
    providerStatus: providerResponse.status || null,
    error: response.ok ? null : safeErrorDetail(providerResponse.message || providerResponse.error_message || response.statusText),
    deliveryResult: {
      eventType,
      caseId: metadata.caseId || metadata.leadId || null,
      statusCode: response.status,
      providerStatus: providerResponse.status || null,
      messageSid: providerResponse.sid || null,
    },
  };
  if (result.ok) recordSuccess({ messageSid: result.messageSid, eventType });
  else recordFailure({ error: result.error, eventType, status: result.status });
  return result;
}

async function sendViaCloudApi({ to, message, eventType, metadata = {} }) {
  if (process.env.WHATSAPP_DRY_RUN !== "false") {
    const messageSid = `dry-run-${Date.now()}`;
    recordSuccess({ messageSid, eventType });
    return { ok: true, status: "delivered", dryRun: true, messageSid, deliveryResult: { eventType, caseId: metadata.caseId || null, dryRun: true } };
  }

  const token = process.env.WHATSAPP_CLOUD_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return { ok: false, status: "provider-not-configured", error: "WhatsApp Cloud API credentials are not configured" };

  const response = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizePhone(to).replace(/^\+/, ""),
      type: "text",
      text: { preview_url: false, body: message },
    }),
  });
  const providerText = await response.text();
  const providerResponse = (() => {
    try { return JSON.parse(providerText); } catch { return { raw: providerText }; }
  })();
  const messageSid = providerResponse.messages?.[0]?.id || null;
  const result = {
    ok: response.ok,
    status: response.ok ? "delivered" : "failed",
    messageSid,
    provider: "cloud-api",
    providerStatus: response.ok ? "delivered" : "failed",
    error: response.ok ? null : safeErrorDetail(providerResponse.error?.message || providerText),
    deliveryResult: { eventType, caseId: metadata.caseId || null, statusCode: response.status, messageSid },
  };
  if (result.ok) recordSuccess({ messageSid, eventType });
  else recordFailure({ error: result.error, eventType, status: result.status });
  return result;
}

export async function sendWhatsApp({ to, message, eventType = "WHATSAPP_MESSAGE", metadata = {}, provider = DEFAULT_PROVIDER }) {
  const phone = normalizePhone(to);
  const identity = notificationIdentity({
    leadId: metadata.leadId,
    caseId: metadata.caseId,
    eventType,
    phoneNumber: phone,
    metadata,
  });
  if (!phone) {
    const result = { ok: false, status: "missing-phone", error: "Recipient phone number is missing", deliveryResult: { eventType, caseId: metadata.caseId || null } };
    recordFailure({ error: result.error, eventType, status: result.status });
    return result;
  }
  if (!(await enabledBySettings())) {
    return { ok: false, status: "disabled", error: "WhatsApp disabled in workflow settings", deliveryResult: { eventType, caseId: metadata.caseId || null } };
  }

  const result = provider === "cloud-api"
    ? await sendViaCloudApi({ to: phone, message, eventType, metadata })
    : await sendViaTwilio({ to: phone, message, eventType, metadata });

  await logWhatsAppNotification({
    notificationKey: identity.notificationKey,
    type: eventType,
    eventType: identity.canonicalType,
    recipient: metadata.recipient || metadata.recipientId || null,
    recipientRole: metadata.recipientRole || null,
    recipientId: metadata.recipientId || null,
    phone,
    message,
    leadId: identity.leadId,
    caseId: identity.caseId,
    status: result.status,
    provider: result.provider || provider,
    messageSid: result.messageSid || null,
    deliveryResult: result.deliveryResult || null,
    error: result.error || null,
    metadata,
  });

  logInfo("WHATSAPP_SEND_RESULT", {
    eventType: identity.canonicalType,
    status: result.status,
    provider: result.provider || provider,
    messageSid: result.messageSid || null,
    caseId: identity.caseId || null,
    notificationKey: identity.notificationKey,
  });
  return result;
}

export async function queueWhatsAppNotification({
  type,
  eventType,
  recipientRole,
  recipientId,
  phoneNumber,
  message,
  leadId,
  caseId,
  provider = DEFAULT_PROVIDER,
  priority = "normal",
  metadata = {},
}) {
  if (!enabledByEnv()) return null;
  if (!(await enabledBySettings())) return null;

  const phone = normalizePhone(phoneNumber);
  const resolvedEventType = eventType || type || "WHATSAPP_MESSAGE";
  const identity = notificationIdentity({ leadId, caseId, eventType: resolvedEventType, phoneNumber: phone, metadata });
  const existingQueueItem = await getRecord("whatsappQueue", identity.notificationKey).catch(() => null);
  if (existingQueueItem && (isTerminalNotificationStatus(existingQueueItem.status) || existingQueueItem.messageSid)) {
    pushRuntimeEvent({
      status: "deduped",
      eventType: identity.canonicalType,
      caseId: identity.caseId,
      notificationKey: identity.notificationKey,
    });
    logInfo("WHATSAPP_NOTIFICATION_DEDUPED", {
      notificationKey: identity.notificationKey,
      eventType: identity.canonicalType,
      caseId: identity.caseId,
      recipient: identity.recipient,
      status: existingQueueItem.status,
      messageSid: existingQueueItem.messageSid || null,
    });
    return { ...existingQueueItem, deduped: true };
  }

  const existingLog = await getRecord("notificationLogs", identity.notificationKey).catch(() => null);
  if (existingLog && (isTerminalNotificationStatus(existingLog.status) || existingLog.messageSid)) {
    pushRuntimeEvent({
      status: "deduped",
      eventType: identity.canonicalType,
      caseId: identity.caseId,
      notificationKey: identity.notificationKey,
    });
    logInfo("WHATSAPP_NOTIFICATION_DEDUPED", {
      notificationKey: identity.notificationKey,
      eventType: identity.canonicalType,
      caseId: identity.caseId,
      recipient: identity.recipient,
      status: existingLog.status,
      messageSid: existingLog.messageSid || null,
    });
    return { ...existingLog, deduped: true };
  }

  const timestamp = nowIso();
  const record = await upsertRecord("whatsappQueue", identity.notificationKey, {
    id: identity.notificationKey,
    notificationKey: identity.notificationKey,
    type: type || resolvedEventType,
    eventType: identity.canonicalType,
    originalEventType: resolvedEventType,
    recipientRole,
    recipientId,
    recipient: recipientId || identity.recipient || null,
    phoneNumber: phone,
    phone,
    message,
    leadId: identity.leadId,
    caseId: identity.caseId,
    status: phone ? "queued" : "missing-phone",
    retryCount: Number(existingQueueItem?.retryCount || 0),
    provider,
    priority,
    metadata: { ...metadata, notificationKey: identity.notificationKey, originalEventType: resolvedEventType },
    deliveryResult: null,
    queuedAt: timestamp,
    timestamp,
  });

  whatsappRuntime.queued += 1;
  whatsappRuntime.pending += phone ? 1 : 0;
  pushRuntimeEvent({ status: record.status, eventType: identity.canonicalType, caseId: identity.caseId, notificationKey: identity.notificationKey });

  await logWhatsAppNotification({
    notificationKey: identity.notificationKey,
    type: type || resolvedEventType,
    eventType: identity.canonicalType,
    recipientRole,
    recipientId,
    recipient: identity.recipient,
    phone,
    message,
    leadId: identity.leadId,
    caseId: identity.caseId,
    status: record.status,
    retryCount: 0,
    provider,
    queueId: record.id,
    messageSid: null,
    deliveryResult: { status: record.status, queuedAt: timestamp },
    metadata,
  });

  if (phone) {
    addQueueJob(QUEUE_NAMES.WHATSAPP, "whatsapp-send", { queueId: record.id, jobId: record.id }, {
      jobId: record.id,
      priority,
      fallback: (payload) => processWhatsAppQueue({ queueId: payload?.queueId, limit: 1 }),
    }).catch((error) => logError("WhatsApp queue job enqueue failed", { error: error.message, eventType: identity.canonicalType, notificationKey: identity.notificationKey }));
  }

  return record;
}

async function sendViaProvider(item) {
  if (item.status === "missing-phone") return { ok: false, status: "missing-phone", error: "Recipient phone number is missing" };
  if (item.messageSid) return { ok: true, status: item.status || "sent", messageSid: item.messageSid, providerStatus: item.providerStatus || item.status || "sent" };
  return sendWhatsApp({
    to: item.phoneNumber || item.phone,
    message: item.message,
    eventType: item.eventType || item.type,
    metadata: {
      ...(item.metadata || {}),
      leadId: item.leadId,
      caseId: item.caseId || item.metadata?.caseId,
      recipientRole: item.recipientRole,
      recipientId: item.recipientId,
      notificationKey: item.notificationKey,
    },
    provider: item.provider || DEFAULT_PROVIDER,
  });
}

export async function processWhatsAppQueue({ limit = 25, queueId = null } = {}) {
  const settings = await getWorkflowSettings();
  const maxRetries = Number(settings.notificationSettings?.maxRetries || 3);
  const queue = queueId
    ? [await getRecord("whatsappQueue", queueId).catch(() => null)].filter(Boolean)
    : (await Promise.all([
      queryRecords("whatsappQueue", { where: [{ field: "status", value: "queued" }], limit, maxLimit: limit }).catch(() => ({ data: [] })),
      queryRecords("whatsappQueue", { where: [{ field: "status", value: "failed" }], limit, maxLimit: limit }).catch(() => ({ data: [] })),
    ]))
      .flatMap((page) => page.data || [])
      .sort((left, right) => String(left.createdAt || left.queuedAt || "").localeCompare(String(right.createdAt || right.queuedAt || "")))
      .slice(0, limit);

  const results = [];
  for (const item of queue
    .filter((candidate) => ["queued", "failed"].includes(String(candidate.status || "").toLowerCase()))
    .filter((candidate) => Number(candidate.retryCount || 0) < maxRetries)
    .filter((candidate) => !candidate.messageSid)) {
    const lockKey = item.notificationKey || item.id;
    if (processingWhatsAppKeys.has(lockKey)) {
      results.push({ id: item.id, status: "skipped-processing" });
      continue;
    }
    processingWhatsAppKeys.add(lockKey);
    try {
      const notificationKey = lockKey;
      await updateRecord("whatsappQueue", item.id, {
        status: "processing",
        processingStartedAt: nowIso(),
        lastAttemptAt: nowIso(),
      });
      const result = await sendViaProvider(item);
      const failed = !result.ok;
      const sidReceived = Boolean(result.messageSid);
      const nextStatus = failed && !sidReceived ? "failed" : sidReceived ? "sent" : "sent";
      const retryCount = failed ? Number(item.retryCount || 0) + 1 : Number(item.retryCount || 0);
      if (whatsappRuntime.pending > 0) whatsappRuntime.pending -= 1;
      await updateRecord("whatsappQueue", item.id, {
        status: nextStatus,
        providerStatus: result.providerStatus || result.status || null,
        retryCount,
        deliveredAt: !failed || sidReceived ? nowIso() : item.deliveredAt || null,
        failedAt: failed && !sidReceived ? nowIso() : item.failedAt || null,
        messageSid: result.messageSid || null,
        deliveryResult: result.deliveryResult || null,
        error: result.error || null,
      });
      await logWhatsAppNotification({
        notificationKey,
        type: item.type,
        eventType: item.eventType || item.type,
        recipientRole: item.recipientRole,
        recipientId: item.recipientId,
        recipient: item.recipient || item.recipientId || null,
        phone: item.phoneNumber,
        message: item.message,
        leadId: item.leadId,
        caseId: item.caseId || item.metadata?.caseId || null,
        status: nextStatus,
        retryCount,
        provider: item.provider,
        queueId: item.id,
        messageSid: result.messageSid || null,
        deliveryResult: result.deliveryResult || null,
        error: result.error || null,
        metadata: item.metadata || {},
      });
      results.push({ id: item.id, status: nextStatus, messageSid: result.messageSid || null });
    } catch (error) {
      if (whatsappRuntime.pending > 0) whatsappRuntime.pending -= 1;
      recordFailure({ error: error.message, eventType: item.eventType || item.type });
      const notificationKey = item.notificationKey || item.id;
      await updateRecord("whatsappQueue", item.id, {
        status: "failed",
        retryCount: Number(item.retryCount || 0) + 1,
        failedAt: nowIso(),
        error: safeErrorDetail(error.message),
      });
      await logWhatsAppNotification({
        notificationKey,
        type: item.type,
        eventType: item.eventType || item.type,
        recipientRole: item.recipientRole,
        recipientId: item.recipientId,
        recipient: item.recipient || item.recipientId || null,
        phone: item.phoneNumber || item.phone,
        message: item.message,
        leadId: item.leadId,
        caseId: item.caseId || item.metadata?.caseId || null,
        status: "failed",
        retryCount: Number(item.retryCount || 0) + 1,
        provider: item.provider,
        queueId: item.id,
        error: safeErrorDetail(error.message),
        metadata: item.metadata || {},
      });
      results.push({ id: item.id, status: "failed", error: safeErrorDetail(error.message) });
    } finally {
      processingWhatsAppKeys.delete(lockKey);
    }
  }
  return results;
}

export function queueLeadAssignedWhatsApp(lead = {}) {
  if (!lead.assignedExecutiveId && !lead.assignedExecutiveEmail && !assignedExecutivePhone(lead)) return null;
  const eventVersion = lead.reassignedAt
    || lead.assignmentTimestamp
    || lead.assignedAt
    || lead.updatedAt
    || lead.createdAt
    || "";
  return queueWhatsAppNotification({
    type: "lead-assigned",
    eventType: "LEAD_ASSIGNED",
    recipientRole: "loan-executive",
    recipientId: lead.assignedExecutiveId || lead.assignedExecutiveEmail || lead.assignedExecutiveName || null,
    phoneNumber: assignedExecutivePhone(lead),
    leadId: lead.id,
    caseId: caseId(lead),
    priority: "high",
    message: buildWhatsAppMessage("LEAD_ASSIGNED", {
      ...lead,
      customerName: customerName(lead),
      caseId: caseId(lead),
      loanAmount: lead.requiredLoanAmount || lead.loanAmount,
      bankName: lead.assignedBankName || lead.bankName,
      branchLocation: lead.branchLocation || lead.bankBranchLocation,
    }),
    metadata: {
      leadId: lead.id,
      caseId: caseId(lead),
      eventVersion,
      recipient: lead.assignedExecutiveName || lead.assignedExecutiveEmail || null,
    },
  });
}

export function queueDocumentsRequiredWhatsApp({ lead = {}, documents = [] } = {}) {
  const documentKey = [...documents].map((document) => String(document || "").trim()).filter(Boolean).sort().join("-");
  const eventVersion = lead.documentsRequestedAt
    || lead.pendingDocumentsRequestedAt
    || lead.updatedAt
    || `${lead.status || ""}-${documentKey}`;
  return queueWhatsAppNotification({
    type: "documents-required",
    eventType: "DOCUMENTS_REQUIRED",
    recipientRole: "finance-manager",
    recipientId: lead.financeManagerId || lead.financeManagerEmail || lead.assignedFinanceManager || null,
    phoneNumber: financeManagerPhone(lead),
    leadId: lead.id,
    caseId: caseId(lead),
    priority: "high",
    message: buildWhatsAppMessage("DOCUMENTS_REQUIRED", {
      ...lead,
      customerName: customerName(lead),
      caseId: caseId(lead),
      documents,
    }),
    metadata: {
      leadId: lead.id,
      caseId: caseId(lead),
      documents,
      eventVersion,
      recipient: lead.financeManagerName || lead.assignedFinanceManager || null,
    },
  });
}

export function queueStatusUpdatedWhatsApp({ lead = {}, statusLabel = "" } = {}) {
  const eventVersion = lead.statusUpdatedAt
    || lead.updatedAt
    || `${lead.status || statusLabel}`;
  return queueWhatsAppNotification({
    type: "status-updated",
    eventType: "STATUS_UPDATED",
    recipientRole: "finance-manager",
    recipientId: lead.financeManagerId || lead.financeManagerEmail || lead.assignedFinanceManager || null,
    phoneNumber: financeManagerPhone(lead),
    leadId: lead.id,
    caseId: caseId(lead),
    priority: "normal",
    message: buildWhatsAppMessage("STATUS_UPDATED", {
      ...lead,
      customerName: customerName(lead),
      caseId: caseId(lead),
      statusLabel,
    }),
    metadata: {
      leadId: lead.id,
      caseId: caseId(lead),
      status: statusLabel,
      eventVersion,
      recipient: lead.financeManagerName || lead.assignedFinanceManager || null,
    },
  });
}

export function queueDocumentsUploadedWhatsApp({ lead = {}, documents = [] } = {}) {
  const documentKey = [...documents].map((document) => String(document || "").trim()).filter(Boolean).sort().join("-");
  const eventVersion = lead.documentsUploadedAt
    || lead.updatedAt
    || `${lead.status || ""}-${documentKey}`;
  return queueWhatsAppNotification({
    type: "documents-uploaded",
    eventType: "DOCUMENTS_UPLOADED",
    recipientRole: "loan-executive",
    recipientId: lead.assignedExecutiveId || lead.assignedExecutiveEmail || lead.assignedExecutiveName || null,
    phoneNumber: assignedExecutivePhone(lead),
    leadId: lead.id,
    caseId: caseId(lead),
    priority: "high",
    message: buildWhatsAppMessage("DOCUMENTS_UPLOADED", {
      ...lead,
      customerName: customerName(lead),
      caseId: caseId(lead),
      documents,
    }),
    metadata: {
      leadId: lead.id,
      caseId: caseId(lead),
      documents,
      eventVersion,
      recipient: lead.assignedExecutiveName || lead.assignedExecutiveEmail || null,
    },
  });
}

export function whatsappMonitoringSummary() {
  validateWhatsAppEnvironment();
  const since = Date.now() - DAY_MS;
  const recentFailures = whatsappRuntime.events.filter((item) => item.status === "failed" && new Date(item.timestamp).getTime() >= since).length;
  return {
    enabled: enabledByEnv(),
    provider: DEFAULT_PROVIDER,
    configured: DEFAULT_PROVIDER === "twilio" ? twilioConfigured() : Boolean(process.env.WHATSAPP_CLOUD_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
    sentToday: whatsappRuntime.sentToday,
    failedToday: whatsappRuntime.failedToday,
    pending: whatsappRuntime.pending,
    queued: whatsappRuntime.queued,
    lastSuccess: whatsappRuntime.lastSuccessAt,
    lastFailed: whatsappRuntime.lastFailedAt,
    lastError: whatsappRuntime.lastError,
    lastMessageSid: whatsappRuntime.lastMessageSid,
    twilioConnectionStatus: whatsappRuntime.twilioConnectionStatus,
    recentFailures,
    events: whatsappRuntime.events.slice(0, 10),
  };
}
