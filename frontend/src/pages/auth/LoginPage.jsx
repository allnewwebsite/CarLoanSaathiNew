import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, LockKeyhole, Mail } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { ensureApiReady } from "../../services/api.js";
import { resolveAuthError } from "../../services/authErrorResolver.js";

const portals = {
  dealer: {
    eyebrow: "Dealership Portal",
    title: "DEALERSHIP LOGIN",
    subtitle: "For approved dealership owners and dealership administrators.",
    note: "Access is available only for approved dealership users.",
    registrationPath: "/dealer/register",
    authPortal: "dealer",
  },
  finance: {
    eyebrow: "Finance Head Portal",
    title: "FINANCE HEAD LOGIN",
    subtitle: "For dealership finance managers responsible for customer loan processing and bank coordination.",
    note: "Finance Head access uses the approved dealership account and remains protected by dealership RBAC.",
    registrationPath: "/finance/register",
    authPortal: "dealer",
  },
  bank: {
    eyebrow: "Bank Manager Portal",
    title: "BANK MANAGER LOGIN",
    subtitle: "For approved bank branch managers managing assigned loan workflows and executives.",
    note: "Your bank role is verified securely after email/password login.",
    registrationPath: "/bank/register",
    authPortal: "bank",
  },
  executive: {
    eyebrow: "Loan Executive Portal",
    title: "LOAN EXECUTIVE LOGIN",
    subtitle: "For bank-side executives managing assigned customer loan applications.",
    note: "Loan Executive access is issued and governed by the approved bank branch manager.",
    registrationPath: "/executive/register",
    authPortal: "bank",
  },
  admin: {
    eyebrow: "Private Super Admin",
    title: "SUPER ADMIN LOGIN",
    subtitle: "Authorized CarLoanSaathi administration only.",
    note: "Only the configured Super Admin account can access this control center.",
    authPortal: "admin",
  },
};

