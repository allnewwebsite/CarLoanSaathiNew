import { sendWhatsApp } from "../services/whatsapp.service.js";

function normalizePhone(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}

export async function testWhatsApp(req, res, next) {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
        deliveryStatus: "missing-phone",
      });
    }

    const result = await sendWhatsApp({
      to: phone,
      eventType: "WHATSAPP_TEST",
      message: "🚗 CarLoanSaathi Test\n\nWhatsApp integration is working successfully.",
      metadata: {
        recipient: "admin-test",
        recipientRole: "super-admin",
        recipientId: req.user?.email || req.user?.uid || null,
      },
    });

    res.json({
      success: Boolean(result.ok),
      messageSid: result.messageSid || null,
      deliveryStatus: result.status,
      error: result.error || null,
      deliveryResult: result.deliveryResult || null,
    });
  } catch (error) {
    next(error);
  }
}
