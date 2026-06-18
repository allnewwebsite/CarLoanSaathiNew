import { logWarn } from "./logger.service.js";
import {
  enabledByEnv,
  markMissingCredentialWarningLogged,
  missingCredentialWarningLogged,
  twilioConfigured,
  whatsappRuntime,
} from "./whatsappShared.service.js";

export function validateWhatsAppEnvironment() {
  if (!enabledByEnv()) {
    whatsappRuntime.twilioConnectionStatus = "disabled";
    return { enabled: false, configured: false, status: "disabled" };
  }
  if (!twilioConfigured()) {
    whatsappRuntime.twilioConnectionStatus = "not-configured";
    if (!missingCredentialWarningLogged) {
      markMissingCredentialWarningLogged();
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
