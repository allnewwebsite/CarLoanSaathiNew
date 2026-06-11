import { createRecord, queryRecords, updateRecord } from "./firestore.service.js";
import { logError, logInfo, logWarn } from "./logger.service.js";
import { addQueueJob, QUEUE_NAMES } from "./queue.service.js";
import { getWorkflowSettings } from "./settings.service.js";

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

function nowIso() {
  return new Date().toISOString();
}

function normalizePhone(phoneNumber) {
  return String(phoneNumber || "").replace(/[^\d+]/g, "");
}

function normalizeTwilioAddress(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase().startsWith("whatsapp:")) return trimmed;
  return `whatsapp:${normalizePhone(trimmed)}`;
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

function formatAmount(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "-";
  return `Rs. ${new Intl.NumberFormat("en-IN").format(numeric)}`;
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

export function buildWhatsAppMessage(type, payload = {}) {
  const customer = payload.customerName || payload.fullName || "Customer";
  const leadId = payload.caseId || payload.leadId || payload.id || "-";
  const loanAmount = payload.loanAmount ? formatAmount(payload.loanAmount) : "-";

  const templates = {
    LEAD_ASSIGNED: [
      "CarLoanSaathi Lead Assigned",
      "",
      `Case ID: ${leadId}`,
      `Customer: ${customer}`,
      `Dealer: ${payload.dealershipName || payload.dealer || "-"}`,
      `Bank Branch: ${payload.bankName || "-"} ${payload.branchLocation ? `- ${payload.branchLocation}` : ""}`,
      `Loan Amount: ${loanAmount}`,
      "",
      "Please review this case within SLA.",
    ],
    DOCUMENTS_REQUIRED: [
      "CarLoanSaathi Documents Required",
      "",
      `Case ID: ${leadId}`,
      `Customer: ${customer}`,
      `Required: ${(payload.documents || []).join(", ") || "Pending documents"}`,
      "",
      "Please coordinate with the customer and upload documents.",
    ],
    STATUS_UPDATED: [
      "CarLoanSaathi Status Updated",
      "",
      `Case ID: ${leadId}`,
      `Customer: ${customer}`,
      `Current Status: ${payload.statusLabel || payload.status || "-"}`,
      "",
      "Please check the dashboard for details.",
    ],
    DOCUMENTS_UPLOADED: [
      "CarLoanSaathi Documents Uploaded",
      "",
      `Case ID: ${leadId}`,
      `Customer: ${customer}`,
      `Uploaded: ${(payload.documents || []).join(", ") || "Document"}`,
      "",
      "Please review the uploaded document.",
    ],
    "new-lead-assigned": [
      "New Lead Assigned",
      "",
      `Customer: ${customer}`,
      `Dealer: ${payload.dealershipName || payload.dealer || "-"}`,
      `Bank: ${payload.bankName || payload.bankPartner || payload.preferredBank || "-"}`,
      `Loan Amount: ${loanAmount}`,
      "",
      "Please review within SLA.",
    ],
    "executive-reassigned": ["Lead Reassigned", "", `Lead ID: ${leadId}`, `Executive: ${payload.executiveName || "-"}`, "Please review within SLA."],
    "sla-breach": ["SLA Missed Alert", "", `Executive: ${payload.executiveName || "-"}`, `Lead ID: ${leadId}`, "", "Lead auto-reassigned."],
    "pending-documents": ["Pending Document Alert", "", `Lead ID: ${leadId}`, `Customer: ${customer}`, "", "Required:", ...((payload.documents || []).map((doc) => `- ${doc}`))],
    approval: ["Loan Approved", "", `Customer: ${customer}`, `Bank: ${payload.bankName || payload.bankPartner || "-"}`, `Sanction Amount: ${payload.sanctionAmount ? formatAmount(payload.sanctionAmount) : loanAmount}`],
    rejection: ["Loan Rejected", "", `Lead ID: ${leadId}`, `Customer: ${customer}`, `Reason: ${payload.reason || payload.rejectionReason || "-"}`],
    disbursement: ["Loan Disbursed", "", `Lead ID: ${leadId}`, `Customer: ${customer}`, `Amount: ${payload.disbursedAmount ? formatAmount(payload.disbursedAmount) : loanAmount}`],
    escalation: ["Escalation Alert", "", `Lead ID: ${leadId}`, payload.message || "Action required by manager."],
    "daily-summary": ["Daily Summary", "", `Total Leads: ${payload.totalLeads ?? 0}`, `Approved: ${payload.approved ?? 0}`, `Pending: ${payload.pending ?? 0}`, `Disbursed: ${payload.disbursed ?? 0}`],
  };

  return (templates[type] || [payload.title || "CarLoanSaathi Update", "", payload.message || "Action required."])
    .filter((line) => line !== undefined)
    .join("\n");
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
      to: normalizePhone(to),
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

  await createRecord("notificationLogs", {
    type: eventType,
    eventType,
    recipient: metadata.recipient || metadata.recipientId || null,
    recipientRole: metadata.recipientRole || null,
    recipientId: metadata.recipientId || null,
    phoneNumber: phone,
    phone,
    messageSid: result.messageSid || null,
    status: result.status,
    leadId: metadata.leadId || null,
    caseId: metadata.caseId || null,
    deliveryResult: result.deliveryResult || null,
    error: result.error || null,
    provider: result.provider || provider,
    timestamp: nowIso(),
  });

  logInfo("WHATSAPP_SEND_RESULT", {
    eventType,
    status: result.status,
    provider: result.provider || provider,
    messageSid: result.messageSid || null,
    caseId: metadata.caseId || null,
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
  const timestamp = nowIso();
  const record = await createRecord("whatsappQueue", {
    type: type || resolvedEventType,
    eventType: resolvedEventType,
    recipientRole,
    recipientId,
    recipient: recipientId || null,
    phoneNumber: phone,
    phone,
    message,
    leadId,
    caseId: caseId || metadata.caseId || null,
    status: phone ? "queued" : "missing-phone",
    retryCount: 0,
    provider,
    priority,
    metadata,
    deliveryResult: null,
    queuedAt: timestamp,
    timestamp,
  });

  whatsappRuntime.queued += 1;
  whatsappRuntime.pending += phone ? 1 : 0;
  pushRuntimeEvent({ status: record.status, eventType: resolvedEventType, caseId: caseId || metadata.caseId || null });

  await createRecord("notificationLogs", {
    type: type || resolvedEventType,
    eventType: resolvedEventType,
    recipientRole,
    recipientId,
    recipient: recipientId || null,
    phoneNumber: phone,
    phone,
    message,
    leadId,
    caseId: caseId || metadata.caseId || null,
    status: record.status,
    retryCount: 0,
    provider,
    queueId: record.id,
    messageSid: null,
    deliveryResult: { status: record.status, queuedAt: timestamp },
    timestamp,
  });

  if (phone) {
    addQueueJob(QUEUE_NAMES.WHATSAPP, "whatsapp-send", { queueId: record.id }, {
      priority,
      fallback: () => processWhatsAppQueue({ limit: 1 }),
    }).catch((error) => logError("WhatsApp queue job enqueue failed", { error: error.message, eventType: resolvedEventType }));
  }

  return record;
}

async function sendViaProvider(item) {
  if (item.status === "missing-phone") return { ok: false, status: "missing-phone", error: "Recipient phone number is missing" };
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
    },
    provider: item.provider || DEFAULT_PROVIDER,
  });
}

