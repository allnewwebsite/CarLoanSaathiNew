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
import { AUDIT_ACTIONS, writeAuditLog } from "./audit.service.js";

export const SUBSCRIPTION_STATUSES = Object.freeze({
  TRIAL: "TRIAL",
  ACTIVE: "ACTIVE",
  EXPIRING_SOON: "EXPIRING_SOON",
  EXPIRED: "EXPIRED",
});

export const SUBSCRIPTION_PLAN = Object.freeze({
  name: "CarLoanSaathi Professional",
  monthlyAmount: 15_000,
  gstRate: Number(process.env.SUBSCRIPTION_GST_RATE || 18),
  billingCycleDays: 30,
  trialDays: 60,
  currency: "INR",
});

const DAY_MS = 24 * 60 * 60 * 1000;
const WARNING_DAYS = [7, 3, 1];
const COLLECTION = "dealershipSubscriptions";

function cleanId(value = "") {
  return String(value || "").trim().toLowerCase();
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function addDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString();
}

function latestDate(values = []) {
  const valid = values.map(iso).filter(Boolean).sort();
  return valid.at(-1) || null;
}

export function subscriptionAmounts() {
  const monthlyAmount = SUBSCRIPTION_PLAN.monthlyAmount;
  const gstAmount = Math.round(monthlyAmount * SUBSCRIPTION_PLAN.gstRate / 100);
  return {
    monthlyAmount,
    gstRate: SUBSCRIPTION_PLAN.gstRate,
    gstAmount,
    finalAmount: monthlyAmount + gstAmount,
  };
}

export function subscriptionSnapshot(record = {}, nowValue = new Date()) {
  const now = new Date(nowValue);
  const trialEndDate = iso(record.trialEndDate);
  const subscriptionEndDate = iso(record.subscriptionEndDate);
  const entitlementEndDate = latestDate([trialEndDate, subscriptionEndDate]);
  const remainingMs = entitlementEndDate ? new Date(entitlementEndDate).getTime() - now.getTime() : -1;
  const daysRemaining = Math.max(0, Math.ceil(remainingMs / DAY_MS));
  const expired = record.adminSuspended === true || !entitlementEndDate || remainingMs <= 0;
  const activeEntitlement = Boolean(
    subscriptionEndDate
    && entitlementEndDate === subscriptionEndDate
    && ["PAID", "MANUAL"].includes(String(record.paymentStatus || "").toUpperCase())
  );
  const subscriptionStatus = expired
    ? SUBSCRIPTION_STATUSES.EXPIRED
    : daysRemaining <= 7
      ? SUBSCRIPTION_STATUSES.EXPIRING_SOON
      : activeEntitlement
        ? SUBSCRIPTION_STATUSES.ACTIVE
        : SUBSCRIPTION_STATUSES.TRIAL;
  const trialRemaining = trialEndDate ? new Date(trialEndDate).getTime() - now.getTime() : -1;

  return {
    ...record,
    planName: SUBSCRIPTION_PLAN.name,
    billingCycleDays: SUBSCRIPTION_PLAN.billingCycleDays,
    renewalType: "MANUAL",
    ...subscriptionAmounts(),
    subscriptionStatus,
    entitlementType: activeEntitlement ? "PAID" : "TRIAL",
    entitlementEndDate,
    daysRemaining,
    trialStatus: !trialEndDate ? "NOT_STARTED" : trialRemaining > 0 ? "ACTIVE" : "EXPIRED",
    leadCreationAllowed: !expired,
    nextBillingDate: subscriptionEndDate,
  };
}

function nextLifecycleCheckAt(snapshot, nowValue = new Date()) {
  const now = new Date(nowValue);
  const end = snapshot.entitlementEndDate ? new Date(snapshot.entitlementEndDate) : null;
  if (!end || end <= now || snapshot.adminSuspended === true) return addDays(now, 30);
  const warningTargets = WARNING_DAYS
    .map((days) => new Date(end.getTime() - days * DAY_MS))
    .filter((date) => date > now)
    .sort((left, right) => left - right);
  return (warningTargets[0] || end).toISOString();
}

