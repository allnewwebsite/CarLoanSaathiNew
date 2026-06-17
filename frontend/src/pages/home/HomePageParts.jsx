import {
  Building2,
  CheckCircle2,
  Landmark,
  Phone,
} from "lucide-react";
import {
  AnimatedWorkflow,
  BeforeAfterComparison,
  CaseLifecycleDemo,
  ConnectivityAnimation,
  DashboardShowcaseAnimation,
  NotificationShowcase,
} from "./HomeAnimations.jsx";
import {
  bankBenefits,
  dealershipBenefits,
  showcaseCards,
  trustSignals,
  workflowCards,
} from "./home.data.js";

export function SectionHeader({ eyebrow, title, text }) {
  return (
    <div className="mx-auto max-w-3xl text-center public-fade-in">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.03em] text-slate-950 sm:text-4xl">
        {title}
      </h2>
      {text && <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-600">{text}</p>}
    </div>
  );
}

export function ShowcaseMock({ card }) {
  const Icon = card.icon;
  return (
    <article className="group rounded-[1.75rem] border border-slate-200 bg-white p-5 transition hover:-translate-y-1 public-soft-shadow public-fade-in">
      <div className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${card.accent} text-white`}>
        <Icon className="h-6 w-6" />
      </div>
      <h3 className="mt-5 text-xl font-semibold tracking-[-0.02em] text-slate-950">{card.title}</h3>
      <p className="mt-3 text-sm leading-6 text-slate-600">{card.description}</p>
      <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-4">
        <div className="flex items-center justify-between">
          <span className="h-2.5 w-20 rounded-full bg-blue-200" />
          <span className="h-2.5 w-10 rounded-full bg-slate-200" />
        </div>
        <div className="mt-4 grid gap-2">
          {card.stats.map((stat, index) => (
            <div key={stat} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2">
              <span className={`h-2.5 w-2.5 rounded-full ${index === 0 ? "bg-blue-500" : index === 1 ? "bg-amber-400" : "bg-emerald-500"}`} />
              <span className="text-xs font-semibold text-slate-700">{stat}</span>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

export function EnterpriseAutomationSection() {
  return (
    <section id="automation" className="bg-[linear-gradient(135deg,#f8fbff_0%,#ffffff_45%,#ecfeff_100%)] px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <SectionHeader
          eyebrow="Automation Demo"
          title="The complete loan journey, animated like a modern operating system."
          text="Dealership owners see how every case moves without manual tracking. Bank managers see how all dealership cases, executives, and statuses stay visible from one place."
        />
        <div className="mt-12 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <AnimatedWorkflow />
          <div className="grid gap-6">
            <CaseLifecycleDemo />
            <ConnectivityAnimation />
          </div>
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <DashboardShowcaseAnimation />
          <NotificationShowcase />
        </div>
        <div className="mt-6">
          <BeforeAfterComparison />
        </div>
      </div>
    </section>
  );
}



