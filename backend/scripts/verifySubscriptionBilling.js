import assert from "node:assert/strict";
import {
  computeRazorpaySignature,
  SUBSCRIPTION_PLAN,
  SUBSCRIPTION_STATUSES,
  subscriptionAmounts,
  subscriptionSnapshot,
} from "../services/subscription.service.js";

const now = new Date("2026-06-13T00:00:00.000Z");
const day = 24 * 60 * 60 * 1000;
const future = (days) => new Date(now.getTime() + days * day).toISOString();
const past = (days) => new Date(now.getTime() - days * day).toISOString();

assert.deepEqual(subscriptionAmounts(), {
  monthlyAmount: 15_000,
  gstRate: 18,
  gstAmount: 2_700,
  finalAmount: 17_700,
});

assert.equal(subscriptionSnapshot({ trialEndDate: future(60), paymentStatus: "NOT_PAID" }, now).subscriptionStatus, SUBSCRIPTION_STATUSES.TRIAL);
assert.equal(subscriptionSnapshot({ trialEndDate: future(7), paymentStatus: "NOT_PAID" }, now).subscriptionStatus, SUBSCRIPTION_STATUSES.EXPIRING_SOON);
assert.equal(subscriptionSnapshot({ trialEndDate: past(1), paymentStatus: "NOT_PAID" }, now).subscriptionStatus, SUBSCRIPTION_STATUSES.EXPIRED);
assert.equal(subscriptionSnapshot({ subscriptionEndDate: future(30), paymentStatus: "PAID" }, now).subscriptionStatus, SUBSCRIPTION_STATUSES.ACTIVE);
assert.equal(subscriptionSnapshot({ subscriptionEndDate: future(30), paymentStatus: "MANUAL" }, now).subscriptionStatus, SUBSCRIPTION_STATUSES.ACTIVE);
assert.equal(subscriptionSnapshot({ subscriptionEndDate: future(30), paymentStatus: "PAID", adminSuspended: true }, now).leadCreationAllowed, false);
assert.equal(SUBSCRIPTION_PLAN.billingCycleDays, 30);
assert.equal(SUBSCRIPTION_PLAN.trialDays, 60);

assert.equal(
  computeRazorpaySignature({ keySecret: "test-secret", orderId: "order_123", paymentId: "pay_456" }),
  "3d11ef56573a9e31769e78a41f41a18d4af118e57d57888eef2f0dda4a479357",
);

console.log("Subscription billing verification passed.");
