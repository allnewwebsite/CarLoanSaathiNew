import crypto from "node:crypto";
import {
  getRecord,
  runRecordTransaction,
  upsertRecord,
} from "./firestore.service.js";
import { REALTIME_EVENTS } from "./realtime.service.js";
import { AUDIT_ACTIONS, writeAuditLogOnce } from "./audit.service.js";
import { createNotification } from "./notification.service.js";
import { ALERT_SEVERITY, recordOperationalEvent } from "./observability.service.js";
import { logError } from "./logger.service.js";
import {
  addDays,
  cleanId,
  nextLifecycleCheckAt,
  SUBSCRIPTION_PLAN,
  subscriptionAmounts,
  subscriptionSnapshot,
} from "./subscriptionPlan.service.js";
import { getDealershipSubscription } from "./subscriptionLifecycle.service.js";
import {
  publishSubscription,
  storedSubscriptionRecord,
  SUBSCRIPTION_COLLECTION,
  syncSubscriptionSummary,
} from "./subscriptionShared.service.js";

function razorpayCredentials() {
  const keyId = String(process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
  if (!keyId || !keySecret) {
    const error = new Error("Razorpay is not configured");
    error.status = 503;
    error.code = "PAYMENT_PROVIDER_NOT_CONFIGURED";
    throw error;
  }
  return { keyId, keySecret };
}

async function razorpayRequest(path, { method = "GET", requestBody = null } = {}) {
  const { keyId, keySecret } = razorpayCredentials();
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: requestBody ? JSON.stringify(requestBody) : undefined,
  });
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(responseBody?.error?.description || "Razorpay request failed");
    error.status = 502;
    error.code = "RAZORPAY_REQUEST_FAILED";
    throw error;
  }
  return { data: responseBody, keyId };
}

async function createRazorpayOrder(payload) {
  const { data: order, keyId } = await razorpayRequest("/orders", {
    method: "POST",
    requestBody: payload,
  });
  if (!order.id) {
    const error = new Error("Razorpay did not return an order ID");
    error.status = 502;
    error.code = "RAZORPAY_ORDER_FAILED";
    throw error;
  }
  return { order, keyId };
}

async function verifiedRazorpayPayment({ paymentId, orderId, amountPaise }) {
  let { data: payment } = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`);
  if (payment.status === "authorized") {
    ({ data: payment } = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}/capture`, {
      method: "POST",
      requestBody: {
        amount: amountPaise,
        currency: SUBSCRIPTION_PLAN.currency,
      },
    }));
  }
  const matches = payment.id === paymentId
    && payment.order_id === orderId
    && Number(payment.amount) === Number(amountPaise)
    && String(payment.currency || "").toUpperCase() === SUBSCRIPTION_PLAN.currency
    && payment.status === "captured";
  if (!matches) {
    const error = new Error("Razorpay payment is not captured or does not match the subscription order");
    error.status = 409;
    error.code = "PAYMENT_PROVIDER_MISMATCH";
    throw error;
  }
  return payment;
}

export async function getCapturedRazorpayOrderPayment(orderId) {
  const { data } = await razorpayRequest(`/orders/${encodeURIComponent(orderId)}/payments`);
  const payments = Array.isArray(data?.items) ? data.items : [];
  return payments.find((payment) => payment.status === "captured") || null;
}

