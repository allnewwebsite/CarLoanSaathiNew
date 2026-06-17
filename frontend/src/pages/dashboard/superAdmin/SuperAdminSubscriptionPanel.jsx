import { useCallback, useEffect, useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { OperationalTable } from "../../../components/OperationalTable.jsx";
import { api, invalidateGetCache } from "../../../services/api.js";

const pageSize = 10;
const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

function display(value) {
  return value || "-";
}

function billingDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function DataTable({ title, headers, rows, loading }) {
  return <OperationalTable title={title} headers={headers} rows={rows} loading={loading} pageSize={pageSize} />;
}

export function AdminSubscriptionPanel({ dealershipId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [days, setDays] = useState("30");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!dealershipId) return;
    setLoading(true);
    try {
      const endpoint = `/admin/subscriptions/${encodeURIComponent(dealershipId)}`;
      invalidateGetCache({ prefix: endpoint, purge: true });
      const response = await api.get(endpoint);
      setData(response.data || null);
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load subscription.");
    } finally {
      setLoading(false);
    }
  }, [dealershipId]);

  useEffect(() => {
    load();
    const onMutation = (event) => {
      if (event.detail?.kind === "subscription") load();
    };
    window.addEventListener("cls:data-mutated", onMutation);
    return () => window.removeEventListener("cls:data-mutated", onMutation);
  }, [load]);

  const act = async (action) => {
    if (!reason.trim()) {
      setError("Reason is required for subscription overrides.");
      return;
    }
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const body = action === "suspend" ? { reason } : { reason, days: Number(days) };
      const response = await api.post(`/admin/subscriptions/${encodeURIComponent(dealershipId)}/${action}`, body);
      setMessage(response.data?.message || "Subscription updated.");
      setReason("");
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to update subscription.");
    } finally {
      setBusy("");
    }
  };

  if (loading && !data) return <section className="rounded-lg border border-slate-200 bg-white p-5"><Loader2 className="h-5 w-5 animate-spin text-[#0d47a1]" /></section>;
  const subscription = data?.subscription || {};
  const payments = data?.history?.payments || [];
  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-3"><CreditCard className="h-5 w-5 text-[#0d47a1]" /><div><h2 className="text-base font-semibold text-slate-900">Subscription Administration</h2><p className="text-sm text-slate-500">Manual controls and payment history</p></div></div>
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
      {message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{message}</p> : null}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Plan", subscription.planName],
          ["Status", subscription.subscriptionStatus],
          ["Trial End", billingDate(subscription.trialEndDate)],
          ["Subscription End", billingDate(subscription.subscriptionEndDate)],
          ["Days Remaining", subscription.daysRemaining],
          ["Payment Status", subscription.paymentStatus],
          ["Last Invoice", subscription.invoiceNumber],
          ["Lead Creation", subscription.leadCreationAllowed ? "Allowed" : "Blocked"],
        ].map(([label, value]) => <div key={label} className="rounded-md bg-slate-50 px-3 py-2"><dt className="text-xs uppercase text-slate-500">{label}</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{display(value)}</dd></div>)}
      </dl>
      <div className="grid gap-3 lg:grid-cols-[140px_1fr_auto_auto_auto]">
        <input type="number" min="1" max="3650" className="field h-10" value={days} onChange={(event) => setDays(event.target.value)} aria-label="Number of days" />
        <input className="field h-10" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required reason for admin override" />
        <button disabled={Boolean(busy)} onClick={() => act("extend")} className="h-10 rounded-md bg-[#0d47a1] px-4 text-sm font-semibold text-white disabled:opacity-50">{busy === "extend" ? "Extending..." : "Extend"}</button>
        <button disabled={Boolean(busy)} onClick={() => act("trial")} className="h-10 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 disabled:opacity-50">{busy === "trial" ? "Activating..." : "Activate Trial"}</button>
        <button disabled={Boolean(busy)} onClick={() => act("suspend")} className="h-10 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-700 disabled:opacity-50">{busy === "suspend" ? "Suspending..." : "Suspend"}</button>
      </div>
      <DataTable title="Subscription Payments" headers={["Invoice", "Date", "Amount", "GST", "Status", "Payment ID"]} rows={payments.map((payment) => ({ key: payment.id, cells: [display(payment.invoiceNumber), billingDate(payment.paidAt), `Rs. ${money.format(Number(payment.finalAmount || 0))}`, `Rs. ${money.format(Number(payment.gstAmount || 0))}`, display(payment.paymentStatus || payment.status), display(payment.razorpayPaymentId)] }))} loading={false} />
    </section>
  );
}
