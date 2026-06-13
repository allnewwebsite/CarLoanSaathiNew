import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, CreditCard, Download, Loader2, ReceiptIndianRupee, X } from "lucide-react";
import { api, invalidateGetCache } from "../services/api.js";

const BENEFITS = [
  "Unlimited Leads",
  "Unlimited Salespersons",
  "1 GM Account",
  "Finance Desk Access",
  "Bank Workflow",
  "Loan Executive Workflow",
  "WhatsApp Notifications",
  "Real-time Tracking",
  "Lead Timeline",
  "Analytics Dashboard",
  "Document Management",
  "Reassignment Workflow",
  "Future Platform Updates",
];

function dateValue(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function money(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function statusTone(status) {
  if (status === "EXPIRED") return "border-red-200 bg-red-50 text-red-700";
  if (status === "EXPIRING_SOON") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function loadRazorpayCheckout() {
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

function downloadInvoice(invoice) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${invoice.invoiceNumber}</title>
<style>body{font-family:Arial,sans-serif;color:#111827;padding:40px;max-width:760px;margin:auto}h1{font-size:24px}table{width:100%;border-collapse:collapse;margin-top:24px}td,th{border:1px solid #d1d5db;padding:10px;text-align:left}.total{font-weight:700}</style>
</head><body>
<h1>CarLoanSaathi Tax Invoice</h1>
<p><strong>Invoice:</strong> ${invoice.invoiceNumber || ""}</p>
<p><strong>Dealership:</strong> ${invoice.dealershipName || ""}</p>
<p><strong>GSTIN:</strong> ${invoice.gstin || "-"}</p>
<p><strong>Billing address:</strong> ${invoice.billingAddress || "-"}</p>
<table><tr><th>Description</th><th>Amount</th></tr>
<tr><td>${invoice.planName || "CarLoanSaathi Professional"}</td><td>${money(invoice.monthlyAmount)}</td></tr>
<tr><td>GST (${invoice.gstRate || 18}%)</td><td>${money(invoice.gstAmount)}</td></tr>
<tr class="total"><td>Total paid</td><td>${money(invoice.finalAmount)}</td></tr></table>
<p><strong>Payment ID:</strong> ${invoice.paymentId || invoice.razorpayPaymentId || "-"}</p>
<p><strong>Payment date:</strong> ${dateValue(invoice.paymentDate)}</p>
<p><strong>Validity:</strong> ${dateValue(invoice.validityStartDate)} to ${dateValue(invoice.validityEndDate)}</p>
</body></html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${invoice.invoiceNumber || "CarLoanSaathi-Invoice"}.html`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function PlanBillingModal({ open, onClose, user }) {
  const titleId = useId();
  const closeRef = useRef(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      invalidateGetCache({ prefix: "/dealer/billing", purge: true });
      const response = await api.get("/dealer/billing");
      setData(response.data || null);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load billing information.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    load();
    const previousFocus = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    const onMutation = (event) => {
      if (event.detail?.kind === "subscription") load();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("cls:data-mutated", onMutation);
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("cls:data-mutated", onMutation);
      previousFocus?.focus?.();
    };
  }, [load, onClose, open]);

  const renew = async () => {
    setRenewing(true);
    setError("");
    setMessage("");
    try {
      const available = await loadRazorpayCheckout();
      if (!available) throw new Error("Razorpay Checkout could not be loaded.");
      const orderResponse = await api.post("/dealer/billing/order");
      const order = orderResponse.data;
      await new Promise((resolve, reject) => {
        const checkout = new window.Razorpay({
          key: order.keyId,
          amount: order.amountPaise,
          currency: order.currency,
          name: "CarLoanSaathi",
          description: order.planName,
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
              await api.post("/dealer/billing/verify", {
                razorpayOrderId: payment.razorpay_order_id,
                razorpayPaymentId: payment.razorpay_payment_id,
                razorpaySignature: payment.razorpay_signature,
              });
              resolve();
            } catch (verificationError) {
              reject(verificationError);
            }
          },
        });
        checkout.on("payment.failed", (failure) => reject(new Error(failure.error?.description || "Payment failed.")));
        checkout.open();
      });
      invalidateGetCache({ prefix: "/dealer/billing", purge: true });
      setMessage("Payment verified. Subscription renewed successfully.");
      await load();
    } catch (renewalError) {
      setError(renewalError.response?.data?.message || renewalError.message || "Unable to renew subscription.");
    } finally {
      setRenewing(false);
    }
  };

  const subscription = data?.subscription || {};
  const plan = data?.plan || {};
  const payments = data?.history?.payments || [];
  const invoices = data?.history?.invoices || [];
  const details = useMemo(() => [
    ["Current Plan", subscription.planName || plan.name],
    ["Subscription Status", subscription.subscriptionStatus],
    ["Trial Status", subscription.trialStatus],
    ["Trial Start Date", dateValue(subscription.trialStartDate)],
    ["Trial End Date", dateValue(subscription.trialEndDate)],
    ["Subscription Start Date", dateValue(subscription.subscriptionStartDate)],
    ["Subscription End Date", dateValue(subscription.subscriptionEndDate)],
    ["Days Remaining", subscription.daysRemaining ?? "-"],
    ["Monthly Price", money(subscription.monthlyAmount || plan.monthlyAmount)],
    [`GST (${subscription.gstRate || plan.gstRate || 18}%)`, money(subscription.gstAmount || plan.gstAmount)],
    ["Final Amount", money(subscription.finalAmount || plan.finalAmount)],
  ], [plan, subscription]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 p-3 sm:p-5" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !renewing) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[#0d47a1] text-white"><ReceiptIndianRupee className="h-5 w-5" /></span>
            <div><h2 id={titleId} className="text-lg font-semibold text-slate-950">Plan & Billing</h2><p className="text-sm text-slate-500">CarLoanSaathi Professional</p></div>
          </div>
          <button ref={closeRef} type="button" disabled={renewing} onClick={onClose} aria-label="Close billing" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-600 disabled:opacity-50"><X className="h-4 w-4" /></button>
        </header>

        <div className="overflow-y-auto p-5">
          {loading && !data ? <div className="flex min-h-52 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[#0d47a1]" /></div> : null}
          {error ? <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p> : null}
          {message ? <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{message}</p> : null}
          {data ? (
            <div className="space-y-6">
              <div className={`flex flex-col gap-3 rounded-md border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${statusTone(subscription.subscriptionStatus)}`}>
                <div><p className="text-sm font-semibold">{subscription.subscriptionStatus}</p><p className="mt-0.5 text-sm">{subscription.daysRemaining} day(s) remaining. Renewal is manual.</p></div>
                <button type="button" onClick={renew} disabled={renewing} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-60">
                  {renewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Renew Subscription
                </button>
              </div>

              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {details.map(([label, value]) => <div key={label} className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"><dt className="text-xs font-medium uppercase text-slate-500">{label}</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{value || "-"}</dd></div>)}
              </dl>

              <section><h3 className="text-base font-semibold text-slate-900">Plan Benefits</h3><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{BENEFITS.map((benefit) => <div key={benefit} className="flex items-center gap-2 text-sm text-slate-700"><Check className="h-4 w-4 shrink-0 text-emerald-600" />{benefit}</div>)}</div></section>

              <section>
                <h3 className="text-base font-semibold text-slate-900">Payment History</h3>
                <div className="mt-3 overflow-x-auto rounded-md border border-slate-200">
                  <table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Amount</th><th className="px-3 py-2">GST</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Payment ID</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">{payments.length ? payments.map((payment) => <tr key={payment.id}><td className="px-3 py-2 font-medium">{payment.invoiceNumber}</td><td className="px-3 py-2">{dateValue(payment.paidAt)}</td><td className="px-3 py-2">{money(payment.finalAmount)}</td><td className="px-3 py-2">{money(payment.gstAmount)}</td><td className="px-3 py-2">{payment.paymentStatus || payment.status}</td><td className="px-3 py-2">{payment.razorpayPaymentId}</td></tr>) : <tr><td colSpan="6" className="px-3 py-6 text-center text-slate-500">No payments recorded.</td></tr>}</tbody>
                  </table>
                </div>
              </section>

              <section>
                <h3 className="text-base font-semibold text-slate-900">Invoice History</h3>
                <div className="mt-3 space-y-2">{invoices.length ? invoices.map((invoice) => <div key={invoice.id} className="flex flex-col gap-2 rounded-md border border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-slate-900">{invoice.invoiceNumber}</p><p className="text-sm text-slate-500">{dateValue(invoice.paymentDate)} | {money(invoice.finalAmount)} | Valid until {dateValue(invoice.validityEndDate)}</p></div><button type="button" onClick={() => downloadInvoice(invoice)} className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700"><Download className="h-4 w-4" />Download</button></div>) : <p className="rounded-md border border-slate-200 px-4 py-5 text-center text-sm text-slate-500">No invoices available.</p>}</div>
              </section>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function SubscriptionBanner({ user }) {
  const [subscription, setSubscription] = useState(null);

  const load = useCallback(async () => {
    if (user?.role !== "finance-desk") return;
    try {
      const response = await api.get("/dealer/billing");
      setSubscription(response.data?.subscription || null);
    } catch {
      // Billing status is also enforced by the backend during lead creation.
    }
  }, [user?.role]);

  useEffect(() => {
    if (user?.role !== "finance-desk") return undefined;
    load();
    const onMutation = (event) => {
      if (event.detail?.kind === "subscription") load();
    };
    window.addEventListener("cls:data-mutated", onMutation);
    return () => window.removeEventListener("cls:data-mutated", onMutation);
  }, [load, user?.role]);

  if (!subscription || !["EXPIRING_SOON", "EXPIRED"].includes(subscription.subscriptionStatus)) return null;
  return (
    <div className={`mb-4 rounded-md border px-4 py-3 text-sm ${statusTone(subscription.subscriptionStatus)}`}>
      <p className="font-semibold">{subscription.subscriptionStatus === "EXPIRED" ? "Subscription expired" : "Subscription expiring soon"}</p>
      <p className="mt-1">{subscription.subscriptionStatus === "EXPIRED" ? "New lead creation is disabled. Existing cases and all other features remain available." : `${subscription.daysRemaining} day(s) remaining. Renew from Plan & Billing.`}</p>
    </div>
  );
}
