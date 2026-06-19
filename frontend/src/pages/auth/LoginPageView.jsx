import { Eye, EyeOff, Loader2, LockKeyhole, Mail } from "lucide-react";
import { BrandLogo } from "../../components/BrandLogo.jsx";
import { formatRemaining, workflowSteps } from "./loginPage.helpers.js";

export function LoginPageView({
  config,
  email,
  error,
  errorAction,
  loading,
  lockRemainingMs,
  lockedUntil,
  message,
  navigate,
  password,
  rememberMe,
  resendLoading,
  resendVerification,
  resetLoading,
  resetPassword,
  setEmail,
  setPassword,
  setRememberMe,
  setShowPassword,
  showPassword,
  showResend,
  submit,
}) {
  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto grid min-h-[640px] w-full max-w-6xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:grid-cols-[1.08fr_0.92fr]">
        <div className="flex flex-col justify-between border-b border-slate-200 bg-slate-50/80 p-6 sm:p-8 lg:border-b-0 lg:border-r">
          <div>
            <div className="flex items-center gap-3">
              <BrandLogo className="h-10 w-10 rounded-lg border border-slate-200 bg-white shadow-sm" />
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
              <BrandLogo className="h-9 w-9 rounded-md bg-white" />
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
