import { api, invalidateGetCache } from "./api.js";

export function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const existing = document.querySelector('script[data-cls-razorpay="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(true), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.clsRazorpay = "true";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export async function startSubscriptionPayment({ user }) {
  const available = await loadRazorpayCheckout();
  if (!available) throw new Error("Razorpay Checkout could not be loaded.");
  const orderResponse = await api.post("/dealer/billing/order", { refundPolicyAccepted: true });
  const order = orderResponse.data;
  await new Promise((resolve, reject) => {
    const checkout = new window.Razorpay({
      key: order.keyId,
      amount: order.amountPaise,
      currency: order.currency,
      name: "CarLoanSaathi",
      description: `${order.planName} - 30-day non-refundable subscription`,
      order_id: order.orderId,
      prefill: {
        name: order.dealershipName || "",
        email: order.financeDeskEmail || user?.email || "",
        contact: String(order.financeDeskMobile || "").replace(/\D/g, "").slice(-10),
      },
      theme: { color: "#0d47a1" },
      modal: { ondismiss: () => reject(new Error("Payment cancelled.")) },
      handler: async (payment) => {
        try {
          const response = await api.post("/dealer/billing/verify", {
            razorpayOrderId: payment.razorpay_order_id,
            razorpayPaymentId: payment.razorpay_payment_id,
            razorpaySignature: payment.razorpay_signature,
          });
          resolve(response.data);
        } catch (verificationError) {
          reject(verificationError);
        }
      },
    });
    checkout.on("payment.failed", (failure) => reject(new Error(failure.error?.description || "Payment failed.")));
    checkout.open();
  });
  invalidateGetCache({ prefix: "/dealer/billing", purge: true });
}
