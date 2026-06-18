import { logInfo } from "./logger.service.js";
import { validateWhatsAppEnvironment } from "./whatsappValidation.service.js";
import {
  DEFAULT_PROVIDER,
  enabledBySettings,
  logWhatsAppNotification,
  normalizePhone,
  normalizeTwilioAddress,
  notificationIdentity,
  recordFailure,
  recordSuccess,
  safeErrorDetail,
  twilioConfig,
} from "./whatsappShared.service.js";

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
