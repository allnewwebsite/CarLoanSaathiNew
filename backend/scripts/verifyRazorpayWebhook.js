import assert from "node:assert/strict";

process.env.RAZORPAY_WEBHOOK_SECRET = "webhook-test-secret";
process.env.ENABLE_SUBSCRIPTION_BILLING = "true";
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";

const {
  computeRazorpayWebhookSignature,
  finalizeSubscriptionPayment,
  SUBSCRIPTION_PLAN,
  subscriptionAmounts,
} = await import("../services/subscription.service.js");
const { processRazorpayWebhook, razorpayWebhookHealth } = await import("../services/razorpayWebhook.service.js");
const { reconcileSubscriptionPayments } = await import("../services/paymentReconciliation.service.js");
const { deleteRecord, getRecord, queryRecords, upsertRecord } = await import("../services/firestore.service.js");

const amountPaise = subscriptionAmounts().finalAmount * 100;
const dayMs = 24 * 60 * 60 * 1000;

function capturedEvent(orderId, paymentId) {
  return {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: orderId,
          amount: amountPaise,
          currency: "INR",
          status: "captured",
          method: "card",
        },
      },
    },
  };
}

async function seedScenario(suffix) {
  const dealershipId = `webhook-dealer-${suffix}`;
  const orderId = `order_${suffix}`;
  const paymentId = `pay_${suffix}`;
  await upsertRecord("dealershipSubscriptions", dealershipId, {
    id: dealershipId,
    dealershipId,
    dealershipName: `Webhook Dealer ${suffix}`,
    financeDeskEmail: `${suffix}@example.com`,
    trialEndDate: new Date(Date.now() - dayMs).toISOString(),
    paymentStatus: "NOT_PAID",
    adminSuspended: false,
  });
  await upsertRecord("subscriptionOrders", orderId, {
    id: orderId,
    dealershipId,
    amountPaise,
    currency: "INR",
    status: "CREATED",
    razorpayOrderId: orderId,
    createdAt: new Date().toISOString(),
  });
  return { dealershipId, orderId, paymentId, event: capturedEvent(orderId, paymentId) };
}

async function counts(dealershipId) {
  const [payments, invoices] = await Promise.all([
    queryRecords("subscriptionPayments", {
      where: [{ field: "dealershipId", value: dealershipId }],
      limit: 20,
      maxLimit: 20,
    }),
    queryRecords("subscriptionInvoices", {
      where: [{ field: "dealershipId", value: dealershipId }],
      limit: 20,
      maxLimit: 20,
    }),
  ]);
  return { payments: payments.data.length, invoices: invoices.data.length };
}

async function sendWebhook(scenario, eventId) {
  const rawBody = Buffer.from(JSON.stringify(scenario.event));
  const signature = computeRazorpayWebhookSignature({
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
    rawBody,
  });
  return processRazorpayWebhook({ rawBody, signature, eventId });
}

for (let attempt = 1; attempt <= 3; attempt += 1) {
  await assert.rejects(
    () => processRazorpayWebhook({
      rawBody: Buffer.from(JSON.stringify(capturedEvent("order_invalid", `pay_invalid_${attempt}`))),
      signature: "invalid-signature",
      eventId: `evt_invalid_signature_${attempt}`,
    }),
    (error) => error.code === "INVALID_WEBHOOK_SIGNATURE",
  );
}
assert.equal((await razorpayWebhookHealth()).signatureFailureCount, 3);

const webhookFirst = await seedScenario("webhook-first");
const webhookResult = await sendWebhook(webhookFirst, "evt_webhook_first");
assert.equal(webhookResult.idempotent, false);
assert.equal((await counts(webhookFirst.dealershipId)).payments, 1);
assert.equal((await counts(webhookFirst.dealershipId)).invoices, 1);
const webhookEnd = (await getRecord("dealershipSubscriptions", webhookFirst.dealershipId)).subscriptionEndDate;

const frontendAfterWebhook = await finalizeSubscriptionPayment({
  dealershipId: webhookFirst.dealershipId,
  razorpayOrderId: webhookFirst.orderId,
  razorpayPaymentId: webhookFirst.paymentId,
  verifiedBy: "frontend-test",
  providerPayment: webhookFirst.event.payload.payment.entity,
  verificationSource: "frontend",
});
assert.equal(frontendAfterWebhook.idempotent, true);
assert.equal((await getRecord("dealershipSubscriptions", webhookFirst.dealershipId)).subscriptionEndDate, webhookEnd);
assert.deepEqual(await counts(webhookFirst.dealershipId), { payments: 1, invoices: 1 });

const duplicateWebhook = await sendWebhook(webhookFirst, "evt_webhook_first");
assert.equal(duplicateWebhook.idempotent, true);
assert.equal((await getRecord("dealershipSubscriptions", webhookFirst.dealershipId)).subscriptionEndDate, webhookEnd);
assert.deepEqual(await counts(webhookFirst.dealershipId), { payments: 1, invoices: 1 });

