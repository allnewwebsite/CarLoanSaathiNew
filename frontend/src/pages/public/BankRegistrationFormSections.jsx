import { CheckCircle2, FileCheck2, Loader2, ShieldCheck } from "lucide-react";
import { bankLoanCapacityRanges, bankStates } from "../../data/bankLocationMaster.js";
import { banks, documents, executiveCounts } from "./bankRegistration.constants.js";
import { UploadBox } from "./BankRegistrationParts.jsx";

export function BankEmailVerificationSection({ bankEmail, hasEmailAccount, onStartEmailAccount }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Email Account Verification</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-5 w-5" /></span>
          <div><p className="text-sm font-semibold text-slate-900">{hasEmailAccount ? bankEmail : "Email account not verified"}</p><p className="text-xs text-slate-500">{hasEmailAccount ? "Verified email/password session active" : "Verify email before submitting"}</p></div>
        </div>
        <button type="button" onClick={onStartEmailAccount} className="h-10 rounded-md border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700">Create Account</button>
      </div>
    </section>
  );
}

export function BankIdentitySection({ form, locationOptions, update }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3 border-b border-slate-200 pb-4"><FileCheck2 className="h-5 w-5 text-[#0d47a1]" /><h1 className="text-xl font-semibold text-slate-950">Bank Registration Form</h1></div>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">Name of Bank *<select required className="field mt-2" value={form.bankName} onChange={(event) => update("bankName", event.target.value)}><option value="">Select bank</option>{banks.map((bank) => <option key={bank}>{bank}</option>)}</select></label>
        <label className="text-sm font-medium text-slate-700">Branch IFSC Code *<input required className="field mt-2 uppercase" value={form.ifsc} onChange={(event) => update("ifsc", event.target.value.toUpperCase())} /></label>
        <label className="text-sm font-medium text-slate-700">State *<select required className="field mt-2" value={form.state} onChange={(event) => update("state", event.target.value)}><option value="">Select state</option>{bankStates.map((state) => <option key={state}>{state}</option>)}</select></label>
        <label className="text-sm font-medium text-slate-700">Bank Branch Location *<select required className="field mt-2" value={form.branchLocation} onChange={(event) => update("branchLocation", event.target.value)}><option value="">Select location</option>{locationOptions.map((location) => <option key={location}>{location}</option>)}</select></label>
      </div>
    </section>
  );
}

export function BankManagerDetailsSection({ bankEmail, form, update }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">Manager Details</h2>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">Bank Manager Name *<input required className="field mt-2" value={form.managerName} onChange={(event) => update("managerName", event.target.value)} /></label>
        <label className="text-sm font-medium text-slate-700">
          Bank Manager Contact Number *
          <div className="mt-2 flex h-10 overflow-hidden rounded-md border border-slate-200 bg-white focus-within:border-[#0d47a1]">
            <span className="inline-flex items-center border-r border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">+91</span>
            <input required inputMode="numeric" maxLength={10} className="h-full w-full px-3 outline-none" value={form.managerMobile} onChange={(event) => update("managerMobile", event.target.value.replace(/\D/g, "").slice(0, 10))} />
          </div>
        </label>
        <label className="text-sm font-medium text-slate-700">Official Bank Email *<input required readOnly disabled type="email" className="field mt-2 bg-slate-50 text-slate-600" value={bankEmail || form.email} /></label>
      </div>
    </section>
  );
}

export function BankOperationsSection({ form, update }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">Branch Operations</h2>
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">Number of Loan Executives *<select required className="field mt-2" value={form.executiveCount} onChange={(event) => update("executiveCount", event.target.value)}><option value="">Select count</option>{executiveCounts.map((count) => <option key={count}>{count}</option>)}</select></label>
        <label className="text-sm font-medium text-slate-700">Monthly Loan Capacity *<select required className="field mt-2" value={form.monthlyLoanCapacity} onChange={(event) => update("monthlyLoanCapacity", event.target.value)}><option value="">Select capacity</option>{bankLoanCapacityRanges.map((capacity) => <option key={capacity}>{capacity}</option>)}</select></label>
      </div>
    </section>
  );
}

export function BankDocumentUploadsSection({ bankUid, setUpload, uploads }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">Bank Document Uploads</h2>
      <div className="mt-5 grid gap-4 md:grid-cols-2">{documents.map((doc) => <UploadBox key={doc.type} doc={doc} bankUid={bankUid} value={uploads[doc.type]} onChange={(value) => setUpload(doc.type, value)} />)}</div>
    </section>
  );
}

export function BankManualVerificationSection({ hasEmailAccount, loading }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-[#0d47a1]" /><div><h2 className="text-base font-semibold text-slate-950">All bank registrations are verified manually by CarLoanSaathi Super Admin before activation.</h2><p className="mt-2 text-sm leading-6 text-slate-600">Secure onboarding, branch verification, document checks, and executive mapping are completed before bank portal access is enabled.</p></div></div>
      <button disabled={loading || !hasEmailAccount} className="mt-6 flex h-11 w-full items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-semibold text-white disabled:opacity-70">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Submit for Super Admin Approval"}</button>
    </section>
  );
}
