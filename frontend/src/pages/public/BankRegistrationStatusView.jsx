import { ShieldCheck } from "lucide-react";
import { bankRegistrationStatusCopy } from "./bankRegistration.constants.js";

function statusClass(stepStatus) {
  if (stepStatus === "Done") return "bg-emerald-50 text-emerald-700";
  if (stepStatus === "Rejected" || stepStatus === "Suspended") return "bg-red-50 text-red-700";
  if (stepStatus === "Pending") return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

export function BankRegistrationCheckingView() {
  return (
    <main className="flex min-h-[calc(100vh-88px)] w-full items-center justify-center bg-slate-50 px-4 py-12">
      <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">Checking bank registration status...</section>
    </main>
  );
}

export function BankRegistrationApprovedView({ onLogin }) {
  return (
    <main className="flex min-h-[calc(100vh-88px)] w-full items-center justify-center bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-3xl rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"><ShieldCheck className="h-8 w-8" /></span>
        <h1 className="mt-5 text-2xl font-semibold text-slate-900">Bank Account Verified Successfully</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">Your bank partner account has been approved successfully by CarLoanSaathi. You can now access the Bank Manager portal.</p>
        <button type="button" onClick={onLogin} className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white">Login to Bank Portal</button>
      </section>
    </main>
  );
}

export function BankRegistrationStatusView({ bankEmail, form, pendingDetails, status, statusMessage }) {
  const baseCopy = bankRegistrationStatusCopy[status] || bankRegistrationStatusCopy.pending;
  const copy = {
    ...baseCopy,
    body: (status === "rejected" || status === "suspended") && statusMessage ? statusMessage : baseCopy.body,
  };

  return (
    <main className="min-h-[calc(100vh-88px)] w-full bg-slate-50 px-4 py-10 sm:px-6 lg:px-8">
      <section className="mx-auto grid max-w-5xl gap-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm lg:grid-cols-[1.1fr_0.9fr] lg:p-8">
        <div>
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#0d47a1]/10 text-[#0d47a1]"><ShieldCheck className="h-8 w-8" /></span>
          <p className="mt-5 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Bank branch onboarding</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-900 md:text-4xl">{copy.title}</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">{copy.body}</p>
          <p className="mt-5 inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">{copy.badge}</p>
          {status === "email-pending" && (
            <button type="button" onClick={() => window.location.reload()} className="mt-5 block h-10 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700">I Verified My Email</button>
          )}
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Submission Summary</h2>
          <div className="mt-4 grid gap-3">
            {[
              ["Bank", pendingDetails?.bankName || form.bankName || "-"],
              ["Location", pendingDetails?.branchLocation || "-"],
              ["Registered Email", pendingDetails?.email || bankEmail || "-"],
              ["Submitted", pendingDetails?.submittedAt ? new Date(pendingDetails.submittedAt).toLocaleString() : "-"],
            ].map(([label, value]) => <div key={label} className="rounded-md border border-slate-200 bg-white px-3 py-2"><p className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-900">{value}</p></div>)}
          </div>
        </div>
      </section>
      <section className="mx-auto mt-5 max-w-5xl rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Approval Workflow</h2>
        <div className="mt-4 grid gap-2 md:grid-cols-4">
          {copy.steps.map(([stepStatus, label]) => (
            <div key={label} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium text-slate-700">
              <span className={`mb-2 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass(stepStatus)}`}>{stepStatus}</span>
              <p>{label}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
