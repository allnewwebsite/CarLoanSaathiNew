import { Landmark, ShieldCheck, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

export function DealerRegistrationEmailRequiredView() {
  return (
    <main className="w-full bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <ShieldCheck className="mx-auto h-8 w-8 text-[#0d47a1]" />
        <h1 className="mt-3 text-xl font-semibold text-slate-900">Email account required</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Start from the dealer onboarding page so your official email can become the primary dealership login.</p>
        <Link to="/dealer-registration" className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-[#0d47a1] px-4 text-sm font-medium text-white">Go to Dealer Registration</Link>
      </section>
    </main>
  );
}

export function DealerRegistrationSubmittedView() {
  return (
    <main className="w-full bg-slate-50 px-4 py-12 sm:px-6 lg:px-8">
      <section className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <ShieldCheck className="mx-auto h-10 w-10 text-[#0d47a1]" />
        <h1 className="mt-4 text-2xl font-semibold text-slate-900">Registration Submitted Successfully</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Your dealership onboarding request has been submitted to CarLoanSaathi for verification and approval.</p>
        <div className="mt-6 space-y-2 text-left">
          {["Email account created", "Registration submitted", "Admin approval pending"].map((item, index) => (
            <div key={item} className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              <span className={`flex h-6 w-16 items-center justify-center rounded-full text-xs ${index < 2 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{index < 2 ? "Done" : "Pending"}</span>
              {item}
            </div>
          ))}
        </div>
        <p className="mt-5 text-sm leading-6 text-slate-600">Your dealership registration has been submitted successfully and is currently under verification by CarLoanSaathi. You cannot login until your dealership is approved by Super Admin.</p>
        <Link to="/dealer-registration/pending" className="mt-5 inline-flex h-10 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white">View Approval Pending Status</Link>
      </section>
    </main>
  );
}

export function DealerRegistrationHero({ registrationEmail }) {
  return (
    <>
      <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
        Email account created successfully for {registrationEmail}. Complete the dealership registration to request Super Admin approval.
      </div>
      <section className="grid gap-6 rounded-lg border border-slate-200 bg-white p-5 lg:grid-cols-[1.05fr_0.95fr] lg:p-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Authorized dealership onboarding</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-900 md:text-4xl">Partner with CarLoanSaathi</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">India's smart automotive finance network for dealership finance desks.</p>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {["25+ Partner Banks", "Location-based Lead Distribution", "Real-time Dashboard", "Faster Approvals"].map((item) => (
              <div key={item} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-medium text-slate-700">{item}</div>
            ))}
          </div>
        </div>
        <div className="relative min-h-56 overflow-hidden rounded-lg bg-slate-50 p-5">
          <div className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-lg bg-white"><Landmark className="h-5 w-5 text-[#0d47a1]" /></div>
          <div className="mt-14 rounded-lg bg-white p-4">
            <Sparkles className="h-6 w-6 text-[#0d47a1]" />
            <p className="mt-3 text-lg font-semibold text-slate-900">Finance desk onboarding</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">Verified dealership identity, location mapping, approval readiness, and document status.</p>
          </div>
        </div>
      </section>
      <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Workflow</h2>
        <div className="mt-4 grid gap-2 md:grid-cols-6">
          {["Customer", "Salesperson", "Finance Desk", "CarLoanSaathi", "Bank", "Approval / Disbursement"].map((step) => (
            <div key={step} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-center text-sm font-medium text-slate-700">{step}</div>
          ))}
        </div>
      </section>
    </>
  );
}

export function DealerRegistrationSidebar({ brandLogos, CheckIcon }) {
  return (
    <aside className="h-fit rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-20">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50"><ShieldCheck className="h-5 w-5 text-[#0d47a1]" /></div>
      <h2 className="mt-4 text-lg font-semibold text-slate-900">Why dealerships join</h2>
      <div className="mt-4 space-y-2">
        {["Multi-bank finance processing", "Faster loan approvals", "Location-wise lead routing", "Dealer dashboard", "Secure document handling", "Real-time tracking", "Finance desk management"].map((benefit) => (
          <p key={benefit} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm font-normal text-slate-700"><CheckIcon className="h-4 w-4 text-emerald-600" />{benefit}</p>
        ))}
      </div>
      <div className="mt-4 rounded-lg bg-[#0d47a1] p-3 text-sm font-normal leading-6 text-white">
        Lead distribution runs location-wise: customer location to dealership location to active bank branch location.
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {Object.values(brandLogos).slice(0, 8).map((logo) => <div key={logo} className="flex h-12 items-center justify-center rounded-xl bg-[#f8fbff]"><img src={logo} alt="" loading="lazy" decoding="async" className="max-h-7 max-w-14 object-contain" /></div>)}
      </div>
    </aside>
  );
}