export async function processWhatsAppQueue({ limit = 25 } = {}) {
  const settings = await getWorkflowSettings();
  const maxRetries = Number(settings.notificationSettings?.maxRetries || 3);
  const pages = await Promise.all([
    queryRecords("whatsappQueue", { where: [{ field: "status", value: "queued" }], limit, maxLimit: limit }).catch(() => ({ data: [] })),
    queryRecords("whatsappQueue", { where: [{ field: "status", value: "failed" }], limit, maxLimit: limit }).catch(() => ({ data: [] })),
  ]);
  const queue = pages
    .flatMap((page) => page.data || [])
    .filter((item) => Number(item.retryCount || 0) < maxRetries)
    .sort((left, right) => String(left.createdAt || left.queuedAt || "").localeCompare(String(right.createdAt || right.queuedAt || "")))
    .slice(0, limit);

  const results = [];
  for (const item of queue) {
    try {
      const result = await sendViaProvider(item);
      const failed = !result.ok;
      const nextStatus = failed ? "failed" : "sent";
      const retryCount = failed ? Number(item.retryCount || 0) + 1 : Number(item.retryCount || 0);
      if (whatsappRuntime.pending > 0) whatsappRuntime.pending -= 1;
      await updateRecord("whatsappQueue", item.id, {
        status: nextStatus,
        providerStatus: result.providerStatus || result.status || null,
        retryCount,
        deliveredAt: result.ok ? nowIso() : item.deliveredAt || null,
        failedAt: failed ? nowIso() : item.failedAt || null,
        messageSid: result.messageSid || null,
        deliveryResult: result.deliveryResult || null,
        error: result.error || null,
      });
      await createRecord("notificationLogs", {
        type: item.type,
        eventType: item.eventType || item.type,
        recipientRole: item.recipientRole,
        recipientId: item.recipientId,
        recipient: item.recipientId || null,
        phoneNumber: item.phoneNumber,
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
        timestamp: nowIso(),
      });
      results.push({ id: item.id, status: nextStatus, messageSid: result.messageSid || null });
    } catch (error) {
      if (whatsappRuntime.pending > 0) whatsappRuntime.pending -= 1;
      recordFailure({ error: error.message, eventType: item.eventType || item.type });
      await updateRecord("whatsappQueue", item.id, {
        status: "failed",
        retryCount: Number(item.retryCount || 0) + 1,
        failedAt: nowIso(),
        error: safeErrorDetail(error.message),
      });
      results.push({ id: item.id, status: "failed", error: safeErrorDetail(error.message) });
    }
  }
  return results;
}

export function queueLeadAssignedWhatsApp(lead = {}) {
  if (!lead.assignedExecutiveId && !lead.assignedExecutiveEmail && !assignedExecutivePhone(lead)) return null;
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
    metadata: { leadId: lead.id, caseId: caseId(lead), recipient: lead.assignedExecutiveName || lead.assignedExecutiveEmail || null },
  });
}

export function queueDocumentsRequiredWhatsApp({ lead = {}, documents = [] } = {}) {
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
    metadata: { leadId: lead.id, caseId: caseId(lead), documents, recipient: lead.financeManagerName || lead.assignedFinanceManager || null },
  });
}

export function queueStatusUpdatedWhatsApp({ lead = {}, statusLabel = "" } = {}) {
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
    metadata: { leadId: lead.id, caseId: caseId(lead), status: statusLabel, recipient: lead.financeManagerName || lead.assignedFinanceManager || null },
  });
}

export function queueDocumentsUploadedWhatsApp({ lead = {}, documents = [] } = {}) {
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
    metadata: { leadId: lead.id, caseId: caseId(lead), documents, recipient: lead.assignedExecutiveName || lead.assignedExecutiveEmail || null },
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
