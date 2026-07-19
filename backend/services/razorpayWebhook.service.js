import crypto from "node:crypto";
import { getRecord, upsertRecord } from "./firestore.service.js";
import {
  computeRazorpayWebhookSignature,
  finalizeSubscriptionPayment,
} from "./subscription.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "./audit.service.js";
import { createNotification } from "./notification.service.js";
import {
  ALERT_SEVERITY,
  emitOperationalAlert,
  recordOperationalEvent,
} from "./observability.service.js";

const EVENT_COLLECTION = "razorpayWebhookEvents";
const HEALTH_COLLECTION = "razorpayWebhookHealth";
const HEALTH_ID = "current";

function webhookSecret() {
  const secret = String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    const error = new Error("Razorpay webhook is not configured");
    error.status = 503;
    error.code = "RAZORPAY_WEBHOOK_NOT_CONFIGURED";
    throw error;
  }
  return secret;
}

function safeEqual(expected, provided) {
  const left = Buffer.from(expected);
  const right = Buffer.from(String(provided || "").trim());
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function deliveryId(rawBody, headerValue) {
  return String(headerValue || "").trim()
    || `body_${crypto.createHash("sha256").update(rawBody).digest("hex")}`;
}

async function updateHealth(patch) {
  const now = new Date().toISOString();
  await upsertRecord(HEALTH_COLLECTION, HEALTH_ID, {
    provider: "razorpay",
    webhookPath: "/api/webhooks/razorpay",
    configured: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
    ...patch,
    updatedAt: now,
  }).catch(() => null);
}

async function recordInvalidSignature(eventId, req) {
  const now = new Date();
  const existing = await getRecord(HEALTH_COLLECTION, HEALTH_ID).catch(() => null);
  const windowStartedAt = existing?.signatureFailureWindowStartedAt
    ? new Date(existing.signatureFailureWindowStartedAt)
    : now;
  const inWindow = now.getTime() - windowStartedAt.getTime() <= 15 * 60 * 1000;
  const count = inWindow ? Number(existing?.signatureFailureCount || 0) + 1 : 1;
  await updateHealth({
    status: "degraded",
    lastReceivedAt: now.toISOString(),
    lastFailureAt: now.toISOString(),
    lastFailureReason: "INVALID_SIGNATURE",
    lastEventId: eventId,
    signatureFailureCount: count,
    signatureFailureWindowStartedAt: inWindow ? windowStartedAt.toISOString() : now.toISOString(),
  });
  if (count >= Number(process.env.RAZORPAY_SIGNATURE_FAILURE_ALERT_THRESHOLD || 3)) {
    await emitOperationalAlert({
      type: "razorpay_webhook_signature_failures",
      severity: ALERT_SEVERITY.HIGH,
      component: "billing",
      title: "Repeated Razorpay webhook signature failures",
      message: `${count} invalid Razorpay webhook signatures were received within 15 minutes`,
      entityId: "razorpay-webhook-signature",
      requestId: req?.requestId,
      meta: { count, eventId },
    });
  }
}

async function auditWebhook({ req, actionType, eventId, eventType, orderId, paymentId, dealershipId, status }) {
  await writeAuditLog({
    req,
    actorId: "razorpay-webhook",
    actorRole: "system",
    actionType,
    targetEntity: "razorpayWebhook",
    targetId: eventId,
    newValue: { status },
    meta: {
      eventId,
      eventType,
      orderId,
      paymentId,
      dealershipId,
      sourcePortal: "razorpay-webhook",
    },
  });
}

export async function processRazorpayWebhook({
  rawBody,
  signature,
  eventId: eventIdHeader,
  req = null,
}) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || "");
  const eventId = deliveryId(body, eventIdHeader);
  const expected = computeRazorpayWebhookSignature({
    webhookSecret: webhookSecret(),
    rawBody: body,
  });
  if (!safeEqual(expected, signature)) {
    await Promise.all([
      upsertRecord(EVENT_COLLECTION, eventId, {
        eventId,
        status: "REJECTED",
        reason: "INVALID_SIGNATURE",
        receivedAt: new Date().toISOString(),
      }).catch(() => null),
      recordInvalidSignature(eventId, req),
      auditWebhook({
        req,
        actionType: AUDIT_ACTIONS.RAZORPAY_WEBHOOK_REJECTED,
        eventId,
        eventType: "unknown",
        status: "REJECTED",
      }).catch(() => null),
    ]);
    const error = new Error("Invalid Razorpay webhook signature");
    error.status = 400;
    error.code = "INVALID_WEBHOOK_SIGNATURE";
    throw error;
  }

  let event;
  try {
    event = JSON.parse(body.toString("utf8"));
  } catch {
    const error = new Error("Razorpay webhook body must be valid JSON");
    error.status = 400;
    error.code = "INVALID_WEBHOOK_BODY";
    throw error;
  }

  const eventType = String(event?.event || "");
  const payment = event?.payload?.payment?.entity || {};
  const refund = event?.payload?.refund?.entity || {};
  const orderId = String(payment.order_id || "");
  const paymentId = String(payment.id || "");
  const existingEvent = await getRecord(EVENT_COLLECTION, eventId).catch(() => null);
  await upsertRecord(EVENT_COLLECTION, eventId, {
    eventId,
    eventType,
    orderId: orderId || null,
    paymentId: paymentId || null,
    status: "RECEIVED",
    receivedAt: existingEvent?.receivedAt || new Date().toISOString(),
    lastReceivedAt: new Date().toISOString(),
  });
  if (!existingEvent) {
    await auditWebhook({
      req,
      actionType: AUDIT_ACTIONS.RAZORPAY_WEBHOOK_RECEIVED,
      eventId,
      eventType,
      orderId,
      paymentId,
      status: "RECEIVED",
    });
  }

  if (["refund.processed", "refund.created"].includes(eventType)) {
    const refundId = String(refund.id || "");
    const refundedPaymentId = String(refund.payment_id || "");
    if (!refundId || !refundedPaymentId) {
      const error = new Error("Refund webhook is missing refund or payment ID");
      error.status = 400;
      error.code = "WEBHOOK_REFUND_ID_MISSING";
      throw error;
    }
    const originalPayment = await getRecord("subscriptionPayments", refundedPaymentId).catch(() => null);
    const processedAt = new Date().toISOString();
    await Promise.all([
      upsertRecord("subscriptionRefunds", refundId, {
        refundId,
        paymentId: refundedPaymentId,
        orderId: originalPayment?.razorpayOrderId || null,
        dealershipId: originalPayment?.dealershipId || null,
        amountPaise: Number(refund.amount || 0),
        currency: String(refund.currency || originalPayment?.currency || "").toUpperCase(),
        status: String(refund.status || eventType.split(".")[1] || "unknown").toUpperCase(),
        providerCreatedAt: refund.created_at || null,
        eventId,
        processedAt,
        entitlementAdjustmentStatus: "ADMIN_REVIEW_REQUIRED",
      }),
      upsertRecord(EVENT_COLLECTION, eventId, { status: "PROCESSED", processedAt }),
      updateHealth({ status: "degraded", lastReceivedAt: processedAt, lastEventId: eventId, lastEventType: eventType }),
      emitOperationalAlert({
        type: "subscription_refund_requires_review",
        severity: ALERT_SEVERITY.HIGH,
        component: "billing",
        title: "Subscription refund requires review",
        message: "Razorpay reported a refund. Automatic entitlement changes are blocked pending financial review.",
        entityId: refundId,
        requestId: req?.requestId,
        meta: { paymentId: refundedPaymentId, dealershipId: originalPayment?.dealershipId || null, amountPaise: Number(refund.amount || 0) },
      }),
    ]);
    return { accepted: true, ignored: false, refunded: true, entitlementAdjusted: false, eventId, eventType, refundId };
  }

  if (eventType === "payment.failed") {
    const order = orderId ? await getRecord("subscriptionOrders", orderId).catch(() => null) : null;
    const failedAt = new Date().toISOString();
    await Promise.allSettled([
      upsertRecord("subscriptionPaymentFailures", paymentId || eventId, {
        eventId,
        orderId: orderId || null,
        paymentId: paymentId || null,
        dealershipId: order?.dealershipId || null,
        status: "FAILED",
        providerStatus: payment.status || "failed",
        providerErrorCode: payment.error_code || null,
        providerErrorReason: payment.error_reason || null,
        amountPaise: Number(payment.amount || order?.amountPaise || 0),
        currency: String(payment.currency || order?.currency || "").toUpperCase(),
        failedAt,
      }),
      upsertRecord(EVENT_COLLECTION, eventId, { status: "PROCESSED", processedAt: failedAt }),
      order ? upsertRecord("subscriptionOrders", order.id, {
        lastFailedPaymentId: paymentId || null,
        lastPaymentFailureAt: failedAt,
        lastPaymentFailureCode: payment.error_code || null,
      }) : null,
      order ? createNotification({
        type: "subscription-payment-failed",
        title: "Subscription payment failed",
        message: "Your payment was not completed and no subscription was activated. You can try again safely.",
        recipientRole: "finance-desk",
        recipientId: order.requestedBy || order.dealershipId,
        dealerEmail: order.dealershipId,
        dealershipId: order.dealershipId,
        priority: "high",
        entityType: "subscriptionPayment",
        entityId: paymentId || eventId,
        meta: { paymentId, orderId, dedupeKey: `subscription-payment-failed-${paymentId || eventId}` },
      }) : null,
      recordOperationalEvent({
        type: "subscription_payment_failed",
        severity: ALERT_SEVERITY.LOW,
        component: "billing",
        message: "Razorpay reported a failed subscription payment; no entitlement was activated",
        entityId: paymentId || eventId,
        requestId: req?.requestId,
        meta: { orderId, paymentId, dealershipId: order?.dealershipId || null, errorCode: payment.error_code || null },
      }),
      updateHealth({
        status: "healthy",
        lastReceivedAt: failedAt,
        lastEventId: eventId,
        lastEventType: eventType,
        lastFailedPaymentAt: failedAt,
        lastFailedPaymentId: paymentId || null,
      }),
    ]);
    return { accepted: true, ignored: false, failed: true, activated: false, eventId, eventType };
  }

  if (eventType !== "payment.captured") {
    await upsertRecord(EVENT_COLLECTION, eventId, {
      status: "IGNORED",
      ignoredAt: new Date().toISOString(),
    });
    await updateHealth({
      status: "healthy",
      lastReceivedAt: new Date().toISOString(),
      lastEventId: eventId,
      lastEventType: eventType,
    });
    return { accepted: true, ignored: true, eventId, eventType };
  }
  if (!orderId || !paymentId) {
    const error = new Error("Captured payment webhook is missing payment or order ID");
    error.status = 400;
    error.code = "WEBHOOK_PAYMENT_ID_MISSING";
    throw error;
  }

  const order = await getRecord("subscriptionOrders", orderId);
  if (!order) {
    const error = new Error("Subscription order not found for captured payment");
    error.status = 404;
    error.code = "SUBSCRIPTION_ORDER_NOT_FOUND";
    throw error;
  }
  const result = await finalizeSubscriptionPayment({
    dealershipId: order.dealershipId,
    razorpayOrderId: orderId,
    razorpayPaymentId: paymentId,
    verifiedBy: "razorpay-webhook",
    providerPayment: payment,
    verificationSource: "webhook",
    actor: { role: "system", email: "razorpay-webhook" },
  });
  await Promise.all([
    upsertRecord(EVENT_COLLECTION, eventId, {
      dealershipId: order.dealershipId,
      status: result.idempotent ? "ALREADY_PROCESSED" : "PROCESSED",
      idempotent: result.idempotent,
      invoiceNumber: result.invoice?.invoiceNumber || null,
      processedAt: new Date().toISOString(),
    }),
    updateHealth({
      status: "healthy",
      lastReceivedAt: new Date().toISOString(),
      lastSuccessAt: new Date().toISOString(),
      lastFailureReason: null,
      lastEventId: eventId,
      lastEventType: eventType,
      lastPaymentId: paymentId,
      lastOrderId: orderId,
      signatureFailureCount: 0,
      signatureFailureWindowStartedAt: null,
    }),
    recordOperationalEvent({
      type: "razorpay_webhook_processed",
      component: "billing",
      message: result.idempotent ? "Razorpay webhook was already applied" : "Razorpay webhook renewed subscription",
      entityId: eventId,
      requestId: req?.requestId,
      meta: { orderId, paymentId, dealershipId: order.dealershipId, idempotent: result.idempotent },
    }),
  ]);
  if (!existingEvent?.processedAt) {
    await auditWebhook({
      req,
      actionType: AUDIT_ACTIONS.RAZORPAY_WEBHOOK_PROCESSED,
      eventId,
      eventType,
      orderId,
      paymentId,
      dealershipId: order.dealershipId,
      status: result.idempotent ? "ALREADY_PROCESSED" : "PROCESSED",
    });
  }
  return { accepted: true, ignored: false, eventId, eventType, ...result };
}

