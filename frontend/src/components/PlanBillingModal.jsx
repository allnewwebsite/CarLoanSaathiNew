import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, CreditCard, Download, Loader2, ReceiptIndianRupee, X } from "lucide-react";
import { api, invalidateGetCache } from "../services/api.js";
import { startSubscriptionPayment } from "../services/subscriptionPayment.js";

const HISTORY_PAGE_SIZE = 5;

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
  if (["EXPIRED", "EXPIRING"].includes(status)) return "border-red-200 bg-red-50 text-red-700";
  if (["EXPIRING_SOON", "WARNING"].includes(status)) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function invoiceHtml(invoice) {
  const invoiceNumber = escapeHtml(invoice.invoiceNumber || "CarLoanSaathi Invoice");
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${invoiceNumber}</title>
<style>@page{size:A4;margin:18mm}body{font-family:Arial,sans-serif;color:#111827;max-width:760px;margin:auto}h1{font-size:24px}table{width:100%;border-collapse:collapse;margin-top:24px}td,th{border:1px solid #d1d5db;padding:10px;text-align:left}.total{font-weight:700}@media print{button{display:none}}</style>
</head><body>
<h1>CarLoanSaathi Tax Invoice</h1>
<p><strong>Invoice:</strong> ${invoiceNumber}</p>
<p><strong>Dealership:</strong> ${escapeHtml(invoice.dealershipName || "")}</p>
<p><strong>Billing address:</strong> ${escapeHtml(invoice.billingAddress || "-")}</p>
<table><tr><th>Description</th><th>Amount</th></tr>
<tr><td>${escapeHtml(invoice.planName || "CarLoanSaathi Professional")}</td><td>${money(invoice.monthlyAmount)}</td></tr>
<tr><td>GST (${invoice.gstRate || 18}%)</td><td>${money(invoice.gstAmount)}</td></tr>
<tr class="total"><td>Total paid</td><td>${money(invoice.finalAmount)}</td></tr></table>
<p><strong>Payment ID:</strong> ${escapeHtml(invoice.paymentId || invoice.razorpayPaymentId || "-")}</p>
<p><strong>Payment date:</strong> ${dateValue(invoice.paymentDate)}</p>
<p><strong>Validity:</strong> ${dateValue(invoice.validityStartDate)} to ${dateValue(invoice.validityEndDate)}</p>
<hr style="margin-top:28px;border:0;border-top:1px solid #d1d5db">
<p style="font-size:12px;line-height:1.6;color:#4b5563"><strong>Non-refundable subscription:</strong> Subscription fees are non-refundable once payment is captured and subscription access is activated.</p>
</body></html>`;
  return html;
}

function downloadInvoicePdf(invoice) {
  const printWindow = window.open("", "_blank", "width=900,height=760");
  if (!printWindow) return;
  printWindow.opener = null;
  printWindow.document.open();
  printWindow.document.write(invoiceHtml(invoice));
  printWindow.document.close();
  window.setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 150);
}

function HistoryPagination({ page, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-3 py-2">
      <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-600 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
      <span className="text-xs text-slate-500">Page {page} of {pages}</span>
      <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => onChange(page + 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-600 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
    </div>
  );
}

export function PlanBillingModal({ open, onClose, user }) {
  const titleId = useId();
  const closeRef = useRef(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [paymentPage, setPaymentPage] = useState(1);
  const [invoicePage, setInvoicePage] = useState(1);
  const [acceptedNoRefund, setAcceptedNoRefund] = useState(false);

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
    setAcceptedNoRefund(false);
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
      await startSubscriptionPayment({ user });
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
  const invoicesByNumber = useMemo(() => new Map(invoices.map((invoice) => [invoice.invoiceNumber, invoice])), [invoices]);
  const visiblePayments = payments.slice((paymentPage - 1) * HISTORY_PAGE_SIZE, paymentPage * HISTORY_PAGE_SIZE);
  const visibleInvoices = invoices.slice((invoicePage - 1) * HISTORY_PAGE_SIZE, invoicePage * HISTORY_PAGE_SIZE);
  const showRenew = Number(subscription.daysRemaining ?? 0) <= 15;
  const activeTrial = subscription.entitlementType === "TRIAL" && subscription.subscriptionStatus !== "EXPIRED";
  const statusToneValue = activeTrial ? subscription.trialStatus : subscription.subscriptionStatus;
  const nextBillingDate = subscription.nextBillingDate || subscription.entitlementEndDate || subscription.trialEndDate;
  const details = useMemo(() => [
    ["Current Plan", subscription.planName || plan.name],
    ["Subscription Status", subscription.subscriptionStatus],
    ["Trial Status", subscription.trialStatus],
    ["Trial Start Date", dateValue(subscription.trialStartDate)],
    ["Trial End Date", dateValue(subscription.trialEndDate)],
    ["Subscription Start Date", dateValue(subscription.subscriptionStartDate)],
    ["Subscription End Date", dateValue(subscription.subscriptionEndDate)],
    ["Days Remaining", subscription.daysRemaining ?? "-"],
    ["Next Billing Date", dateValue(nextBillingDate)],
    ["Monthly Price", money(subscription.monthlyAmount || plan.monthlyAmount)],
    [`GST (${subscription.gstRate || plan.gstRate || 18}%)`, money(subscription.gstAmount || plan.gstAmount)],
    ["Final Amount", money(subscription.finalAmount || plan.finalAmount)],
  ], [nextBillingDate, plan, subscription]);

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
              <div className={`flex flex-col gap-4 rounded-md border px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${statusTone(statusToneValue)}`}>
                {activeTrial ? (
                  <div>
                    <p className="text-base font-bold">{subscription.trialStatus === "EXPIRING" ? "FREE TRIAL EXPIRING" : subscription.trialStatus === "WARNING" ? "FREE TRIAL WARNING" : "FREE TRIAL ACTIVE"}</p>
                    <p className="mt-1 text-xl font-semibold">{subscription.daysRemaining} {Number(subscription.daysRemaining) === 1 ? "Day" : "Days"} Remaining</p>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                      <span><strong>Trial Ends:</strong> {dateValue(subscription.trialEndDate)}</span>
                      <span><strong>Manual Renewal</strong></span>
                    </div>
                  </div>
                ) : (
                  <div><p className="text-base font-bold">{subscription.subscriptionStatus}</p><p className="mt-1 text-sm">{subscription.daysRemaining} days remaining. Manual renewal.</p></div>
                )}
                {showRenew ? <button type="button" onClick={renew} disabled={renewing || !acceptedNoRefund} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-60">
                  {renewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Renew Subscription
                </button> : null}
              </div>

              <section className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-sm font-semibold text-amber-900">Non-refundable subscription</p>
                <p className="mt-1 text-sm leading-6 text-amber-800">Once payment is captured and subscription access is activated, the subscription fee is non-refundable.</p>
                {showRenew ? (
                  <label className="mt-3 flex items-start gap-2 text-sm font-medium text-amber-950">
                    <input type="checkbox" checked={acceptedNoRefund} onChange={(event) => setAcceptedNoRefund(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-amber-400" />
                    I understand and accept the non-refundable subscription policy.
                  </label>
                ) : null}
              </section>

              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {details.map(([label, value]) => <div key={label} className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3"><dt className="text-xs font-medium uppercase text-slate-500">{label}</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{value || "-"}</dd></div>)}
              </dl>

              <section><h3 className="text-base font-semibold text-slate-900">Plan Benefits</h3><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{BENEFITS.map((benefit) => <div key={benefit} className="flex items-center gap-2 text-sm text-slate-700"><Check className="h-4 w-4 shrink-0 text-emerald-600" />{benefit}</div>)}</div></section>

              <section>
                <h3 className="text-base font-semibold text-slate-900">Payment History</h3>
                <div className="enterprise-table-scroll mt-3 overflow-x-auto rounded-md border border-slate-200">
                  <table className="min-w-[980px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th>Invoice No</th><th>Date</th><th>Amount</th><th>Status</th><th>Payment ID</th><th>Download Invoice</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">{visiblePayments.length ? visiblePayments.map((payment) => {
                      const invoice = invoicesByNumber.get(payment.invoiceNumber);
                      return <tr key={payment.id}><td className="font-medium" title={payment.invoiceNumber}>{payment.invoiceNumber}</td><td>{dateValue(payment.paidAt)}</td><td>{money(payment.finalAmount)}</td><td>{payment.paymentStatus || payment.status}</td><td title={payment.razorpayPaymentId}>{payment.razorpayPaymentId}</td><td><button type="button" disabled={!invoice} onClick={() => downloadInvoicePdf(invoice)} className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 px-2.5 text-xs font-medium text-slate-700 disabled:opacity-40"><Download className="h-3.5 w-3.5" />Invoice</button></td></tr>;
                    }) : <tr><td colSpan="6" className="px-3 py-6 text-center text-slate-500">No payments recorded.</td></tr>}</tbody>
                  </table>
                  <HistoryPagination page={paymentPage} total={payments.length} onChange={setPaymentPage} />
                </div>
              </section>

              <section>
                <h3 className="text-base font-semibold text-slate-900">Invoice History</h3>
                <div className="enterprise-table-scroll mt-3 overflow-x-auto rounded-md border border-slate-200">
                  <table className="min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th>Invoice No</th><th>Invoice Date</th><th>Amount</th><th>GST</th><th>Total</th><th>Download PDF</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">{visibleInvoices.length ? visibleInvoices.map((invoice) => <tr key={invoice.id}><td className="font-medium" title={invoice.invoiceNumber}>{invoice.invoiceNumber}</td><td>{dateValue(invoice.paymentDate)}</td><td>{money(invoice.monthlyAmount)}</td><td>{money(invoice.gstAmount)}</td><td className="font-medium">{money(invoice.finalAmount)}</td><td><button type="button" onClick={() => downloadInvoicePdf(invoice)} className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-300 px-2.5 text-xs font-medium text-slate-700"><Download className="h-3.5 w-3.5" />PDF</button></td></tr>) : <tr><td colSpan="6" className="px-3 py-6 text-center text-slate-500">No invoices available.</td></tr>}</tbody>
                  </table>
                  <HistoryPagination page={invoicePage} total={invoices.length} onChange={setInvoicePage} />
                </div>
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