const workflowSteps = ["Customer", "Salesperson", "Finance Desk", "Bank", "Approval", "Disbursement"];

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function LoginPage({ portal = "dealer" }) {
  const config = portals[portal] || portals.dealer;
  const authPortal = config.authPortal || portal;
  const navigate = useNavigate();
  const { loginWithEmailPassword, sendPasswordReset, resendVerificationEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [showResend, setShowResend] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [errorAction, setErrorAction] = useState(null);
  const [lockedUntil, setLockedUntil] = useState("");
  const [lockRemainingMs, setLockRemainingMs] = useState(0);

  useEffect(() => {
    if (!lockedUntil) {
      setLockRemainingMs(0);
      return undefined;
    }
    const expiresAt = new Date(lockedUntil).getTime();
    if (!Number.isFinite(expiresAt)) {
      setLockedUntil("");
      return undefined;
    }
    const updateRemaining = () => {
      const remaining = Math.max(0, expiresAt - Date.now());
      setLockRemainingMs(remaining);
      if (remaining <= 0) setLockedUntil("");
    };
    updateRemaining();
    const interval = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(interval);
  }, [lockedUntil]);

  const submit = async (event) => {
    event.preventDefault();
    if (loading || resetLoading || resendLoading) return;
    setLoading(true);
    setError("");
    setErrorAction(null);
    setLockedUntil("");
    setMessage("");
    setShowResend(false);
    if (!validEmail(email)) {
      setError("Enter a valid email address.");
      setLoading(false);
      return;
    }
    if (!password) {
      setError("Enter your password.");
      setLoading(false);
      return;
    }
    try {
      await ensureApiReady({ onStatus: setMessage });
      setMessage("");
      const session = await loginWithEmailPassword({ email, password, portal: authPortal, targetPortal: portal, rememberMe });
      navigate(session.redirectTo || "/", { replace: true });
    } catch (err) {
      const resolved = resolveAuthError(err, portal, "login");
      setError(resolved.message);
      setErrorAction(resolved.actionTo ? { label: resolved.actionLabel, to: resolved.actionTo } : null);
      setShowResend(resolved.showResend);
      setLockedUntil(resolved.lockedUntil || "");
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    setError("");
    setErrorAction(null);
    setLockedUntil("");
    setMessage("");
    if (!validEmail(email)) {
      setError("Enter a valid email address before requesting a password reset.");
      return;
    }
    setResetLoading(true);
    try {
      await sendPasswordReset(email);
      setMessage("Password reset link sent successfully. Please check your inbox.");
    } catch (err) {
      const resolved = resolveAuthError(err, portal, "reset");
      setError(resolved.message);
      setErrorAction(resolved.actionTo ? { label: resolved.actionLabel, to: resolved.actionTo } : null);
      setLockedUntil(resolved.lockedUntil || "");
    } finally {
      setResetLoading(false);
    }
  };

  const resendVerification = async () => {
    setError("");
    setErrorAction(null);
    setLockedUntil("");
    setMessage("");
    if (!validEmail(email) || !password) {
      setError("Enter your email and password before resending verification.");
      return;
    }
    setResendLoading(true);
    try {
      const result = await resendVerificationEmail({ email, password });
      setMessage(result.alreadyVerified ? "Email already verified. Please login again." : "Verification email sent successfully. Please check your inbox.");
      setShowResend(false);
    } catch (err) {
      const resolved = resolveAuthError(err, portal, "verification");
      setError(resolved.message);
      setLockedUntil(resolved.lockedUntil || "");
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto grid min-h-[640px] w-full max-w-6xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:grid-cols-[1.08fr_0.92fr]">
        <div className="flex flex-col justify-between border-b border-slate-200 bg-slate-50/80 p-6 sm:p-8 lg:border-b-0 lg:border-r">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-semibold text-[#0d47a1] shadow-sm">
                CLS
              </div>
              <div>
                <p className="text-base font-semibold text-slate-900">CarLoanSaathi</p>
                <p className="text-xs font-medium text-slate-500">Secure workflow platform</p>
              </div>
            </div>

            <div className="mt-12 max-w-xl">
              <p className="eyebrow">Automotive loan operations</p>
              <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-950 sm:text-4xl">
                Automotive Finance Operating System
              </h1>
              <p className="mt-4 text-sm leading-6 text-slate-600 sm:text-base">
                Secure dealership-to-bank workflow platform for automotive loan processing.
              </p>
            </div>
          </div>

          <div className="mt-10">
            <div className="grid gap-2 sm:grid-cols-3">
              {workflowSteps.map((step, index) => (
                <div key={step} className="rounded-md border border-slate-200 bg-white px-3 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    Step {index + 1}
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-800">{step}</p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">
              Roles, approvals, and sessions are verified server-side before any dashboard access is opened.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-center p-6 sm:p-8">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#0d47a1] text-sm font-semibold text-white">
                C
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">CarLoanSaathi</p>
                <p className="text-xs text-slate-500">Email/password authentication</p>
              </div>
            </div>

            <p className="eyebrow mt-8">{config.eyebrow}</p>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950">{config.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{config.subtitle}</p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <label className="block text-sm font-medium text-slate-700">
                Email Address
                <div className="mt-1.5 flex h-11 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 focus-within:border-[#0d47a1]">
                  <Mail className="h-4 w-4 text-slate-400" />
                  <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-900 outline-none" />
                </div>
              </label>

              <label className="block text-sm font-medium text-slate-700">
                Password
                <div className="mt-1.5 flex h-11 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 focus-within:border-[#0d47a1]">
                  <LockKeyhole className="h-4 w-4 text-slate-400" />
                  <input required type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-900 outline-none" />
                  <button type="button" onClick={() => setShowPassword((current) => !current)} className="text-slate-500" aria-label={showPassword ? "Hide password" : "Show password"}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>

              <div className="flex items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
                  <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-[#0d47a1]" />
                  Remember Me
                </label>
              </div>

              {error && (
                <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold leading-5 text-red-700">
                  {error}
                  {lockedUntil && lockRemainingMs > 0 ? (
                    <span className="mt-1 block text-red-800">
                      Try again in {formatRemaining(lockRemainingMs)}.
                    </span>
                  ) : null}
                </div>
              )}
              {errorAction?.to && (
                <button type="button" onClick={() => navigate(errorAction.to)} className="flex h-9 w-full items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-[#0d47a1]">
                  {errorAction.label || "Continue"}
                </button>
              )}
              {message && <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{message}</p>}
              {showResend && (
                <button type="button" disabled={resendLoading} onClick={resendVerification} className="flex h-10 w-full items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-[#0d47a1] disabled:opacity-70">
                  {resendLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Resend Verification Email"}
                </button>
              )}

              <button type="submit" disabled={loading || resetLoading || resendLoading} className="flex h-11 w-full items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-semibold text-white disabled:opacity-70">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Login"}
              </button>
              <button type="button" disabled={resetLoading} onClick={resetPassword} className="flex w-full justify-center text-xs font-semibold text-[#0d47a1] disabled:opacity-60">
                {resetLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Forgot Password?"}
              </button>
            </form>

            <div className="mt-5 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
              <p className="text-xs leading-5 text-slate-600">{config.note}</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
