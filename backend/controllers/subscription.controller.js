import {
  activateTrialManually,
  billingHistory,
  createSubscriptionOrder,
  extendSubscriptionManually,
  getBillingOverview,
  getDealershipSubscription,
  suspendSubscription,
  verifySubscriptionPayment,
} from "../services/subscription.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "../services/audit.service.js";

function dealershipIdFromUser(req) {
  return String(req.user?.dealershipId || req.user?.email || "").trim().toLowerCase();
}

function required(value, label) {
  const result = String(value || "").trim();
  if (!result) {
    const error = new Error(`${label} is required`);
    error.status = 400;
    throw error;
  }
  return result;
}

export async function getFinanceBilling(req, res, next) {
  try {
    res.set("Cache-Control", "private, no-store").json(await getBillingOverview(dealershipIdFromUser(req)));
  } catch (error) {
    next(error);
  }
}

export async function createFinanceSubscriptionOrder(req, res, next) {
  try {
    const order = await createSubscriptionOrder({
      dealershipId: dealershipIdFromUser(req),
      requestedBy: req.user?.email || req.user?.uid,
    });
    await writeAuditLog({
      req,
      actionType: AUDIT_ACTIONS.SUBSCRIPTION_ORDER_CREATED,
      targetEntity: "subscription",
      targetId: dealershipIdFromUser(req),
      meta: { dealershipId: dealershipIdFromUser(req), orderId: order.orderId, amount: order.amount },
    });
    res.status(201).json(order);
  } catch (error) {
    next(error);
  }
}

export async function verifyFinanceSubscriptionPayment(req, res, next) {
  try {
    const result = await verifySubscriptionPayment({
      dealershipId: dealershipIdFromUser(req),
      razorpayOrderId: required(req.body.razorpayOrderId, "Razorpay order ID"),
      razorpayPaymentId: required(req.body.razorpayPaymentId, "Razorpay payment ID"),
      razorpaySignature: required(req.body.razorpaySignature, "Razorpay signature"),
      verifiedBy: req.user?.email || req.user?.uid,
      actor: req.user,
    });
    await Promise.all([
      writeAuditLog({
        req,
        actionType: AUDIT_ACTIONS.PAYMENT_RECEIVED,
        targetEntity: "subscriptionPayment",
        targetId: result.payment.id,
        newValue: { status: "PAID", invoiceNumber: result.invoice?.invoiceNumber },
        meta: { dealershipId: dealershipIdFromUser(req), paymentId: result.payment.id },
      }),
      writeAuditLog({
        req,
        actionType: AUDIT_ACTIONS.SUBSCRIPTION_RENEWED,
        targetEntity: "subscription",
        targetId: dealershipIdFromUser(req),
        newValue: {
          subscriptionEndDate: result.subscription.subscriptionEndDate,
          status: result.subscription.subscriptionStatus,
        },
        meta: { dealershipId: dealershipIdFromUser(req), invoiceNumber: result.invoice?.invoiceNumber },
      }),
    ]);
    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function getFinanceBillingHistory(req, res, next) {
  try {
    res.json(await billingHistory(dealershipIdFromUser(req), {
      limit: req.query.limit || 25,
      cursor: req.query.cursor || null,
    }));
  } catch (error) {
    next(error);
  }
}

export async function getAdminSubscription(req, res, next) {
  try {
    const dealershipId = decodeURIComponent(req.params.dealershipId || "").trim().toLowerCase();
    const subscription = await getDealershipSubscription(dealershipId);
    if (!subscription) return res.status(404).json({ message: "Subscription not found" });
    res.json({
      subscription,
      history: await billingHistory(dealershipId, { limit: req.query.limit || 25 }),
    });
  } catch (error) {
    next(error);
  }
}

export async function extendAdminSubscription(req, res, next) {
  try {
    const dealershipId = decodeURIComponent(req.params.dealershipId || "");
    const subscription = await extendSubscriptionManually({
      dealershipId,
      days: req.body.days,
      reason: required(req.body.reason, "Reason"),
      actor: req.user,
    });
    await writeAuditLog({
      req,
      actionType: AUDIT_ACTIONS.SUBSCRIPTION_MANUAL_EXTENSION,
      targetEntity: "subscription",
      targetId: dealershipId,
      newValue: { subscriptionEndDate: subscription.subscriptionEndDate, days: Number(req.body.days) },
      meta: { dealershipId, reason: req.body.reason },
    });
    res.json({ message: "Subscription extended", subscription });
  } catch (error) {
    next(error);
  }
}

export async function activateAdminTrial(req, res, next) {
  try {
    const dealershipId = decodeURIComponent(req.params.dealershipId || "");
    const subscription = await activateTrialManually({
      dealershipId,
      days: req.body.days || 60,
      reason: required(req.body.reason, "Reason"),
      actor: req.user,
    });
    await writeAuditLog({
      req,
      actionType: AUDIT_ACTIONS.SUBSCRIPTION_TRIAL_ACTIVATED,
      targetEntity: "subscription",
      targetId: dealershipId,
      newValue: { trialStartDate: subscription.trialStartDate, trialEndDate: subscription.trialEndDate },
      meta: { dealershipId, reason: req.body.reason },
    });
    res.json({ message: "Trial activated", subscription });
  } catch (error) {
    next(error);
  }
}

export async function suspendAdminSubscription(req, res, next) {
  try {
    const dealershipId = decodeURIComponent(req.params.dealershipId || "");
    const subscription = await suspendSubscription({
      dealershipId,
      reason: required(req.body.reason, "Reason"),
      actor: req.user,
    });
    await writeAuditLog({
      req,
      actionType: AUDIT_ACTIONS.SUBSCRIPTION_ADMIN_OVERRIDE,
      targetEntity: "subscription",
      targetId: dealershipId,
      oldValue: "ACTIVE",
      newValue: "EXPIRED",
      meta: { dealershipId, reason: req.body.reason },
    });
    res.json({ message: "Subscription suspended", subscription });
  } catch (error) {
    next(error);
  }
}
