import * as core from "./subscriptionCore.service.js";

export async function extendSubscriptionManually(...args) {
  return core.extendSubscriptionManually(...args);
}
export async function activateTrialManually(...args) {
  return core.activateTrialManually(...args);
}
export async function suspendSubscription(...args) {
  return core.suspendSubscription(...args);
}
