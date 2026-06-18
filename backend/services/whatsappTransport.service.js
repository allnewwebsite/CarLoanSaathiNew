import * as core from "./whatsappCore.service.js";

export async function sendWhatsApp(...args) {
  return core.sendWhatsApp(...args);
}
