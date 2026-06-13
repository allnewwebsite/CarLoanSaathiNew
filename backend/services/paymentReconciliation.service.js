import { getRecord, queryRecords, upsertRecord } from "./firestore.service.js";
import {
  ensureSubscriptionPaymentAudits,
  finalizeSubscriptionPayment,
  getCapturedRazorpayOrderPayment,
  subscriptionSnapshot,
} from "./subscription.service.js";
import {
  ALERT_SEVERITY,
  emitOperationalAlert,
  recordOperationalEvent,
} from "./observability.service.js";
import { logError, logInfo } from "./logger.service.js";

const HEALTH_COLLECTION = "paymentReconciliationHealth";
const HEALTH_ID = "current";

function cutoffDate(hours) {
  return new Date(Date.now() - Number(hours) * 60 * 60 * 1000).toISOString();
}

async function recentOrders(status, { limit, lookbackHours }) {
  return queryRecords("subscriptionOrders", {
    where: [
      { field: "status", value: status },
      { field: "createdAt", op: ">=", value: cutoffDate(lookbackHours) },
    ],
    orderBy: "createdAt",
    direction: "asc",
    limit,
    maxLimit: 250,
    allowGlobal: true,
  });
}

async function alertIntegrity(type, order, message, meta = {}) {
  await emitOperationalAlert({
    type,
    severity: ALERT_SEVERITY.HIGH,
    component: "billing",
    title: "Subscription payment integrity issue",
    message,
    entityId: order.id,
    meta: {
      orderId: order.id,
      paymentId: order.paymentId || null,
      dealershipId: order.dealershipId,
      ...meta,
    },
  });
}

async function updateHealth(patch) {
  await upsertRecord(HEALTH_COLLECTION, HEALTH_ID, {
    enabled: process.env.ENABLE_SUBSCRIPTION_BILLING === "true",
    ...patch,
    updatedAt: new Date().toISOString(),
  }).catch(() => null);
}

export async function reconcileSubscriptionPayments({
  limit = Number(process.env.PAYMENT_RECONCILIATION_BATCH_SIZE || 50),
  lookbackHours = Number(process.env.PAYMENT_RECONCILIATION_LOOKBACK_HOURS || 168),
  fetchCapturedPayment = getCapturedRazorpayOrderPayment,
} = {}) {
  const startedAt = new Date().toISOString();
  const result = {
    checked: 0,
    captured: 0,
    activated: 0,
    idempotent: 0,
    noCapturedPayment: 0,
    integrityIssues: 0,
    failures: 0,
    repairedAudits: 0,
  };

  for (const status of ["CREATED", "PENDING"]) {
    const page = await recentOrders(status, { limit, lookbackHours });
    for (const order of page.data) {
      result.checked += 1;
      try {
        const payment = await fetchCapturedPayment(order.id);
        if (!payment) {
          result.noCapturedPayment += 1;
          continue;
        }
        result.captured += 1;
        const activation = await finalizeSubscriptionPayment({
          dealershipId: order.dealershipId,
          razorpayOrderId: order.id,
          razorpayPaymentId: payment.id,
          verifiedBy: "payment-reconciliation",
          providerPayment: payment,
          verificationSource: "reconciliation",
          actor: { role: "system", email: "payment-reconciliation" },
        });
        if (activation.idempotent) result.idempotent += 1;
        else result.activated += 1;
      } catch (error) {
        result.failures += 1;
        logError("Subscription payment reconciliation failed", {
          orderId: order.id,
          dealershipId: order.dealershipId,
          error: error.message,
        });
        await alertIntegrity(
          "captured_payment_not_activated",
          order,
          "A captured Razorpay payment could not activate its subscription",
          { code: error.code || null },
        );
      }
    }
  }

  const paidPage = await recentOrders("PAID", { limit, lookbackHours });
  for (const order of paidPage.data) {
    result.checked += 1;
    const paymentId = order.paymentId;
    const [payment, activation] = paymentId
      ? await Promise.all([
        getRecord("subscriptionPayments", paymentId).catch(() => null),
        getRecord("subscriptionPaymentActivations", paymentId).catch(() => null),
      ])
      : [null, null];
    const invoiceNumber = activation?.invoiceNumber || payment?.invoiceNumber;
    const invoice = invoiceNumber
      ? await getRecord("subscriptionInvoices", invoiceNumber).catch(() => null)
      : null;

    if (!paymentId || !payment) {
      result.integrityIssues += 1;
      await alertIntegrity("paid_order_missing_payment", order, "A paid subscription order is missing its payment record");
    }
    if (!invoice) {
      result.integrityIssues += 1;
      await alertIntegrity("paid_order_missing_invoice", order, "A paid subscription order is missing its invoice record", { invoiceNumber });
    }
    if (!activation) {
      result.integrityIssues += 1;
      await alertIntegrity("paid_order_missing_activation", order, "A paid subscription order is missing its activation marker");
    }
    if (payment) {
      const subscription = await getRecord("dealershipSubscriptions", order.dealershipId).catch(() => null);
      await ensureSubscriptionPaymentAudits({
        subscription: subscriptionSnapshot(subscription || {}),
        payment,
        invoice,
        verificationSource: payment.verificationSource || "reconciliation",
        verifiedBy: "payment-reconciliation",
        actor: { role: "system", email: "payment-reconciliation" },
      });
      result.repairedAudits += 1;
    }
  }

  const status = result.failures || result.integrityIssues ? "degraded" : "healthy";
  await Promise.all([
    updateHealth({
      status,
      lastRunAt: new Date().toISOString(),
      lastSuccessAt: result.failures ? null : new Date().toISOString(),
      lastFailureAt: result.failures ? new Date().toISOString() : null,
      result,
    }),
    recordOperationalEvent({
      type: "payment_reconciliation_completed",
      severity: status === "healthy" ? ALERT_SEVERITY.LOW : ALERT_SEVERITY.HIGH,
      component: "billing",
      message: "Subscription payment reconciliation completed",
      meta: result,
    }),
  ]);
  logInfo("Subscription payment reconciliation completed", { startedAt, ...result });
  return result;
}

export async function paymentReconciliationHealth() {
  const enabled = process.env.ENABLE_SUBSCRIPTION_BILLING === "true"
    && process.env.ENABLE_PAYMENT_RECONCILIATION !== "false";
  const state = await getRecord(HEALTH_COLLECTION, HEALTH_ID).catch(() => null);
  const intervalMs = Number(process.env.PAYMENT_RECONCILIATION_INTERVAL_MS || 15 * 60 * 1000);
  const stale = enabled && state?.lastRunAt
    ? Date.now() - new Date(state.lastRunAt).getTime() > intervalMs * 3
    : false;
  return {
    status: !enabled ? "disabled" : stale ? "degraded" : state?.status || "waiting",
    enabled,
    lastRunAt: state?.lastRunAt || null,
    lastSuccessAt: state?.lastSuccessAt || null,
    lastFailureAt: state?.lastFailureAt || null,
    stale,
    result: state?.result || null,
  };
}
