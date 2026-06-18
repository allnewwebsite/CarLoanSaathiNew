import * as core from "./subscriptionCore.service.js";
export {
  SUBSCRIPTION_PLAN,
  SUBSCRIPTION_STATUSES,
  subscriptionAmounts,
  subscriptionSnapshot,
} from "./subscriptionPlan.service.js";

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
