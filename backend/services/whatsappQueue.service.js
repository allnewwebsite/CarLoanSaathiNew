import * as core from "./whatsappCore.service.js";

export async function queueWhatsAppNotification(...args) {
  return core.queueWhatsAppNotification(...args);
}
export async function processWhatsAppQueue(...args) {
  return core.processWhatsAppQueue(...args);
}
export function queueLeadAssignedWhatsApp(...args) {
  return core.queueLeadAssignedWhatsApp(...args);
}
export function queueDocumentsRequiredWhatsApp(...args) {
  return core.queueDocumentsRequiredWhatsApp(...args);
}
export function queueStatusUpdatedWhatsApp(...args) {
  return core.queueStatusUpdatedWhatsApp(...args);
}
export function queueDocumentsUploadedWhatsApp(...args) {
  return core.queueDocumentsUploadedWhatsApp(...args);
}