export async function recordRazorpayWebhookFailure({ eventId, error, req = null }) {
  const now = new Date().toISOString();
  await Promise.all([
    eventId ? upsertRecord(EVENT_COLLECTION, eventId, {
      status: "FAILED",
      failureCode: error.code || "WEBHOOK_PROCESSING_FAILED",
      failureMessage: String(error.message || "Webhook processing failed").slice(0, 300),
      failedAt: now,
    }).catch(() => null) : null,
    updateHealth({
      status: "degraded",
      lastReceivedAt: now,
      lastFailureAt: now,
      lastFailureReason: error.code || error.message,
      lastEventId: eventId || null,
    }),
    recordOperationalEvent({
      type: "razorpay_webhook_failed",
      severity: ALERT_SEVERITY.HIGH,
      component: "billing",
      message: "Razorpay webhook processing failed",
      entityId: eventId,
      requestId: req?.requestId,
      meta: { code: error.code || null, message: error.message },
    }),
    emitOperationalAlert({
      type: "razorpay_webhook_failure",
      severity: ALERT_SEVERITY.HIGH,
      component: "billing",
      title: "Razorpay webhook failure",
      message: error.message,
      entityId: eventId || "razorpay",
      requestId: req?.requestId,
      meta: { code: error.code || null },
    }),
  ]);
}

export async function razorpayWebhookHealth() {
  const state = await getRecord(HEALTH_COLLECTION, HEALTH_ID).catch(() => null);
  const enabled = process.env.ENABLE_SUBSCRIPTION_BILLING === "true";
  const configured = enabled && Boolean(process.env.RAZORPAY_WEBHOOK_SECRET);
  return {
    status: !enabled ? "disabled" : !configured ? "degraded" : state?.status || "waiting",
    enabled,
    configured,
    webhookPath: "/api/webhooks/razorpay",
    lastReceivedAt: state?.lastReceivedAt || null,
    lastSuccessAt: state?.lastSuccessAt || null,
    lastFailureAt: state?.lastFailureAt || null,
    lastFailureReason: state?.lastFailureReason || null,
    lastEventId: state?.lastEventId || null,
    signatureFailureCount: Number(state?.signatureFailureCount || 0),
    lastFailedPaymentAt: state?.lastFailedPaymentAt || null,
    lastFailedPaymentId: state?.lastFailedPaymentId || null,
  };
}
