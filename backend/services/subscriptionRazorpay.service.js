import * as core from "./subscriptionCore.service.js";

export async function getCapturedRazorpayOrderPayment(...args) {
  return core.getCapturedRazorpayOrderPayment(...args);
}
export async function createSubscriptionOrder(...args) {
  return core.createSubscriptionOrder(...args);
}
export function computeRazorpaySignature(...args) {
  return core.computeRazorpaySignature(...args);
}
export function computeRazorpayWebhookSignature(...args) {
  return core.computeRazorpayWebhookSignature(...args);
}
export async function ensureSubscriptionPaymentAudits(...args) {
  return core.ensureSubscriptionPaymentAudits(...args);
}
export async function finalizeSubscriptionPayment(...args) {
  return core.finalizeSubscriptionPayment(...args);
}
export async function verifySubscriptionPayment(...args) {
  return core.verifySubscriptionPayment(...args);
}
