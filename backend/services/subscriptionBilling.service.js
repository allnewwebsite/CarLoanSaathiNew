import * as core from "./subscriptionCore.service.js";

export async function billingHistory(...args) {
  return core.billingHistory(...args);
}
export async function getBillingOverview(...args) {
  return core.getBillingOverview(...args);
}
