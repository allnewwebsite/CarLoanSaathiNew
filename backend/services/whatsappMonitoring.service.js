import { validateWhatsAppEnvironment } from "./whatsappValidation.service.js";
import {
  DAY_MS,
  DEFAULT_PROVIDER,
  enabledByEnv,
  twilioConfigured,
  whatsappRuntime,
} from "./whatsappShared.service.js";

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