function baseSubscription({ dealershipId, dealership = {}, trialStartDate, trialDays = SUBSCRIPTION_PLAN.trialDays }) {
  const startedAt = iso(trialStartDate) || new Date().toISOString();
  const snapshot = subscriptionSnapshot({
    id: dealershipId,
    dealershipId,
    dealershipName: dealership.dealershipName || dealership.name || "",
    gstin: dealership.gstin || dealership.gstNumber || "",
    billingAddress: dealership.address || dealership.fullAddress || "",
    financeDeskEmail: dealership.loginEmail || dealership.email || dealershipId,
    financeDeskMobile: dealership.officialDealershipMobile || dealership.mobile || dealership.ownerMobile || "",
    planName: SUBSCRIPTION_PLAN.name,
    trialStartDate: startedAt,
    trialEndDate: addDays(startedAt, trialDays),
    subscriptionStartDate: null,
    subscriptionEndDate: null,
    paymentStatus: "NOT_PAID",
    adminSuspended: false,
    warningDaysSent: [],
    createdAt: new Date().toISOString(),
  });
  return {
    ...snapshot,
    nextLifecycleCheckAt: nextLifecycleCheckAt(snapshot),
  };
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
    daysRemaining: snapshot.daysRemaining,
    monthlyAmount: snapshot.monthlyAmount,
    gstAmount: snapshot.gstAmount,
    finalAmount: snapshot.finalAmount,
    lastPaymentDate: snapshot.lastPaymentDate || null,
    nextBillingDate: snapshot.nextBillingDate || null,
    paymentStatus: snapshot.paymentStatus || "NOT_PAID",
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
    transaction.set(COLLECTION, id, subscription, { merge: true });
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

export async function getDealershipSubscription(dealershipId, { initialize = true } = {}) {
  const id = cleanId(dealershipId);
  if (!id) return null;
  const existing = await getRecord(COLLECTION, id).catch(() => null);
  if (existing) return subscriptionSnapshot(existing);
  if (!initialize) return null;
  const dealership = await dealershipRecord(id);
  if (!dealership || dealership.approved === false || dealership.active === false) return null;
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
    const error = new Error("Your subscription has expired. Lead creation has been disabled. Please renew your subscription.");
    error.status = 403;
    error.code = "SUBSCRIPTION_EXPIRED";
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

export async function createSubscriptionOrder({ dealershipId, requestedBy }) {
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
  };
}

export function computeRazorpaySignature({ keySecret, orderId, paymentId }) {
  return crypto.createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");
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

export async function verifySubscriptionPayment({
  dealershipId,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
  verifiedBy,
  actor = null,
}) {
  const id = cleanId(dealershipId);
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

  const now = new Date();
  const paidAt = now.toISOString();
  const amounts = subscriptionAmounts();
  const providerPayment = await verifiedRazorpayPayment({
    paymentId: razorpayPaymentId,
    orderId: razorpayOrderId,
    amountPaise: amounts.finalAmount * 100,
  });
  const result = await runRecordTransaction(async (transaction) => {
    const order = await transaction.get("subscriptionOrders", razorpayOrderId);
    const existingPayment = await transaction.get("subscriptionPayments", razorpayPaymentId);
    const current = await transaction.get(COLLECTION, id);
    const counter = await transaction.get("systemCounters", "subscriptionInvoices");
    if (!order || order.dealershipId !== id || Number(order.amountPaise) !== amounts.finalAmount * 100) {
      const error = new Error("Payment order does not match this dealership");
      error.status = 409;
      error.code = "PAYMENT_ORDER_MISMATCH";
      throw error;
    }
    if (order.status === "PAID" && order.paymentId !== razorpayPaymentId) {
      const error = new Error("This payment order has already been used");
      error.status = 409;
      error.code = "PAYMENT_ORDER_ALREADY_USED";
      throw error;
    }
    if (existingPayment?.status === "PAID") {
      return {
        subscription: subscriptionSnapshot(current || {}),
        payment: existingPayment,
        invoice: await transaction.get("subscriptionInvoices", existingPayment.invoiceNumber),
        idempotent: true,
      };
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
      paidAt,
      verifiedAt: paidAt,
      verifiedBy,
      validityStartDate: currentEnd,
      validityEndDate: subscriptionEndDate,
    };
    const invoice = {
      id: number,
      invoiceNumber: number,
      dealershipId: id,
      dealershipName: next.dealershipName || "",
      gstin: next.gstin || "",
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
    };
    transaction.set("systemCounters", "subscriptionInvoices", { value: sequence, updatedAt: paidAt }, { merge: true });
    transaction.set(COLLECTION, id, next, { merge: true });
    transaction.set("subscriptionOrders", razorpayOrderId, {
      status: "PAID",
      paymentId: razorpayPaymentId,
      paidAt,
      updatedAt: paidAt,
    }, { merge: true });
    transaction.set("subscriptionPayments", razorpayPaymentId, payment, { merge: false });
    transaction.set("subscriptionInvoices", number, invoice, { merge: false });
    return { subscription: next, payment, invoice, idempotent: false };
  });

  if (!result.idempotent) {
    await syncSubscriptionSummary(result.subscription);
    publishSubscription(result.subscription, actor, REALTIME_EVENTS.SUBSCRIPTION_RENEWED);
  }
  return result;
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
  await upsertRecord(COLLECTION, id, next);
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
      await upsertRecord(COLLECTION, snapshot.dealershipId, snapshot);
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
