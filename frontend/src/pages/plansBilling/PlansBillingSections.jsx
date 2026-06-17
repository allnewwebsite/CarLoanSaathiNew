import { Check, CheckCircle2, Sparkles } from "lucide-react";
import { PublicConversionCtas } from "../../components/PublicConversionCtas.jsx";
import { SectionHeading, WorkflowPreview } from "./PlansBillingParts.jsx";

export function PlansBillingHeroSection() {
  return (
    <section className="relative overflow-hidden bg-[radial-gradient(circle_at_top_left,#dbeafe_0%,#ffffff_42%,#ecfdf5_100%)] px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
      <div className="absolute -left-24 top-10 h-64 w-64 rounded-full bg-blue-200/40 blur-3xl" aria-hidden="true" />
      <div className="absolute -right-24 bottom-0 h-72 w-72 rounded-full bg-emerald-200/40 blur-3xl" aria-hidden="true" />
      <div className="relative mx-auto grid w-full max-w-7xl items-center gap-14 lg:grid-cols-[1fr_0.9fr]">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white/85 px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            60-day free trial for approved dealerships
          </div>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-[1.08] tracking-[-0.05em] text-slate-950 sm:text-6xl">
            Simple Pricing. <span className="text-[#0d47a1]">Powerful Automotive Loan Workflow.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            Digitize your dealership-to-bank loan operations with complete lead tracking, document management, workflow visibility, and real-time status updates.
          </p>
          <PublicConversionCtas location="plans_hero" className="mt-8" />
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-slate-600">
            {["No setup fee", "No hidden charges", "No long-term lock-in"].map((item) => (
              <span key={item} className="inline-flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                {item}
              </span>
            ))}
          </div>
        </div>
        <WorkflowPreview />
      </div>
    </section>
  );
}

export function PlansBillingPricingSection() {
  return (
    <section id="pricing" className="bg-slate-50 px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <SectionHeading
          eyebrow="Transparent Pricing"
          title="One professional plan. Everything your operation needs."
          text="Start with a full 60-day free trial. Continue on a simple manual monthly subscription when your dealership is ready."
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <article className="rounded-2xl border-2 border-blue-300 bg-white p-7 shadow-sm sm:p-8">
            <span className="inline-flex rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-blue-800">Most Popular</span>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">Start Free Trial</p>
            <h3 className="mt-2 text-3xl font-semibold text-slate-950">60 Days</h3>
            <ul className="mt-6 space-y-3 text-sm text-slate-700">
              {["No payment required", "Full platform access", "Best for evaluation"].map((item) => (
                <li key={item} className="flex items-center gap-3"><CheckCircle2 className="h-4 w-4 text-blue-700" />{item}</li>
              ))}
            </ul>
            <PublicConversionCtas location="plans_comparison_trial" className="mt-7" showBadges={false} showProfessional={false} showContact={false} />
          </article>

          <article className="rounded-2xl border border-emerald-300 bg-emerald-50/50 p-7 shadow-sm sm:p-8">
            <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">Ready To Launch</span>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Get Professional Plan</p>
            <h3 className="mt-2 text-3xl font-semibold text-slate-950">â‚¹15,000 + GST</h3>
            <ul className="mt-6 space-y-3 text-sm text-slate-700">
              {["Immediate paid subscription after approval", "No waiting after approval", "Best for ready-to-use dealerships"].map((item) => (
                <li key={item} className="flex items-center gap-3"><CheckCircle2 className="h-4 w-4 text-emerald-700" />{item}</li>
              ))}
            </ul>
            <PublicConversionCtas location="plans_comparison_professional" className="mt-7" showBadges={false} showTrial={false} showContact={false} />
          </article>
        </div>
        <div className="mx-auto mt-12 max-w-4xl overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-xl shadow-blue-950/10">
          <div className="grid lg:grid-cols-[1fr_0.8fr]">
            <div className="p-7 sm:p-10">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-emerald-700 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white">Ready To Launch</span>
                <span className="text-sm font-medium text-slate-500">Built for dealerships</span>
              </div>
              <h2 className="mt-6 text-2xl font-semibold text-slate-950 sm:text-3xl">CarLoanSaathi Professional</h2>
              <div className="mt-5 flex flex-wrap items-end gap-2">
                <span className="text-4xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-5xl">{"\u20B9"}15,000</span>
                <span className="pb-1 text-base font-medium text-slate-500">/ Month + GST</span>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">A complete operational workspace with unlimited users and leads.</p>
              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {["No Setup Fee", "No Hidden Charges", "No Per User Charges", "No Per Lead Charges", "No Long-Term Lock-In", "Manual Renewal Only"].map((item) => (
                  <div key={item} className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    {item}
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-blue-100 bg-blue-50/70 p-7 sm:p-10 lg:border-l lg:border-t-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0d47a1]">Subscription summary</p>
              <dl className="mt-6 space-y-5">
                {[
                  ["Free Trial", "60 Days"],
                  ["Billing Cycle", "30 Days"],
                  ["Renewal", "Manual Only"],
                  ["Auto-Renewal", "Disabled"],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-4 border-b border-blue-100 pb-4">
                    <dt className="text-sm text-slate-600">{label}</dt>
                    <dd className="text-sm font-semibold text-slate-950">{value}</dd>
                  </div>
                ))}
              </dl>
              <PublicConversionCtas location="plans_summary" className="mt-7" showBadges={false} showContact={false} />
              <p className="mt-3 text-center text-xs leading-5 text-slate-600">Trial begins after dealership approval. No card required to register.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
