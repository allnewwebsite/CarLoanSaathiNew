import crypto from "node:crypto";
import {
  getRecord,
  queryRecords,
  runRecordTransaction,
  updateRecord,
  upsertRecord,
} from "./firestore.service.js";
import { createNotification } from "./notification.service.js";
import { publishRealtimeEvent, REALTIME_EVENTS } from "./realtime.service.js";
import { logError, logInfo } from "./logger.service.js";
import { AUDIT_ACTIONS, writeAuditLog, writeAuditLogOnce } from "./audit.service.js";
import {
  addDays,
  baseSubscription,
  cleanId,
  iso,
  nextLifecycleCheckAt,
  professionalPendingSubscription,
  SUBSCRIPTION_PLAN,
  subscriptionAmounts,
  SUBSCRIPTION_STATUSES,
  subscriptionSnapshot,
} from "./subscriptionPlan.service.js";
import { isProfessionalPlan } from "../utils/onboardingPlan.js";

export {
  SUBSCRIPTION_PLAN,
  subscriptionAmounts,
  SUBSCRIPTION_STATUSES,
  subscriptionSnapshot,
} from "./subscriptionPlan.service.js";

const COLLECTION = "dealershipSubscriptions";

function storedSubscriptionRecord(record = {}) {
  const { daysRemaining, ...stored } = record;
  return stored;
}

async function dealershipRecord(dealershipId) {
  return await getRecord("dealerships", dealershipId).catch(() => null)
    || await getRecord("approvedDealerships", dealershipId).catch(() => null)
    || await getRecord("dealers", dealershipId).catch(() => null);
}

async function syncSubscriptionSummary(snapshot) {
  const patch = {
    planName: snapshot.planName,
    subscriptionStatus: snapshot.subscriptionStatus,
    trialStartDate: snapshot.trialStartDate || null,
    trialEndDate: snapshot.trialEndDate || null,
    subscriptionStartDate: snapshot.subscriptionStartDate || null,
    subscriptionEndDate: snapshot.subscriptionEndDate || null,
    monthlyAmount: snapshot.monthlyAmount,
    gstAmount: snapshot.gstAmount,
    finalAmount: snapshot.finalAmount,
    lastPaymentDate: snapshot.lastPaymentDate || null,
    nextBillingDate: snapshot.nextBillingDate || null,
    paymentStatus: snapshot.paymentStatus || "NOT_PAID",
    selectedPlan: snapshot.selectedPlan,
    dashboardAccessAllowed: snapshot.dashboardAccessAllowed,
    razorpayOrderId: snapshot.razorpayOrderId || null,
    razorpayPaymentId: snapshot.razorpayPaymentId || null,
    invoiceNumber: snapshot.invoiceNumber || null,
  };
  await Promise.all(["dealerships", "approvedDealerships", "dealers"].map(async (collection) => {
    const existing = await getRecord(collection, snapshot.dealershipId).catch(() => null);
    if (existing) await updateRecord(collection, existing.id, patch).catch(() => null);
  }));
}

function publishSubscription(snapshot, actor = null, eventType = REALTIME_EVENTS.SUBSCRIPTION_UPDATED) {
  return publishRealtimeEvent({
    eventType,
    actor,
    data: {
      dealershipId: snapshot.dealershipId,
      recipientId: snapshot.financeDeskEmail || snapshot.dealershipId,
      status: snapshot.subscriptionStatus,
      subscription: {
        subscriptionStatus: snapshot.subscriptionStatus,
        daysRemaining: snapshot.daysRemaining,
        trialEndDate: snapshot.trialEndDate,
        subscriptionEndDate: snapshot.subscriptionEndDate,
        leadCreationAllowed: snapshot.leadCreationAllowed,
      },
    },
  });
}