export async function createSubscriptionOrder({ dealershipId, requestedBy, refundPolicyAcceptedAt = null }) {
  const id = cleanId(dealershipId);
  const subscription = await getDealershipSubscription(id);
  if (!subscription) {
    const error = new Error("Subscription record not found");
    error.status = 404;
    throw error;
  }
  const amounts = subscriptionAmounts();
  const intentToken = crypto.randomUUID();
  const existingOrderId = await runRecordTransaction(async (transaction) => {
    const intent = await transaction.get("subscriptionOrderIntents", id);
    const active = intent?.expiresAt && new Date(intent.expiresAt).getTime() > Date.now();
    if (active && intent.status === "CREATED" && intent.orderId) return intent.orderId;
    if (active && intent.status === "CREATING") {
      const error = new Error("A subscription payment order is already being created");
      error.status = 409;
      error.code = "PAYMENT_ORDER_IN_PROGRESS";
      throw error;
    }
    transaction.set("subscriptionOrderIntents", id, {
      dealershipId: id,
      status: "CREATING",
      intentToken,
      requestedBy,
      expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
    }, { merge: true });
    return null;
  });
  if (existingOrderId) {
    const existingOrder = await getRecord("subscriptionOrders", existingOrderId);
    if (existingOrder?.status === "CREATED") {
      return {
        keyId: razorpayCredentials().keyId,
        orderId: existingOrder.id,
        amount: existingOrder.amount,
        amountPaise: existingOrder.amountPaise,
        currency: existingOrder.currency,
        planName: existingOrder.planName,
        dealershipName: subscription.dealershipName,
        financeDeskEmail: subscription.financeDeskEmail,
        financeDeskMobile: subscription.financeDeskMobile,
        refundPolicy: "Subscription fees are non-refundable once payment is captured and subscription access is activated.",
        idempotent: true,
      };
    }
  }
  const receipt = `cls_${crypto.createHash("sha256").update(`${id}:${Date.now()}`).digest("hex").slice(0, 28)}`;
  let order;
  let keyId;
  try {
    ({ order, keyId } = await createRazorpayOrder({
      amount: amounts.finalAmount * 100,
      currency: SUBSCRIPTION_PLAN.currency,
      receipt,
      notes: {
        plan: SUBSCRIPTION_PLAN.name,
        dealershipRef: crypto.createHash("sha256").update(id).digest("hex").slice(0, 20),
        refundPolicy: "non-refundable-after-capture-and-activation",
      },
    }));
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await runRecordTransaction(async (transaction) => {
      transaction.set("subscriptionOrders", order.id, {
        dealershipId: id,
        requestedBy,
        planName: SUBSCRIPTION_PLAN.name,
        monthlyAmount: amounts.monthlyAmount,
        gstRate: amounts.gstRate,
        gstAmount: amounts.gstAmount,
        amount: amounts.finalAmount,
        amountPaise: amounts.finalAmount * 100,
        currency: SUBSCRIPTION_PLAN.currency,
        receipt,
        status: "CREATED",
        razorpayOrderId: order.id,
        providerStatus: order.status || "created",
        refundPolicy: "NON_REFUNDABLE",
        refundPolicyAcceptedAt,
        refundPolicyAcceptedBy: requestedBy,
        expiresAt,
        createdAt: new Date().toISOString(),
      }, { merge: true });
      transaction.set("subscriptionOrderIntents", id, {
        dealershipId: id,
        status: "CREATED",
        intentToken,
        orderId: order.id,
        expiresAt,
      }, { merge: true });
    });
  } catch (error) {
    await upsertRecord("subscriptionOrderIntents", id, {
      dealershipId: id,
      status: "FAILED",
      intentToken,
      failedAt: new Date().toISOString(),
      failureCode: error.code || "PAYMENT_ORDER_CREATION_FAILED",
      expiresAt: new Date().toISOString(),
    }).catch(() => null);
    throw error;
  }
  return {
    keyId,
    orderId: order.id,
    amount: amounts.finalAmount,
    amountPaise: amounts.finalAmount * 100,
    currency: SUBSCRIPTION_PLAN.currency,
    planName: SUBSCRIPTION_PLAN.name,
    dealershipName: subscription.dealershipName,
    financeDeskEmail: subscription.financeDeskEmail,
    financeDeskMobile: subscription.financeDeskMobile,
    refundPolicy: "Subscription fees are non-refundable once payment is captured and subscription access is activated.",
  };
}

export function computeRazorpaySignature({ keySecret, orderId, paymentId }) {
  return crypto.createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
}

