import { ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

export function DealerApprovalCheckingView() {
  return (
    <main className="w-full bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
        Checking dealership approval...
      </section>
    </main>
  );
}

export function DealerApprovedView({ showSteps = false, onLogin }) {
  const content = (
    <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
      <ShieldCheck className="mx-auto h-10 w-10 text-[#0d47a1]" />
      <h1 className="mt-4 text-2xl font-semibold text-slate-900">Dealership Verified Successfully</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">Your dealership account has been approved successfully by CarLoanSaathi.</p>
      {showSteps ? (
        <div className="mt-6 space-y-2 text-left">
          {["Account verified", "Dealership activated", "Dashboard access enabled"].map((item) => (
            <div key={item} className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              <span className="flex h-6 w-16 items-center justify-center rounded-full bg-emerald-50 text-xs text-emerald-700">Done</span>
              {item}
            </div>
          ))}
        </div>
      ) : null}
      {onLogin ? (
        <button type="button" onClick={onLogin} className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white">Login to Dealer Portal</button>
      ) : (
        <Link to="/dealer/login" className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white">Login to Dealer Portal</Link>
      )}
    </section>
  );
  return <main className="w-full bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">{content}</main>;
}

function statusTone(stepStatus) {
  if (stepStatus === "Done") return "bg-emerald-50 text-emerald-700";
  if (stepStatus === "Rejected" || stepStatus === "Suspended") return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-700";
}

export function DealerPendingStatusView({ copy, message, onCheckStatus, status }) {
  return (
    <main className="w-full bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <ShieldCheck className="mx-auto h-10 w-10 text-[#0d47a1]" />
        <h1 className="mt-4 text-2xl font-semibold text-slate-900">{copy.title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{copy.body}</p>
        <div className="mt-6 space-y-2 text-left">
          {copy.steps.map(([stepStatus, item]) => (
            <div key={item} className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              <span className={`flex h-6 w-20 items-center justify-center rounded-full text-xs ${statusTone(stepStatus)}`}>{stepStatus}</span>
              {item}
            </div>
          ))}
        </div>
        <p className="mt-5 inline-flex rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">{copy.badge}</p>
        {message && <p className="mt-4 rounded-md bg-blue-50 px-3 py-2 text-sm font-medium text-[#0d47a1]">{message}</p>}
        {status === "email-pending" && (
          <button type="button" onClick={onCheckStatus} className="mt-5 mr-3 inline-flex h-10 items-center justify-center rounded-md border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700">I Verified My Email</button>
        )}
        <Link to="/" className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white">Return to Homepage</Link>
      </section>
    </main>
  );
}
