import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Clock3,
  Headphones,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import { PublicConversionCtas } from "../components/PublicConversionCtas.jsx";
import { BenefitCard, SectionHeading, WorkflowPreview } from "./plansBilling/PlansBillingParts.jsx";
import { bankBenefits, dealershipBenefits, faqs, featureGroups, legalLinks, workflowStages } from "./plansBilling/plansBilling.data.js";
import { usePlansBillingMetadata } from "./plansBilling/usePlansBillingMetadata.js";

export function PlansBillingPage() {
  usePlansBillingMetadata();

  return (
    <main className="w-full overflow-x-hidden bg-white text-slate-950">
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
              <h3 className="mt-2 text-3xl font-semibold text-slate-950">₹15,000 + GST</h3>
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

      <section id="features" className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <SectionHeading
            eyebrow="Everything Included"
            title="One platform for the complete loan operation."
            text="No feature tiers, per-user pricing, or per-lead charges. Your team gets the workflow tools it needs from day one."
          />
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {featureGroups.map(({ title, icon: Icon, accent, features }) => (
              <article key={title} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <span className={`flex h-11 w-11 items-center justify-center rounded-lg ${accent}`}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-5 text-xl font-semibold text-slate-950">{title}</h3>
                <ul className="mt-5 grid gap-3" aria-label={`${title} features`}>
                  {features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3 text-sm text-slate-600">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
            <article className="flex flex-col justify-between rounded-xl bg-slate-950 p-6 text-white shadow-sm">
              <div>
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-white/10 text-white">
                  <Headphones className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-5 text-xl font-semibold text-white">Built for daily operations</h3>
                <p className="mt-3 text-sm leading-6 text-slate-300">Connect sales, finance, executive, and banking teams without changing the core responsibilities of each role.</p>
              </div>
              <Link to="/dealer/register" className="mt-7 inline-flex items-center text-sm font-semibold text-blue-200 hover:text-white">
                Register your dealership
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </article>
          </div>
        </div>
      </section>

      <section className="bg-blue-50/60 px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <SectionHeading eyebrow="For Dealerships" title="Why Dealerships Choose CarLoanSaathi" text="Bring every customer finance case, team member, document, and bank update into one organized workflow." />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {dealershipBenefits.map((item) => <BenefitCard key={item[0]} item={item} tone="dealer" />)}
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <SectionHeading eyebrow="For Banks" title="Why Banks Benefit From CarLoanSaathi" text="Receive better structured cases and maintain clear coordination with dealerships and loan executives." />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {bankBenefits.map((item) => <BenefitCard key={item[0]} item={item} tone="bank" />)}
          </div>
        </div>
      </section>

      <section className="overflow-hidden bg-slate-950 px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Platform Workflow</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.035em] text-white sm:text-4xl">From customer enquiry to a clear loan outcome.</h2>
            <p className="mt-4 text-base leading-7 text-slate-300">Every stage has an owner, a purpose, and a visible status for the teams permitted to see it.</p>
          </div>
          <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            {workflowStages.map(([title, text, Icon], index) => (
              <li key={title} className="relative">
                {index < workflowStages.length - 1 && <span className="absolute left-full top-7 hidden h-px w-4 bg-blue-400/50 lg:block" aria-hidden="true" />}
                <div className="h-full rounded-xl border border-white/10 bg-white/[0.06] p-5">
                  <div className="flex items-center justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-500/15 text-blue-200">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="text-xs font-semibold text-slate-300">0{index + 1}</span>
                  </div>
                  <h3 className="mt-5 text-base font-semibold text-white">{title}</h3>
                  <p className="mt-2 text-sm leading-5 text-slate-400">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-slate-50 px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <SectionHeading
            eyebrow="Subscription Details"
            title="Clear access rules before, during, and after renewal."
            text="Your operational data stays available after expiry. Only new lead creation pauses until the next successful manual renewal."
          />
          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <Clock3 className="h-6 w-6 text-blue-700" aria-hidden="true" />
              <h3 className="mt-4 text-xl font-semibold text-slate-950">Trial & Renewal</h3>
              <ul className="mt-5 space-y-3 text-sm leading-6 text-slate-600">
                <li>60-day free trial after dealership approval.</li>
                <li>30-day paid subscription cycle.</li>
                <li>Manual renewal only, with no auto-renewal.</li>
              </ul>
            </article>
            <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <LockKeyhole className="h-6 w-6 text-amber-700" aria-hidden="true" />
              <h3 className="mt-4 text-xl font-semibold text-slate-950">After Expiry</h3>
              <ul className="mt-5 space-y-3 text-sm leading-6 text-slate-600">
                <li>New lead creation is disabled.</li>
                <li>Existing leads, documents, and analytics remain accessible.</li>
                <li>No data is deleted or lost.</li>
              </ul>
            </article>
            <article className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-6 shadow-sm">
              <RefreshCw className="h-6 w-6 text-emerald-700" aria-hidden="true" />
              <h3 className="mt-4 text-xl font-semibold text-slate-950">Automatic Reactivation</h3>
              <div className="mt-5 space-y-2">
                {["Successful payment", "Subscription automatically activated", "Lead creation restored"].map((step, index) => (
                  <div key={step}>
                    <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3 text-sm font-semibold text-slate-800">
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                      {step}
                    </div>
                    {index < 2 && <div className="ml-6 h-2 w-px bg-emerald-300" aria-hidden="true" />}
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs font-semibold text-emerald-800">No Super Admin intervention required.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto w-full max-w-4xl">
          <SectionHeading eyebrow="Frequently Asked Questions" title="Straight answers before you get started." />
          <div className="mt-10 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {faqs.map(([question, answer]) => (
              <details key={question} className="group px-5 py-1 sm:px-6">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-5 py-5 text-left text-base font-semibold text-slate-900">
                  {question}
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                    <Check className="hidden h-4 w-4 group-open:block" aria-hidden="true" />
                    <ArrowRight className="h-4 w-4 rotate-90 group-open:hidden" aria-hidden="true" />
                  </span>
                </summary>
                <p className="max-w-3xl pb-5 pr-8 text-sm leading-6 text-slate-600">{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-amber-50/70 px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 rounded-xl border border-amber-200 bg-white p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-slate-950">Important Disclosure</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                CarLoanSaathi is a workflow and loan-tracking software platform. It is not a bank or NBFC and does not sanction, approve, reject, or disburse loans. Loan decisions remain solely with participating financial institutions.
              </p>
            </div>
          </div>
          <nav aria-label="Platform policies" className="flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-100 pt-5">
            {legalLinks.map(([label, to]) => (
              <Link key={to} to={to} className="text-sm font-semibold text-[#0d47a1] hover:underline">{label}</Link>
            ))}
          </nav>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto grid w-full max-w-7xl gap-8 overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#0f172a_0%,#0d47a1_100%)] p-8 text-white shadow-xl shadow-slate-950/15 lg:grid-cols-[1fr_auto] lg:items-center lg:p-12">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-200">Get Started</p>
            <h2 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight tracking-[-0.035em] text-white sm:text-4xl">Ready To Modernize Your Automotive Loan Operations?</h2>
            <p className="mt-4 max-w-2xl text-base leading-7 text-blue-100">Start your 60-day free trial and experience a better way to manage dealership-to-bank loan workflows.</p>
          </div>
          <PublicConversionCtas location="plans_final_cta" dark />
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 text-sm text-slate-500">
          <div className="flex flex-col justify-between gap-4 sm:flex-row">
            <p>(c) 2026 CarLoanSaathi. Automotive loan workflow software for dealerships and banks.</p>
            <p className="inline-flex items-center gap-2"><Building2 className="h-4 w-4" aria-hidden="true" /> Software platform, not a lender.</p>
          </div>
          <nav aria-label="Legal policies" className="flex flex-wrap gap-x-5 gap-y-2 border-t border-slate-100 pt-5">
            {legalLinks.map(([label, to]) => (
              <Link key={to} to={to} className="hover:text-slate-900">{label}</Link>
            ))}
          </nav>
        </div>
      </footer>
    </main>
  );
}
