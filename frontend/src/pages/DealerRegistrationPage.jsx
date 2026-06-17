import { CheckCircle2, Eye, EyeOff, Landmark, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePublicRegistrationStatusSync } from "../hooks/usePublicRegistrationStatusSync.js";
import { selectedOnboardingPlan } from "../services/onboardingPlan.js";
import { useAuth } from "../context/AuthContext.jsx";
import { benefitCards, workflow } from "./dealerRegistration/dealerRegistration.constants.js";

export function DealerRegistrationPage({ audience = "dealer" }) {
  const isFinanceAudience = audience === "finance";
  const onboardingEyebrow = isFinanceAudience ? "Finance Head Registration" : "Dealer partner onboarding";
  const onboardingTitle = isFinanceAudience ? "Finance Head Registration" : "Partner with CarLoanSaathi";
  const onboardingSubtitle = isFinanceAudience
    ? "For dealership finance managers responsible for customer loan processing and bank coordination."
    : "India's dealership-to-bank automotive finance operating platform.";
  const onboardingBody = isFinanceAudience
    ? "Create the approved dealership account used by finance heads to submit customer loan cases, coordinate with partner banks, and track approvals from one secure dashboard."
    : "Manage finance operations, route leads to partner banks, track approvals, monitor disbursement, and streamline dealership finance workflows from one centralized platform.";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const { startDealerRegistrationWithEmail } = useAuth();
  const navigate = useNavigate();

  const beginRegistration = async () => {
    if (!authEmail.trim() || !authPassword) {
      setError("Enter email address and password to create your dealership account.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const registration = await startDealerRegistrationWithEmail({
        email: authEmail,
        password: authPassword,
        selectedPlan: selectedOnboardingPlan(),
      });
      navigate(registration.redirectTo || "/dealer-registration/form");
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Unable to create email/password account.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="w-full overflow-x-hidden bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-7xl space-y-8">
        <section className="grid gap-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-[1.05fr_0.95fr] lg:p-6">
          <div className="flex flex-col justify-center">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">{onboardingEyebrow}</p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-900 md:text-4xl">{onboardingTitle}</h1>
            <p className="mt-3 text-lg font-medium text-slate-700">{onboardingSubtitle}</p>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
              {onboardingBody}
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">Email Address<input type="email" className="field mt-1.5 h-11 rounded-md" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} /></label>
              <label className="text-sm font-medium text-slate-700">
                Password
                <div className="field mt-1.5 flex h-11 items-center gap-2 rounded-md bg-white px-3">
                  <input type={showAuthPassword ? "text" : "password"} className="min-w-0 flex-1 bg-transparent outline-none" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} />
                  <button type="button" onClick={() => setShowAuthPassword((current) => !current)} className="text-slate-500" aria-label={showAuthPassword ? "Hide password" : "Show password"}>
                    {showAuthPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button onClick={beginRegistration} disabled={loading} className="inline-flex h-11 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white disabled:opacity-70">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Create Account"}
              </button>
              <a href="#benefits" className="inline-flex h-11 items-center justify-center rounded-md border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700">Explore Benefits</a>
            </div>
            {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="rounded-lg bg-white p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Operational workflow</p>
                  <h2 className="mt-2 text-lg font-semibold text-slate-900">Dealership to disbursement</h2>
                </div>
                <Landmark className="h-5 w-5 text-[#0d47a1]" />
              </div>
              <div className="mt-4 grid gap-2">
                {workflow.map((step, index) => (
                  <div key={step} className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-xs font-medium text-[#0d47a1]">{index + 1}</span>
                    <span className="text-sm font-medium text-slate-700">{step}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="benefits" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Benefits</p>
              <h2 className="mt-2 text-xl font-semibold text-slate-900">Why dealerships partner with CarLoanSaathi</h2>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {benefitCards.map((benefit) => (
              <div key={benefit} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <p className="mt-3 text-sm font-medium text-slate-800">{benefit}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">How it works</p>
            <div className="mt-4 grid gap-3">
              {["Register dealership", "Get approval from CarLoanSaathi", "Finance desk starts submitting leads", "Track approvals and disbursement live"].map((step, index) => (
                <div key={step} className="flex gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#0d47a1] text-xs font-medium text-white">{index + 1}</span>
                  <p className="text-sm font-medium text-slate-800">{step}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Bank network</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">Approved branch tie-ups after onboarding</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">Dealership approval is separate from bank routing. Finance desk users select approved bank branches later, and every lead must use one of those active tie-ups.</p>
          </div>
        </section>

      </div>
    </main>
  );
}

export function DealerRegistrationApprovedPage() {
  const [allowed, setAllowed] = useState(null);
  const { checkDealerRegistrationWithEmail } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const guard = async () => {
      const registration = await checkDealerRegistrationWithEmail({ silent: true });
      if (registration.status === "approved" || registration.approvalStatus === "approved") {
        setAllowed(true);
      } else {
        navigate(registration.redirectTo || "/dealer-registration", { replace: true });
      }
    };
    guard();
  }, [checkDealerRegistrationWithEmail, navigate]);

  if (allowed !== true) {
    return (
      <main className="w-full bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
          Checking dealership approval...
        </section>
      </main>
    );
  }

  return (
    <main className="w-full bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <ShieldCheck className="mx-auto h-10 w-10 text-[#0d47a1]" />
        <h1 className="mt-4 text-2xl font-semibold text-slate-900">Dealership Verified Successfully</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Your dealership account has been approved successfully by CarLoanSaathi.
        </p>
        <Link to="/dealer/login" className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white">
          Login to Dealer Portal
        </Link>
      </section>
    </main>
  );
}

export function DealerRegistrationPendingPage({ mode = "pending" }) {
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState("");
  const [approved, setApproved] = useState(false);
  const [status, setStatus] = useState(mode === "verify-email" ? "email-pending" : mode);
  const { checkDealerRegistrationWithEmail } = useAuth();
  const navigate = useNavigate();

  const statusRoute = {
    "email-pending": "/dealer-registration/verify-email",
    pending: "/dealer-registration/pending",
    submitted: "/dealer-registration/pending",
    rejected: "/dealer-registration/rejected",
    suspended: "/dealer-registration/suspended",
  };

  const applyRegistrationStatus = (registration) => {
    const nextStatus = registration.status || registration.approvalStatus || "pending";
    if (registration.status === "approved" || registration.approvalStatus === "approved") {
      setApproved(true);
      return;
    }
    if (nextStatus === "not-submitted" || registration.accountState === "EMAIL_VERIFIED") {
      navigate(registration.redirectTo || "/dealer-registration/form", { replace: true });
      return;
    }
    const allowed = ["email-pending", "pending", "submitted", "rejected", "suspended"].includes(nextStatus);
    if (!allowed) {
      navigate(registration.redirectTo || "/dealer-registration", { replace: true });
      return;
    }
    setStatus(nextStatus);
    setMessage(registration.message || "");
    const expectedRoute = statusRoute[nextStatus] || "/dealer-registration/pending";
    if (registration.redirectTo && registration.redirectTo !== expectedRoute) {
      navigate(registration.redirectTo, { replace: true });
    } else if (window.location.pathname !== expectedRoute) {
      navigate(expectedRoute, { replace: true });
    }
  };

  const checkStatus = async ({ silent = false } = {}) => {
    if (!silent) setChecking(true);
    setMessage("");
    try {
      const registration = await checkDealerRegistrationWithEmail({ silent });
      applyRegistrationStatus(registration);
    } catch (err) {
      if (!silent) setMessage(err.response?.data?.message || err.message || "Unable to check approval status.");
    } finally {
      if (!silent) setChecking(false);
    }
  };

  useEffect(() => {
    const checkSilently = async () => {
      setChecking(true);
      try {
        const registration = await checkDealerRegistrationWithEmail({ silent: true });
        applyRegistrationStatus(registration);
      } finally {
        setChecking(false);
      }
    };
    checkSilently();
  }, []);
  usePublicRegistrationStatusSync({
    enabled: ["email-pending", "pending", "submitted"].includes(status) && !approved,
    checkStatus,
  });

  if (approved) {
    return (
      <main className="w-full bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
          <ShieldCheck className="mx-auto h-10 w-10 text-[#0d47a1]" />
          <h1 className="mt-4 text-2xl font-semibold text-slate-900">Dealership Verified Successfully</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Your dealership account has been approved successfully by CarLoanSaathi.
          </p>
          <div className="mt-6 space-y-2 text-left">
            {["Account verified", "Dealership activated", "Dashboard access enabled"].map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                <span className="flex h-6 w-16 items-center justify-center rounded-full bg-emerald-50 text-xs text-emerald-700">Done</span>
                {item}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => navigate("/dealer/login")} className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white">
            Login to Dealer Portal
          </button>
        </section>
      </main>
    );
  }

  if (checking) {
    return (
      <main className="w-full bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
          Checking dealership approval...
        </section>
      </main>
    );
  }

  const statusCopy = {
    "email-pending": {
      title: "Verify Your Email",
      body: "We sent a verification link to your email address. Verify it before completing dealership registration.",
      badge: "Email Verification Pending",
      steps: [["Done", "Email account created"], ["Pending", "Email verification"], ["Next", "Complete dealership registration"]],
    },
    rejected: {
      title: "Registration Rejected",
      body: message || "Your dealership registration was rejected by CarLoanSaathi.",
      badge: "Rejected",
      steps: [["Done", "Email verified"], ["Done", "Registration reviewed"], ["Rejected", "Approval not granted"]],
    },
    suspended: {
      title: "Account Suspended",
      body: message || "Your dealership account is suspended. Contact CarLoanSaathi support for next steps.",
      badge: "Suspended",
      steps: [["Done", "Email verified"], ["Done", "Account reviewed"], ["Suspended", "Dashboard access blocked"]],
    },
    pending: {
      title: "Approval Pending",
      body: "Your dealership registration has been submitted successfully and is under verification by CarLoanSaathi.",
      badge: "Pending Super Admin Verification",
      steps: [["Done", "Email verified"], ["Done", "Registration submitted"], ["Pending", "Waiting for admin verification"]],
    },
    submitted: {
      title: "Approval Pending",
      body: "Your dealership registration has been submitted successfully and is under verification by CarLoanSaathi.",
      badge: "Pending Super Admin Verification",
      steps: [["Done", "Email verified"], ["Done", "Registration submitted"], ["Pending", "Waiting for admin verification"]],
    },
  };
  const copy = statusCopy[status] || statusCopy.pending;

  return (
    <main className="w-full bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <ShieldCheck className="mx-auto h-10 w-10 text-[#0d47a1]" />
        <h1 className="mt-4 text-2xl font-semibold text-slate-900">{copy.title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {copy.body}
        </p>
        <div className="mt-6 space-y-2 text-left">
          {copy.steps.map(([stepStatus, item]) => (
            <div key={item} className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              <span className={`flex h-6 w-20 items-center justify-center rounded-full text-xs ${stepStatus === "Done" ? "bg-emerald-50 text-emerald-700" : stepStatus === "Rejected" || stepStatus === "Suspended" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{stepStatus}</span>
              {item}
            </div>
          ))}
        </div>
        <p className="mt-5 inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">{copy.badge}</p>
        {message && <p className="mt-4 rounded-md bg-blue-50 px-3 py-2 text-sm font-medium text-[#0d47a1]">{message}</p>}
        {status === "email-pending" && (
          <button type="button" onClick={checkStatus} className="mt-5 mr-3 inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700">I Verified My Email</button>
        )}
        <Link to="/" className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white">Return to Homepage</Link>
      </section>
    </main>
  );
}

export { DealerRegistrationFormPage } from './dealerRegistration/DealerRegistrationFormPage.jsx';