export function computeRazorpayWebhookSignature({ webhookSecret, rawBody }) {
  return crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
}

function validRazorpaySignature({ orderId, paymentId, signature }) {
  const { keySecret } = razorpayCredentials();
  const expected = computeRazorpaySignature({ keySecret, orderId, paymentId });
  const provided = String(signature || "").trim();
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

function invoiceNumber(sequence, now = new Date()) {
  return `CLS-INV-${now.getUTCFullYear()}-${String(sequence).padStart(6, "0")}`;
}

export async function ensureSubscriptionPaymentAudits({
  subscription,
  payment,
  invoice,
  verificationSource,
  verifiedBy = "system",
  actor = null,
}) {
  if (!payment?.id) return false;
  await Promise.all([
    writeAuditLogOnce(`payment-received-${payment.id}`, {
      actorId: verifiedBy,
      actorRole: actor?.role || "system",
      actionType: AUDIT_ACTIONS.PAYMENT_RECEIVED,
      targetEntity: "subscriptionPayment",
      targetId: payment.id,
      newValue: { status: "PAID", invoiceNumber: invoice?.invoiceNumber },
      meta: {
        dealershipId: payment.dealershipId,
        paymentId: payment.id,
        verificationSource,
      },
    }),
    writeAuditLogOnce(`subscription-renewed-${payment.id}`, {
      actorId: verifiedBy,
      actorRole: actor?.role || "system",
      actionType: AUDIT_ACTIONS.SUBSCRIPTION_RENEWED,
      targetEntity: "subscription",
      targetId: payment.dealershipId,
      newValue: {
        subscriptionEndDate: subscription?.subscriptionEndDate,
        status: subscription?.subscriptionStatus,
      },
      meta: {
        dealershipId: payment.dealershipId,
        paymentId: payment.id,
        invoiceNumber: invoice?.invoiceNumber,
        verificationSource,
      },
    }),
  ]);
  return true;
}

export async function finalizeSubscriptionPayment({
  dealershipId = null,
  razorpayOrderId,
  razorpayPaymentId,
  verifiedBy,
  providerPayment,
  verificationSource = "frontend",
  actor = null,
}) {
  const now = new Date();
  const paidAt = now.toISOString();
  const configuredAmounts = subscriptionAmounts();
  const providerMatches = providerPayment?.id === razorpayPaymentId
    && providerPayment?.order_id === razorpayOrderId
    && providerPayment?.status === "captured";
  if (!providerMatches) {
    const error = new Error("Razorpay payment is not captured or does not match the subscription order");
    error.status = 409;
    error.code = "PAYMENT_PROVIDER_MISMATCH";
    throw error;
  }
  const result = await runRecordTransaction(async (transaction) => {
    const order = await transaction.get("subscriptionOrders", razorpayOrderId);
    const existingPayment = await transaction.get("subscriptionPayments", razorpayPaymentId);
    const activation = await transaction.get("subscriptionPaymentActivations", razorpayPaymentId);
    const id = cleanId(dealershipId || order?.dealershipId);
    if (!order || !id || order.dealershipId !== id) {
      const error = new Error("Payment order does not match this dealership");
      error.status = 409;
      error.code = "PAYMENT_ORDER_MISMATCH";
      throw error;
    }
    const orderAmountPaise = Number(order.amountPaise);
    const orderCurrency = String(order.currency || "").toUpperCase();
    if (!Number.isSafeInteger(orderAmountPaise)
      || orderAmountPaise <= 0
      || Number(providerPayment.amount) !== orderAmountPaise
      || orderCurrency !== SUBSCRIPTION_PLAN.currency
      || String(providerPayment.currency || "").toUpperCase() !== orderCurrency) {
      const error = new Error("Captured payment amount or currency does not match the immutable subscription order");
      error.status = 409;
      error.code = "PAYMENT_ORDER_AMOUNT_MISMATCH";
      throw error;
    }
    const paymentBoundElsewhere = existingPayment && (
      existingPayment.dealershipId !== id
      || existingPayment.razorpayOrderId !== razorpayOrderId
    );
    const activationBoundElsewhere = activation && (
      activation.dealershipId !== id
      || activation.razorpayOrderId !== razorpayOrderId
    );
    if (paymentBoundElsewhere || activationBoundElsewhere) {
      const error = new Error("Payment has already been bound to another subscription order");
      error.status = 409;
      error.code = "PAYMENT_REPLAY_DETECTED";
      throw error;
    }
    const amounts = {
      monthlyAmount: Number(order.monthlyAmount ?? configuredAmounts.monthlyAmount),
      gstRate: Number(order.gstRate ?? configuredAmounts.gstRate),
      gstAmount: Number(order.gstAmount ?? configuredAmounts.gstAmount),
      finalAmount: orderAmountPaise / 100,
    };
    const current = await transaction.get(SUBSCRIPTION_COLLECTION, id);
    const counter = await transaction.get("systemCounters", "subscriptionInvoices");
    if (order.status === "PAID" && order.paymentId !== razorpayPaymentId) {
      const error = new Error("This payment order has already been used");
      error.status = 409;
      error.code = "PAYMENT_ORDER_ALREADY_USED";
      throw error;
    }
    if (activation?.status === "ACTIVATED" || existingPayment?.status === "PAID") {
      const invoiceNumberValue = activation?.invoiceNumber || existingPayment?.invoiceNumber;
      let invoice = invoiceNumberValue
        ? await transaction.get("subscriptionInvoices", invoiceNumberValue)
        : null;
      const resolvedPayment = existingPayment || activation?.paymentSnapshot || null;
      if (!existingPayment && resolvedPayment) {
        transaction.set("subscriptionPayments", razorpayPaymentId, resolvedPayment, { merge: false });
      }
      if (!invoice && invoiceNumberValue && resolvedPayment) {
        invoice = activation?.invoiceSnapshot || {
          id: invoiceNumberValue,
          invoiceNumber: invoiceNumberValue,
          dealershipId: id,
          dealershipName: current?.dealershipName || "",
          billingAddress: current?.billingAddress || "",
          planName: resolvedPayment.planName || SUBSCRIPTION_PLAN.name,
          monthlyAmount: resolvedPayment.monthlyAmount,
          gstRate: resolvedPayment.gstRate,
          gstAmount: resolvedPayment.gstAmount,
          finalAmount: resolvedPayment.finalAmount,
          currency: resolvedPayment.currency || SUBSCRIPTION_PLAN.currency,
          paymentStatus: "PAID",
          paymentId: razorpayPaymentId,
          razorpayPaymentId,
          paymentDate: resolvedPayment.paidAt || resolvedPayment.verifiedAt,
          validityStartDate: resolvedPayment.validityStartDate,
          validityEndDate: resolvedPayment.validityEndDate,
          createdAt: resolvedPayment.paidAt || paidAt,
          footerPolicy: "Subscription fees are non-refundable once payment is captured and subscription access is activated.",
          repairedAt: paidAt,
        };
        transaction.set("subscriptionInvoices", invoiceNumberValue, invoice, { merge: false });
      }
      if (!activation && existingPayment?.status === "PAID") {
        transaction.set("subscriptionPaymentActivations", razorpayPaymentId, {
          id: razorpayPaymentId,
          status: "ACTIVATED",
          dealershipId: id,
          razorpayOrderId,
          razorpayPaymentId,
          invoiceNumber: existingPayment.invoiceNumber,
          validityStartDate: existingPayment.validityStartDate,
          validityEndDate: existingPayment.validityEndDate,
          activatedAt: existingPayment.verifiedAt || existingPayment.paidAt || paidAt,
          verificationSource: existingPayment.verificationSource || "legacy",
          paymentSnapshot: existingPayment,
          invoiceSnapshot: invoice,
        }, { merge: false });
      }
      return {
        subscription: subscriptionSnapshot(current || {}),
        payment: resolvedPayment,
        invoice,
        idempotent: true,
        verificationSource: activation?.verificationSource || existingPayment?.verificationSource || "unknown",
      };
    }
    if (order.status === "PAID" && order.paymentId === razorpayPaymentId) {
      const error = new Error("Paid order is missing its payment record");
      error.status = 409;
      error.code = "PAYMENT_STATE_INCONSISTENT";
      throw error;
    }
    const currentSnapshot = subscriptionSnapshot(current || {});
    const currentEnd = currentSnapshot.entitlementEndDate && new Date(currentSnapshot.entitlementEndDate) > now
      ? currentSnapshot.entitlementEndDate
      : paidAt;
    const subscriptionStartDate = current?.subscriptionStartDate || currentEnd;
    const subscriptionEndDate = addDays(currentEnd, SUBSCRIPTION_PLAN.billingCycleDays);
    const sequence = Number(counter?.value || 0) + 1;
    const number = invoiceNumber(sequence, now);
    const next = subscriptionSnapshot({
      ...(current || {}),
      id,
      dealershipId: id,
      subscriptionStartDate,
      subscriptionEndDate,
      paymentStatus: "PAID",
      lastPaymentDate: paidAt,
      razorpayOrderId,
      razorpayPaymentId,
      invoiceNumber: number,
      adminSuspended: false,
      warningDaysSent: [],
      updatedAt: paidAt,
    }, now);
    next.nextLifecycleCheckAt = nextLifecycleCheckAt(next, now);
    const payment = {
      id: razorpayPaymentId,
      dealershipId: id,
      invoiceNumber: number,
      planName: SUBSCRIPTION_PLAN.name,
      monthlyAmount: amounts.monthlyAmount,
      gstRate: amounts.gstRate,
      gstAmount: amounts.gstAmount,
      finalAmount: amounts.finalAmount,
      currency: SUBSCRIPTION_PLAN.currency,
      status: "PAID",
      paymentStatus: "PAID",
      razorpayOrderId,
      razorpayPaymentId,
      providerStatus: providerPayment.status,
      providerMethod: providerPayment.method || null,
      refundPolicy: "NON_REFUNDABLE",
      paidAt,
      verifiedAt: paidAt,
      verifiedBy,
      verificationSource,
      validityStartDate: currentEnd,
      validityEndDate: subscriptionEndDate,
    };
    const invoice = {
      id: number,
      invoiceNumber: number,
      dealershipId: id,
      dealershipName: next.dealershipName || "",
      billingAddress: next.billingAddress || "",
      planName: SUBSCRIPTION_PLAN.name,
      monthlyAmount: amounts.monthlyAmount,
      gstRate: amounts.gstRate,
      gstAmount: amounts.gstAmount,
      finalAmount: amounts.finalAmount,
      currency: SUBSCRIPTION_PLAN.currency,
      paymentStatus: "PAID",
      paymentId: razorpayPaymentId,
      razorpayPaymentId,
      paymentDate: paidAt,
      validityStartDate: currentEnd,
      validityEndDate: subscriptionEndDate,
      createdAt: paidAt,
      footerPolicy: "Subscription fees are non-refundable once payment is captured and subscription access is activated.",
    };
    transaction.set("systemCounters", "subscriptionInvoices", { value: sequence, updatedAt: paidAt }, { merge: true });
    transaction.set(SUBSCRIPTION_COLLECTION, id, storedSubscriptionRecord(next), { merge: true });
    transaction.set("subscriptionOrders", razorpayOrderId, {
      status: "PAID",
      paymentId: razorpayPaymentId,
      paidAt,
      updatedAt: paidAt,
    }, { merge: true });
    transaction.set("subscriptionOrderIntents", id, {
      dealershipId: id,
      status: "PAID",
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      paidAt,
      expiresAt: paidAt,
    }, { merge: true });
    transaction.set("subscriptionPayments", razorpayPaymentId, payment, { merge: false });
    transaction.set("subscriptionInvoices", number, invoice, { merge: false });
    transaction.set("subscriptionPaymentActivations", razorpayPaymentId, {
      id: razorpayPaymentId,
      status: "ACTIVATED",
      dealershipId: id,
      razorpayOrderId,
      razorpayPaymentId,
      invoiceNumber: number,
      validityStartDate: currentEnd,
      validityEndDate: subscriptionEndDate,
      activatedAt: paidAt,
      verificationSource,
      paymentSnapshot: payment,
      invoiceSnapshot: invoice,
    }, { merge: false });
    return { subscription: next, payment, invoice, idempotent: false, verificationSource };
  });

  if (!result.idempotent) {
    await syncSubscriptionSummary(result.subscription);
    publishSubscription(result.subscription, actor, REALTIME_EVENTS.SUBSCRIPTION_RENEWED);
    const sideEffects = await Promise.allSettled([
      createNotification({
        type: "subscription-activated",
        title: "Professional subscription activated",
        message: `Payment verified. Your subscription is active until ${String(result.subscription.subscriptionEndDate || "").slice(0, 10)}.`,
        recipientRole: "finance-desk",
        recipientId: result.subscription.financeDeskEmail || result.subscription.dealershipId,
        dealerEmail: result.subscription.dealershipId,
        dealershipId: result.subscription.dealershipId,
        priority: "normal",
        entityType: "subscription",
        entityId: result.subscription.dealershipId,
        meta: {
          paymentId: result.payment.id,
          orderId: result.payment.razorpayOrderId,
          invoiceNumber: result.invoice?.invoiceNumber,
          dedupeKey: `subscription-activated-${result.payment.id}`,
        },
      }),
      recordOperationalEvent({
        type: "subscription_payment_activated",
        severity: ALERT_SEVERITY.LOW,
        component: "billing",
        message: "Verified payment activated a subscription",
        entityId: result.payment.id,
        meta: {
          dealershipId: result.payment.dealershipId,
          orderId: result.payment.razorpayOrderId,
          invoiceNumber: result.invoice?.invoiceNumber,
          amount: result.payment.finalAmount,
          currency: result.payment.currency,
          verificationSource: result.verificationSource,
        },
      }),
    ]);
    sideEffects.forEach((settled, index) => {
      if (settled.status === "rejected") logError("Post-payment side effect failed", { paymentId: result.payment.id, sideEffect: index, error: settled.reason?.message });
    });
  }
  if (result.payment?.id) {
    await ensureSubscriptionPaymentAudits({
      subscription: result.subscription,
      payment: result.payment,
      invoice: result.invoice,
      verificationSource: result.verificationSource,
      verifiedBy,
      actor,
    });
  }
  return result;
}

export async function verifySubscriptionPayment({
  dealershipId,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  verifiedBy,
  actor = null,
}) {
  if (!validRazorpaySignature({
    orderId: razorpayOrderId,
    paymentId: razorpayPaymentId,
    signature: razorpaySignature,
  })) {
    const error = new Error("Payment signature verification failed");
    error.status = 400;
    error.code = "INVALID_PAYMENT_SIGNATURE";
    throw error;
  }
  const order = await getRecord("subscriptionOrders", razorpayOrderId);
  if (!order || cleanId(order.dealershipId) !== cleanId(dealershipId)) {
    const error = new Error("Payment order does not match this dealership");
    error.status = 409;
    error.code = "PAYMENT_ORDER_MISMATCH";
    throw error;
  }
  const providerPayment = await verifiedRazorpayPayment({
    paymentId: razorpayPaymentId,
    orderId: razorpayOrderId,
    amountPaise: Number(order.amountPaise),
  });
  return finalizeSubscriptionPayment({
    dealershipId,
    razorpayOrderId,
    razorpayPaymentId,
    verifiedBy,
    providerPayment,
    verificationSource: "frontend",
    actor,
  });
}
