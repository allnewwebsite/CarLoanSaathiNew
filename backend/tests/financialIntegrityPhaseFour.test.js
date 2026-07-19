import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", "..");
const razorpay = fs.readFileSync(path.join(root, "backend/services/subscriptionRazorpay.service.js"), "utf8");
const webhook = fs.readFileSync(path.join(root, "backend/services/razorpayWebhook.service.js"), "utf8");
const billing = fs.readFileSync(path.join(root, "backend/services/subscriptionBilling.service.js"), "utf8");

test("captured payments are checked against immutable order amount and currency", () => {
  assert.match(razorpay, /Number\(providerPayment\.amount\) !== orderAmountPaise/);
  assert.match(razorpay, /PAYMENT_ORDER_AMOUNT_MISMATCH/);
  assert.doesNotMatch(razorpay, /Number\(order\.amountPaise\) !== amounts\.finalAmount \* 100/);
});

test("payment and activation records cannot be replayed across orders or dealerships", () => {
  assert.match(razorpay, /paymentBoundElsewhere/);
  assert.match(razorpay, /activationBoundElsewhere/);
  assert.match(razorpay, /PAYMENT_REPLAY_DETECTED/);
});

test("concurrent order creation uses one dealership-scoped payment intent", () => {
  assert.match(razorpay, /transaction\.get\("subscriptionOrderIntents", id\)/);
  assert.match(razorpay, /PAYMENT_ORDER_IN_PROGRESS/);
  assert.match(razorpay, /status: "PAID"[\s\S]*paymentId: razorpayPaymentId/);
  assert.match(razorpay, /transaction\.set\("subscriptionOrders", order\.id[\s\S]*transaction\.set\("subscriptionOrderIntents", id/);
});

test("signed failed-payment webhooks persist failure without activating entitlement", () => {
  const failedBranch = webhook.slice(webhook.indexOf('eventType === "payment.failed"'), webhook.indexOf('eventType !== "payment.captured"'));
  assert.match(failedBranch, /subscriptionPaymentFailures/);
  assert.match(failedBranch, /activated: false/);
  assert.doesNotMatch(failedBranch, /finalizeSubscriptionPayment/);
});

test("billing history exposes failed and pending attempts for financial audit", () => {
  assert.match(billing, /queryRecords\("subscriptionPaymentFailures"/);
  assert.match(billing, /pendingOrders/);
  assert.match(billing, /queryRecords\("subscriptionRefunds"/);
});

test("signed refund events are persisted and require explicit financial review", () => {
  assert.match(webhook, /subscriptionRefunds/);
  assert.match(webhook, /ADMIN_REVIEW_REQUIRED/);
  assert.match(webhook, /subscription_refund_requires_review/);
  assert.match(webhook, /entitlementAdjusted: false/);
});
