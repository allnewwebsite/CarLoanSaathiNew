import { CheckCircle2, Eye, EyeOff, Landmark, Loader2 } from "lucide-react";
import { benefitCards, workflow } from "./dealerRegistration.constants.js";

export function DealerRegistrationLandingView({
  authEmail,
  authPassword,
  error,
  loading,
  onboardingBody,
  onboardingEyebrow,
  onboardingSubtitle,
  onboardingTitle,
  onBeginRegistration,
  onEmailChange,
  onPasswordChange,
  onTogglePassword,
  showAuthPassword,
}) {
  return (
    <main className="w-full overflow-x-hidden bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-7xl space-y-8">
        <section className="grid gap-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-[1.05fr_0.95fr] lg:p-6">
          <div className="flex flex-col justify-center">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">{onboardingEyebrow}</p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-900 md:text-4xl">{onboardingTitle}</h1>
            <p className="mt-3 text-lg font-medium text-slate-700">{onboardingSubtitle}</p>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">{onboardingBody}</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">Email Address<input type="email" className="field mt-1.5 h-11 rounded-md" value={authEmail} onChange={(event) => onEmailChange(event.target.value)} /></label>
              <label className="text-sm font-medium text-slate-700">
                Password
                <div className="field mt-1.5 flex h-11 items-center gap-2 rounded-md bg-white px-3">
                  <input type={showAuthPassword ? "text" : "password"} className="min-w-0 flex-1 bg-transparent outline-none" value={authPassword} onChange={(event) => onPasswordChange(event.target.value)} />
                  <button type="button" onClick={onTogglePassword} className="text-slate-500" aria-label={showAuthPassword ? "Hide password" : "Show password"}>
                    {showAuthPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button onClick={onBeginRegistration} disabled={loading} className="inline-flex h-11 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white disabled:opacity-70">
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