export async function initializeDealershipTrial({
  dealershipId,
  dealership = null,
  approvedAt = new Date().toISOString(),
  trialDays = SUBSCRIPTION_PLAN.trialDays,
  actor = null,
} = {}) {
  const id = cleanId(dealershipId);
  if (!id) throw new Error("Dealership ID is required to start trial");
  const profile = dealership || await dealershipRecord(id) || {};
  const created = await runRecordTransaction(async (transaction) => {
    const existing = await transaction.get(COLLECTION, id);
    if (existing?.trialStartDate) return subscriptionSnapshot(existing);
    const subscription = baseSubscription({
      dealershipId: id,
      dealership: profile,
      trialStartDate: approvedAt,
      trialDays,
    });
    transaction.set(COLLECTION, id, storedSubscriptionRecord(subscription), { merge: true });
    return subscription;
  });
  await syncSubscriptionSummary(created);
  publishSubscription(created, actor, REALTIME_EVENTS.SUBSCRIPTION_TRIAL_STARTED);
  await writeAuditLog({
    actorId: actor?.email || actor?.uid || "system",
    actorRole: actor?.role || "system",
    actionType: AUDIT_ACTIONS.SUBSCRIPTION_TRIAL_ACTIVATED,
    targetEntity: "subscription",
    targetId: id,
    newValue: {
      trialStartDate: created.trialStartDate,
      trialEndDate: created.trialEndDate,
      status: created.subscriptionStatus,
    },
    meta: { dealershipId: id, source: "dealership-approval" },
  }).catch((error) => logError("Subscription trial audit failed", { dealershipId: id, error: error.message }));
  return created;
}

export async function initializeProfessionalSubscriptionPending({
  dealershipId,
  dealership = null,
  approvedAt = new Date().toISOString(),
  actor = null,
} = {}) {
  const id = cleanId(dealershipId);
  if (!id) throw new Error("Dealership ID is required to initialize subscription");
  const profile = dealership || await dealershipRecord(id) || {};
  const created = await runRecordTransaction(async (transaction) => {
    const existing = await transaction.get(COLLECTION, id);
    if (existing?.subscriptionEndDate || existing?.paymentStatus === "PAID") return subscriptionSnapshot(existing);
    const subscription = professionalPendingSubscription({ dealershipId: id, dealership: profile, approvedAt });
    transaction.set(COLLECTION, id, storedSubscriptionRecord(subscription), { merge: true });
    return subscription;
  });
  await syncSubscriptionSummary(created);
  publishSubscription(created, actor);
  return created;
}

export async function getDealershipSubscription(dealershipId, { initialize = true } = {}) {
  const id = cleanId(dealershipId);
  if (!id) return null;
  const existing = await getRecord(COLLECTION, id).catch(() => null);
  if (existing) return subscriptionSnapshot(existing);
  if (!initialize) return null;
  const dealership = await dealershipRecord(id);
  if (!dealership || dealership.approved === false || dealership.active === false) return null;
  if (isProfessionalPlan(dealership.selectedPlan)) {
    return initializeProfessionalSubscriptionPending({
      dealershipId: id,
      dealership,
      approvedAt: dealership.approvedAt || dealership.reviewedAt || dealership.accountApprovedAt || new Date().toISOString(),
    });
  }
  return initializeDealershipTrial({
    dealershipId: id,
    dealership,
    approvedAt: dealership.approvedAt || dealership.reviewedAt || dealership.accountApprovedAt || new Date().toISOString(),
  });
}

