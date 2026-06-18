import { SUBSCRIPTION_STATUSES, SUBSCRIPTION_PLAN } from "./subscriptionCore.service.js";
import * as core from "./subscriptionCore.service.js";

export { SUBSCRIPTION_STATUSES };
export { SUBSCRIPTION_PLAN };
export function subscriptionAmounts(...args) {
  return core.subscriptionAmounts(...args);
}
export function subscriptionSnapshot(...args) {
  return core.subscriptionSnapshot(...args);
}
export async function initializeDealershipTrial(...args) {
  return core.initializeDealershipTrial(...args);
}
export async function initializeProfessionalSubscriptionPending(...args) {
  return core.initializeProfessionalSubscriptionPending(...args);
}
export async function getDealershipSubscription(...args) {
  return core.getDealershipSubscription(...args);
}
export async function assertLeadCreationAllowed(...args) {
  return core.assertLeadCreationAllowed(...args);
}
export async function processSubscriptionLifecycle(...args) {
  return core.processSubscriptionLifecycle(...args);
}