const originalPayment = await getRecord("subscriptionPayments", webhookFirst.paymentId);
await deleteRecord("subscriptionPayments", webhookFirst.paymentId);
await deleteRecord("subscriptionInvoices", originalPayment.invoiceNumber);
const repaired = await finalizeSubscriptionPayment({
  dealershipId: webhookFirst.dealershipId,
  razorpayOrderId: webhookFirst.orderId,
  razorpayPaymentId: webhookFirst.paymentId,
  verifiedBy: "reconciliation-repair-test",
  providerPayment: webhookFirst.event.payload.payment.entity,
  verificationSource: "reconciliation",
});
assert.equal(repaired.idempotent, true);
assert.equal((await getRecord("dealershipSubscriptions", webhookFirst.dealershipId)).subscriptionEndDate, webhookEnd);
assert.deepEqual(await counts(webhookFirst.dealershipId), { payments: 1, invoices: 1 });
assert.ok(await getRecord("auditLogs", `payment-received-${webhookFirst.paymentId}`));
assert.ok(await getRecord("auditLogs", `subscription-renewed-${webhookFirst.paymentId}`));

const frontendFirst = await seedScenario("frontend-first");
const frontendResult = await finalizeSubscriptionPayment({
  dealershipId: frontendFirst.dealershipId,
  razorpayOrderId: frontendFirst.orderId,
  razorpayPaymentId: frontendFirst.paymentId,
  verifiedBy: "frontend-test",
  providerPayment: frontendFirst.event.payload.payment.entity,
  verificationSource: "frontend",
});
assert.equal(frontendResult.idempotent, false);
const frontendEnd = (await getRecord("dealershipSubscriptions", frontendFirst.dealershipId)).subscriptionEndDate;

const webhookAfterFrontend = await sendWebhook(frontendFirst, "evt_frontend_first");
assert.equal(webhookAfterFrontend.idempotent, true);
assert.equal((await getRecord("dealershipSubscriptions", frontendFirst.dealershipId)).subscriptionEndDate, frontendEnd);
assert.deepEqual(await counts(frontendFirst.dealershipId), { payments: 1, invoices: 1 });

const browserClosed = await seedScenario("browser-closed");
const reconciliation = await reconcileSubscriptionPayments({
  fetchCapturedPayment: async (orderId) => (
    orderId === browserClosed.orderId ? browserClosed.event.payload.payment.entity : null
  ),
});
assert.equal(reconciliation.activated, 1);
const reconciledEnd = (await getRecord("dealershipSubscriptions", browserClosed.dealershipId)).subscriptionEndDate;
assert.deepEqual(await counts(browserClosed.dealershipId), { payments: 1, invoices: 1 });
const delayedWebhook = await sendWebhook(browserClosed, "evt_delayed_after_reconciliation");
assert.equal(delayedWebhook.idempotent, true);
assert.equal((await getRecord("dealershipSubscriptions", browserClosed.dealershipId)).subscriptionEndDate, reconciledEnd);

const simultaneous = await seedScenario("simultaneous");
const rawBody = Buffer.from(JSON.stringify(simultaneous.event));
const simultaneousSignature = computeRazorpayWebhookSignature({
  webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  rawBody,
});
const [frontendConcurrent, webhookConcurrent] = await Promise.all([
  finalizeSubscriptionPayment({
    dealershipId: simultaneous.dealershipId,
    razorpayOrderId: simultaneous.orderId,
    razorpayPaymentId: simultaneous.paymentId,
    verifiedBy: "frontend-test",
    providerPayment: simultaneous.event.payload.payment.entity,
    verificationSource: "frontend",
  }),
  processRazorpayWebhook({
    rawBody,
    signature: simultaneousSignature,
    eventId: "evt_simultaneous",
  }),
]);
assert.equal([frontendConcurrent, webhookConcurrent].filter((item) => item.idempotent === false).length, 1);
assert.deepEqual(await counts(simultaneous.dealershipId), { payments: 1, invoices: 1 });

const validityMs = new Date(frontendEnd).getTime() - new Date(frontendResult.payment.validityStartDate).getTime();
assert.equal(validityMs, SUBSCRIPTION_PLAN.billingCycleDays * dayMs);
assert.equal((await razorpayWebhookHealth()).status, "healthy");

console.log(JSON.stringify({
  ok: true,
  webhookFirstThenFrontend: "idempotent",
  frontendFirstThenWebhook: "idempotent",
  duplicateWebhook: "idempotent",
  missingPaymentAndInvoiceRepair: "repaired without extension",
  browserClosedReconciliation: "activated",
  delayedWebhookAfterReconciliation: "idempotent",
  simultaneousFrontendAndWebhook: "single activation",
  serverRestartRecovery: "covered by persisted order reconciliation",
  paymentCountPerRenewal: 1,
  invoiceCountPerRenewal: 1,
  extensionDays: SUBSCRIPTION_PLAN.billingCycleDays,
  webhookHealth: "healthy",
}, null, 2));
