import { useState } from "react";
import { Eye, EyeOff, Loader2, LockKeyhole, Mail } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";

const portals = {
  dealer: {
    eyebrow: "Dealer Portal",
    title: "Dealer Portal Access",
    subtitle: "Finance Desk and GM/SM authorized access only.",
    note: "Access is available only for approved dealership users.",
  },
  bank: {
    eyebrow: "Bank Partner Portal",
    title: "Bank Portal Access",
    subtitle: "Branch managers and loan executives authorized access only.",
    note: "Your bank role is verified securely after email/password login.",
  },
  admin: {
    eyebrow: "Private Super Admin",
    title: "Restricted Super Admin Access",
    subtitle: "Authorized CarLoanSaathi administration only.",
    note: "Only hydarkdevil@gmail.com can access this control center.",
  },
};

const workflowSteps = ["Customer", "Salesperson", "Finance Desk", "Bank", "Approval", "Disbursement"];

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function authMessage(error, portal, action = "login") {
  const code = error.response?.data?.code || error.code || "";
  const message = error.response?.data?.message || error.message || "";
  if (/resetting password/i.test(message)) {
    return action === "reset"
      ? "Verify your email before resetting password."
      : "Please verify your email address before logging in.";
  }
  if (code === "EMAIL_NOT_VERIFIED" || /verify your email/i.test(message)) return "Please verify your email address before logging in.";
  if (code === "auth/user-not-found" || error.response?.status === 404) return "No account found with this email address.";
  if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
    if (portal === "dealer") return "No dealer account found. Create account from Dealer Registration, or use Forgot Password if this email is already registered.";
    return "Incorrect email or password.";
  }
  if (code === "auth/weak-password") return "Password is too weak.";
  if (code === "auth/too-many-requests") return "Too many attempts. Try again later.";
  if (code === "auth/requests-from-referer-are-blocked" || /referer.*blocked/i.test(message)) {
    return "This domain is blocked by Firebase API key restrictions. Add this website in Google Cloud API key restrictions.";
  }
  if (error.code === "ERR_NETWORK" || error.code === "ECONNABORTED") {
    return action === "reset"
      ? "Unable to send password reset email. Try again later."
      : "Unable to login right now. Please try again later.";
  }
  return message || "Unable to login. Please verify your email and password.";
}

export function LoginPage({ portal = "dealer" }) {
  const config = portals[portal] || portals.dealer;
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

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");
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
      const session = await loginWithEmailPassword({ email, password, portal });
      if (!rememberMe) sessionStorage.setItem("cls_session_only", "true");
      navigate(session.redirectTo || "/", { replace: true });
    } catch (err) {
      const nextMessage = authMessage(err, portal, "login");
      setError(nextMessage);
      setShowResend(err.code === "EMAIL_NOT_VERIFIED" || err.response?.data?.code === "EMAIL_NOT_VERIFIED" || /verify your email/i.test(nextMessage));
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    setError("");
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
      setError(authMessage(err, portal, "reset") || "Unable to send password reset email. Try again later.");
    } finally {
      setResetLoading(false);
    }
  };

  const resendVerification = async () => {
    setError("");
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
      setError(authMessage(err, portal, "verification") || "Unable to send verification email. Try again later.");
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
                <button type="button" disabled={resetLoading} onClick={resetPassword} className="text-xs font-semibold text-[#0d47a1] disabled:opacity-60">
                  {resetLoading ? "Sending..." : "Forgot Password"}
                </button>
              </div>

              {error && <p className="rounded-md bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>}
              {portal === "dealer" && /create account|dealer registration/i.test(error) && (
                <button type="button" onClick={() => navigate("/dealer-registration")} className="flex h-10 w-full items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-[#0d47a1]">
                  Create Account
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
