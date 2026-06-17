import { Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { bankExecutiveWorkflow, benefits, workflow } from "./bankRegistration.constants.js";

export function BankExecutiveLandingView() {
  return (
    <main className="w-full bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto grid max-w-6xl gap-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm lg:grid-cols-[1.05fr_0.95fr]">
        <div className="flex min-h-80 flex-col justify-center">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Loan Executive Registration</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-950 md:text-4xl">Bank-side Executive Access</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">For bank-side executives managing assigned customer loan applications.</p>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">Loan executive accounts are created and governed by the approved bank branch manager from the bank dashboard, preserving the existing approval workflow and RBAC model.</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link to="/executive/login" className="inline-flex h-11 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white">Loan Executive Login</Link>
            <Link to="/bank/register" className="inline-flex h-11 items-center justify-center rounded-md border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700">Register Bank Branch</Link>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Executive Access Workflow</p>
          <h2 className="mt-3 text-lg font-semibold text-slate-900">Secure bank-managed onboarding</h2>
          <div className="mt-4 space-y-2">
            {bankExecutiveWorkflow.map((step, index) => (
              <div key={step} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
                <span className="flex h-6 w-8 items-center justify-center rounded-md bg-slate-50 text-xs">{index + 1}</span>
                {step}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

export function BankRegistrationLandingView({ authEmail, authPassword, error, loading, onEmailChange, onPasswordChange, onStartEmailAccount }) {
  return (
    <main className="w-full bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <section className="mx-auto grid max-w-7xl gap-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm lg:grid-cols-[1.05fr_0.95fr]">
        <div className="flex min-h-96 flex-col justify-center">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Bank Partner Onboarding Portal</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-950 md:text-4xl">Partner with CarLoanSaathi</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">Register your banking branch network to receive dealership finance leads, manage executives, process automotive loans, and track approvals in real-time.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{benefits.map((item) => <div key={item} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800">{item}</div>)}</div>
          <p className={`mt-5 min-h-11 rounded-lg px-4 py-3 text-sm font-semibold ${error ? "bg-red-50 text-red-700" : "invisible bg-red-50 text-red-700"}`}>{error || "No validation issue"}</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <input type="email" placeholder="Email Address" className="field h-11 rounded-md" value={authEmail} onChange={(event) => onEmailChange(event.target.value)} />
            <input type="password" placeholder="Password" className="field h-11 rounded-md" value={authPassword} onChange={(event) => onPasswordChange(event.target.value)} />
          </div>
          <button disabled={loading} onClick={onStartEmailAccount} className="mt-6 inline-flex h-11 min-w-36 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white disabled:opacity-70">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Create Account"}</button>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Onboarding Workflow</p>
          <h2 className="mt-3 text-lg font-semibold text-slate-900">Bank branch activation</h2>
          <div className="mt-4 space-y-2">{workflow.map((step, index) => <div key={step} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"><span className="flex h-6 w-8 items-center justify-center rounded-md bg-slate-50 text-xs">{index + 1}</span>{step}</div>)}</div>
        </div>
      </section>
    </main>
  );
}
