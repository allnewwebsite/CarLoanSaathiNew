import { CheckCircle2, CreditCard, Loader2, LockKeyhole, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { api, invalidateGetCache } from "../services/api.js";
import { CONVERSION_EVENTS, trackConversionEvent } from "../services/conversionAnalytics.js";
import { startSubscriptionPayment } from "../services/subscriptionPayment.js";

const benefits = [
  "Unlimited Leads",
  "Unlimited Users",
  "Workflow and Document Management",
  "Bank Coordination",
  "Analytics and Activity Tracking",
  "Real-Time Visibility",
];

function money(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

export function SubscriptionActivationPage() {
  const { user, validateSession } = useAuth();
  const [searchParams] = useSearchParams();
  const preview = import.meta.env.DEV ? searchParams.get("preview") : "";
  const [data, setData] = useState(() => preview ? {
    plan: { name: "CarLoanSaathi Professional", monthlyAmount: 15000, gstAmount: 2700, finalAmount: 17700 },
    subscription: { subscriptionStatus: preview === "expired" ? "EXPIRED" : "PAYMENT_PENDING" },
  } : null);
  const [loading, setLoading] = useState(!preview);
  const [paying, setPaying] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (preview || !user) return;
    let active = true;
    api.get("/dealer/billing")
      .then((response) => { if (active) setData(response.data); })
      .catch((requestError) => { if (active) setError(requestError.response?.data?.message || "Unable to load subscription details."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [preview, user]);

  if (!user && !preview) return <Navigate to="/dealer/login" replace />;
  if (user?.dashboardAccessAllowed === true && !preview) return <Navigate to={user.role === "gm" ? "/gm/dashboard" : "/finance/dashboard"} replace />;

  const subscription = data?.subscription || {};
  const plan = data?.plan || {};
  const expired = subscription.subscriptionStatus === "EXPIRED";
  const canPay = preview || user?.role === "finance-desk";

  const pay = async () => {
    setPaying(true);
    setError("");
    try {
      await startSubscriptionPayment({ user });
      invalidateGetCache({ prefix: "/dealer/billing", purge: true });
      const refreshed = await validateSession({ silent: false, showLoading: true });
      trackConversionEvent(CONVERSION_EVENTS.DASHBOARD_ACCESS, "subscription_activation");
      navigate(refreshed?.role === "gm" ? "/gm/dashboard" : "/finance/dashboard", { replace: true });
    } catch (paymentError) {
      setError(paymentError.response?.data?.message || paymentError.message || "Unable to complete payment.");
    } finally {
      setPaying(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6">
      <section className="mx-auto max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="grid lg:grid-cols-[1fr_0.82fr]">
          <div className="p-6 sm:p-9">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-800">
              {expired ? <LockKeyhole className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
            </div>
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
              {expired ? "Subscription Expired" : "Dealership Approved"}
            </p>
            <h1 className="mt-3 break-words text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
              {expired ? "Renew to restore dashboard access" : "Complete Professional Plan activation"}
            </h1>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              {expired
                ? "Your account remains approved, but its paid entitlement has ended. Renew securely to continue."
                : "Your dealership verification is complete. No trial has been activated because Professional Plan was selected during registration."}
            </p>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {benefits.map((benefit) => (
                <div key={benefit} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-3 text-sm font-medium text-slate-700">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  {benefit}
                </div>
              ))}
            </div>
          </div>

          <aside className="border-t border-slate-200 bg-slate-950 p-6 text-white sm:p-9 lg:border-l lg:border-t-0">
            <p className="text-sm font-semibold text-blue-200">{plan.name || "CarLoanSaathi Professional"}</p>
            <p className="mt-3 text-4xl font-semibold">{money(plan.monthlyAmount || 15000)}</p>
            <p className="mt-1 text-sm text-slate-300">per month + GST, manual renewal</p>
            <dl className="mt-7 space-y-3 border-y border-white/15 py-5 text-sm">
              <div className="flex justify-between"><dt>Plan price</dt><dd>{money(plan.monthlyAmount || 15000)}</dd></div>
              <div className="flex justify-between"><dt>GST</dt><dd>{money(plan.gstAmount || 2700)}</dd></div>
              <div className="flex justify-between text-base font-semibold"><dt>Total payable</dt><dd>{money(plan.finalAmount || 17700)}</dd></div>
            </dl>
            <label htmlFor="subscription-terms" className="mt-6 flex items-center gap-3 text-sm leading-6 text-slate-200">
              <span className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg">
                <input
                  id="subscription-terms"
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                  className="h-5 w-5 cursor-pointer accent-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                />
              </span>
              <span className="min-w-0">I accept that the subscription fee is non-refundable after payment is captured and access is activated.</span>
            </label>
            {error ? <p className="mt-4 rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-100">{error}</p> : null}
            {!canPay ? <p className="mt-5 rounded-lg bg-amber-400/10 px-3 py-3 text-sm text-amber-100">Ask your dealership Finance Desk account to complete the payment. Access activates for all dealership users after verification.</p> : null}
            <button type="button" disabled={loading || paying || !accepted || preview || !canPay} onClick={pay} className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white transition-colors duration-200 disabled:opacity-50">
              {loading || paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
              {expired ? "Renew Professional Plan" : "Pay and Activate Account"}
            </button>
            <Link to="/#contact" className="mt-4 block text-center text-sm font-medium text-blue-200">Contact Support</Link>
          </aside>
        </div>
      </section>
    </main>
  );
}