export async function assertLeadCreationAllowed(dealershipId) {
  const subscription = await getDealershipSubscription(dealershipId);
  const snapshot = subscriptionSnapshot(subscription || {});
  if (!subscription || !snapshot.leadCreationAllowed) {
    const paymentRequired = snapshot.subscriptionStatus === SUBSCRIPTION_STATUSES.PAYMENT_PENDING;
    const error = new Error(paymentRequired
      ? "Professional Plan payment is required before dashboard access can be activated."
      : "Your subscription has expired. Lead creation has been disabled. Please renew your subscription.");
    error.status = 403;
    error.code = paymentRequired ? "SUBSCRIPTION_PAYMENT_REQUIRED" : "SUBSCRIPTION_EXPIRED";
    error.subscription = snapshot;
    throw error;
  }
  return snapshot;
}

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
  const receipt = `cls_${crypto.createHash("sha256").update(`${id}:${Date.now()}`).digest("hex").slice(0, 28)}`;
  const { order, keyId } = await createRazorpayOrder({
    amount: amounts.finalAmount * 100,
    currency: SUBSCRIPTION_PLAN.currency,
    receipt,
    notes: {
      plan: SUBSCRIPTION_PLAN.name,
      dealershipRef: crypto.createHash("sha256").update(id).digest("hex").slice(0, 20),
      refundPolicy: "non-refundable-after-capture-and-activation",
    },
  });
  await upsertRecord("subscriptionOrders", order.id, {
    dealershipId: id,
    requestedBy,
    planName: SUBSCRIPTION_PLAN.name,
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
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
  });
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
  const amounts = subscriptionAmounts();
  const providerMatches = providerPayment?.id === razorpayPaymentId
    && providerPayment?.order_id === razorpayOrderId
    && Number(providerPayment?.amount) === amounts.finalAmount * 100
    && String(providerPayment?.currency || "").toUpperCase() === SUBSCRIPTION_PLAN.currency
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
    if (!order || !id || order.dealershipId !== id || Number(order.amountPaise) !== amounts.finalAmount * 100) {
      const error = new Error("Payment order does not match this dealership");
      error.status = 409;
      error.code = "PAYMENT_ORDER_MISMATCH";
      throw error;
    }
    const current = await transaction.get(COLLECTION, id);
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
    transaction.set(COLLECTION, id, storedSubscriptionRecord(next), { merge: true });
    transaction.set("subscriptionOrders", razorpayOrderId, {
      status: "PAID",
      paymentId: razorpayPaymentId,
      paidAt,
      updatedAt: paidAt,
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
  const amounts = subscriptionAmounts();
  const providerPayment = await verifiedRazorpayPayment({
    paymentId: razorpayPaymentId,
    orderId: razorpayOrderId,
    amountPaise: amounts.finalAmount * 100,
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

export async function billingHistory(dealershipId, { limit = 25, cursor = null } = {}) {
  const id = cleanId(dealershipId);
  const [payments, invoices] = await Promise.all([
    queryRecords("subscriptionPayments", {
      where: [{ field: "dealershipId", value: id }],
      orderBy: "paidAt",
      direction: "desc",
      limit,
      maxLimit: 50,
      cursor,
    }),
    queryRecords("subscriptionInvoices", {
      where: [{ field: "dealershipId", value: id }],
      orderBy: "paymentDate",
      direction: "desc",
      limit,
      maxLimit: 50,
      cursor,
    }),
  ]);
  return {
    payments: payments.data,
    invoices: invoices.data,
    nextCursor: payments.nextCursor || invoices.nextCursor || null,
  };
}

export async function getBillingOverview(dealershipId) {
  const subscription = await getDealershipSubscription(dealershipId);
  if (!subscription) {
    const error = new Error("Subscription not found");
    error.status = 404;
    throw error;
  }
  return {
    plan: {
      ...SUBSCRIPTION_PLAN,
      ...subscriptionAmounts(),
    },
    subscription: subscriptionSnapshot(subscription),
    history: await billingHistory(dealershipId),
  };
}

async function applyAdminSubscriptionPatch(dealershipId, patch, actor = null, eventType = REALTIME_EVENTS.SUBSCRIPTION_UPDATED) {
  const id = cleanId(dealershipId);
  const current = await getDealershipSubscription(id);
  if (!current) {
    const error = new Error("Subscription not found");
    error.status = 404;
    throw error;
  }
  const next = subscriptionSnapshot({ ...current, ...patch, updatedAt: new Date().toISOString() });
  next.nextLifecycleCheckAt = nextLifecycleCheckAt(next);
  await upsertRecord(COLLECTION, id, storedSubscriptionRecord(next));
  await syncSubscriptionSummary(next);
  publishSubscription(next, actor, eventType);
  return next;
}

export async function extendSubscriptionManually({ dealershipId, days, reason, actor = null }) {
  const extensionDays = Math.min(Math.max(Number(days || 0), 1), 3650);
  const current = await getDealershipSubscription(dealershipId);
  const now = new Date();
  const base = current?.entitlementEndDate && new Date(current.entitlementEndDate) > now
    ? current.entitlementEndDate
    : now.toISOString();
  return applyAdminSubscriptionPatch(dealershipId, {
    subscriptionStartDate: current?.subscriptionStartDate || now.toISOString(),
    subscriptionEndDate: addDays(base, extensionDays),
    paymentStatus: current?.paymentStatus === "PAID" ? "PAID" : "MANUAL",
    adminSuspended: false,
    manualExtensionReason: String(reason || "Manual extension by Super Admin").trim(),
    manualExtensionDays: extensionDays,
    lastAdminOverrideAt: now.toISOString(),
    warningDaysSent: [],
  }, actor, REALTIME_EVENTS.SUBSCRIPTION_EXTENDED);
}

export async function activateTrialManually({ dealershipId, days = SUBSCRIPTION_PLAN.trialDays, reason, actor = null }) {
  const trialDays = Math.min(Math.max(Number(days || 0), 1), 365);
  const now = new Date().toISOString();
  return applyAdminSubscriptionPatch(dealershipId, {
    trialStartDate: now,
    trialEndDate: addDays(now, trialDays),
    subscriptionStartDate: null,
    subscriptionEndDate: null,
    paymentStatus: "NOT_PAID",
    adminSuspended: false,
    manualTrialReason: String(reason || "Trial activated by Super Admin").trim(),
    lastAdminOverrideAt: now,
    warningDaysSent: [],
  }, actor, REALTIME_EVENTS.SUBSCRIPTION_TRIAL_STARTED);
}

export async function suspendSubscription({ dealershipId, reason, actor = null }) {
  return applyAdminSubscriptionPatch(dealershipId, {
    adminSuspended: true,
    suspensionReason: String(reason || "Suspended by Super Admin").trim(),
    suspendedAt: new Date().toISOString(),
    suspendedBy: actor?.email || actor?.uid || "super-admin",
  }, actor, REALTIME_EVENTS.SUBSCRIPTION_EXPIRED);
}

async function sendExpiryWarning(subscription, daysRemaining) {
  const endKey = String(subscription.entitlementEndDate || "").slice(0, 10);
  const warningId = `${crypto.createHash("sha256").update(subscription.dealershipId).digest("hex").slice(0, 16)}_${endKey}_${daysRemaining}`;
  const now = new Date();
  const claimed = await runRecordTransaction(async (transaction) => {
    const existing = await transaction.get("subscriptionWarnings", warningId);
    if (existing?.status === "SENT" || existing?.status === "CLAIMED") return false;
    if (existing?.nextAttemptAt && new Date(existing.nextAttemptAt) > now) return false;
    const attempts = Number(existing?.attempts || 0) + 1;
    if (attempts > 3) return false;
    transaction.set("subscriptionWarnings", warningId, {
      dealershipId: subscription.dealershipId,
      daysRemaining,
      entitlementEndDate: subscription.entitlementEndDate,
      status: "CLAIMED",
      attempts,
      claimedAt: now.toISOString(),
      createdAt: existing?.createdAt || now.toISOString(),
      nextAttemptAt: null,
    }, { merge: true });
    return true;
  });
  if (!claimed) return false;
  try {
    await createNotification({
      type: "subscription-expiry-warning",
      title: `${daysRemaining} Day${daysRemaining === 1 ? "" : "s"} Remaining`,
      message: `Your CarLoanSaathi Professional access expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}. Renew to keep lead creation enabled.`,
      recipientRole: "finance-desk",
      recipientId: subscription.financeDeskEmail || subscription.dealershipId,
      dealerEmail: subscription.dealershipId,
      dealershipId: subscription.dealershipId,
      phoneNumber: subscription.financeDeskMobile,
      priority: daysRemaining === 1 ? "high" : "normal",
      entityType: "subscription",
      entityId: subscription.dealershipId,
      meta: {
        dealershipId: subscription.dealershipId,
        daysRemaining,
        entitlementEndDate: subscription.entitlementEndDate,
        notificationKey: warningId,
      },
    });
    await updateRecord("subscriptionWarnings", warningId, {
      status: "SENT",
      sentAt: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    await updateRecord("subscriptionWarnings", warningId, {
      status: "FAILED",
      error: String(error.message || "Notification failed").slice(0, 300),
      nextAttemptAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      updatedAt: new Date().toISOString(),
    }).catch(() => null);
    throw error;
  }
}

export async function processSubscriptionLifecycle({ limit = 100 } = {}) {
  const now = new Date();
  const page = await queryRecords(COLLECTION, {
    where: [{ field: "nextLifecycleCheckAt", op: "<=", value: now.toISOString() }],
    orderBy: "nextLifecycleCheckAt",
    direction: "asc",
    limit,
    maxLimit: 250,
  });
  const result = { checked: page.data.length, updated: 0, warnings: 0, expired: 0 };
  for (const record of page.data) {
    try {
      const previousStatus = record.subscriptionStatus;
      const snapshot = subscriptionSnapshot(record, now);
      if (WARNING_DAYS.includes(snapshot.daysRemaining) && snapshot.leadCreationAllowed) {
        if (await sendExpiryWarning(snapshot, snapshot.daysRemaining)) result.warnings += 1;
      }
      snapshot.nextLifecycleCheckAt = nextLifecycleCheckAt(snapshot, now);
      snapshot.lifecycleCheckedAt = now.toISOString();
      await upsertRecord(COLLECTION, snapshot.dealershipId, storedSubscriptionRecord(snapshot));
      if (snapshot.subscriptionStatus !== previousStatus) {
        result.updated += 1;
        if (snapshot.subscriptionStatus === SUBSCRIPTION_STATUSES.EXPIRED) result.expired += 1;
        await syncSubscriptionSummary(snapshot);
        publishSubscription(
          snapshot,
          { role: "system", email: "subscription-lifecycle" },
          snapshot.subscriptionStatus === SUBSCRIPTION_STATUSES.EXPIRED
            ? REALTIME_EVENTS.SUBSCRIPTION_EXPIRED
            : REALTIME_EVENTS.SUBSCRIPTION_UPDATED,
        );
        if (snapshot.subscriptionStatus === SUBSCRIPTION_STATUSES.EXPIRED) {
          const expiredAction = record.entitlementType === "TRIAL"
            ? AUDIT_ACTIONS.SUBSCRIPTION_TRIAL_ENDED
            : AUDIT_ACTIONS.SUBSCRIPTION_EXPIRED;
          await writeAuditLog({
            actorId: "subscription-lifecycle",
            actorRole: "system",
            actionType: expiredAction,
            targetEntity: "subscription",
            targetId: snapshot.dealershipId,
            oldValue: { status: previousStatus },
            newValue: { status: snapshot.subscriptionStatus },
            meta: {
              dealershipId: snapshot.dealershipId,
              entitlementEndDate: snapshot.entitlementEndDate,
            },
          });
        }
      }
    } catch (error) {
      logError("Subscription lifecycle processing failed", {
        dealershipId: record.dealershipId || record.id,
        error: error.message,
      });
    }
  }
  logInfo("Subscription lifecycle processed", result);
  return result;
}
