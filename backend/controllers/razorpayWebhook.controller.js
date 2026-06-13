import crypto from "node:crypto";
import {
  processRazorpayWebhook,
  recordRazorpayWebhookFailure,
} from "../services/razorpayWebhook.service.js";

export async function handleRazorpayWebhook(req, res, next) {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
  const eventId = String(req.headers["x-razorpay-event-id"] || "").trim()
    || `body_${crypto.createHash("sha256").update(rawBody).digest("hex")}`;
  try {
    const result = await processRazorpayWebhook({
      rawBody,
      signature: req.headers["x-razorpay-signature"],
      eventId,
      req,
    });
    return res.status(200).json({
      received: true,
      eventId: result.eventId,
      status: result.ignored ? "ignored" : result.idempotent ? "already-processed" : "processed",
    });
  } catch (error) {
    if (error.code !== "INVALID_WEBHOOK_SIGNATURE") {
      await recordRazorpayWebhookFailure({ eventId, error, req }).catch(() => null);
    }
    return next(error);
  }
}
