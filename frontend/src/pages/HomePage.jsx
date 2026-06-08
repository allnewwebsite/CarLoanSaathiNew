import {
  ArrowRight,
  BadgeCheck,
  Bell,
  Building2,
  CheckCircle2,
  FileCheck2,
  FileText,
  Landmark,
  LayoutDashboard,
  LockKeyhole,
  MessageCircle,
  Network,
  Phone,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  Table2,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const heroMetrics = [
  ["1,284", "Active cases", "+18% flow"],
  ["42 min", "Avg. SLA response", "Live tracking"],
  ["86", "Bank branches", "Coordinated"],
  ["99.2%", "Visibility", "Audit ready"],
];

const workflowCards = [
  ["Dealer", "Creates and tracks dealership finance cases", Building2],
  ["Finance", "Validates documents and coordinates bank movement", Users],
  ["Bank", "Receives assigned cases with branch ownership", Landmark],
  ["Executive", "Updates field status and document requirements", BadgeCheck],
  ["Disbursement", "Keeps final movement visible to permitted roles", FileCheck2],
];

const showcaseCards = [
  {
    title: "Finance Dashboard",
    description: "A live finance desk for cases, teams, documents, and bank tie-ups.",
    icon: LayoutDashboard,
    accent: "from-sky-500 to-blue-600",
    stats: ["247 cases", "18 pending docs", "12 bank tie-ups"],
  },
  {
    title: "Bank Dashboard",
    description: "Branch-level case queues, executive assignment, and status oversight.",
    icon: Landmark,
    accent: "from-blue-600 to-indigo-600",
    stats: ["96 assigned", "31 in review", "14 decisions"],
  },
  {
    title: "Executive Dashboard",
    description: "Focused case lists for loan executives with clear next actions.",
    icon: Users,
    accent: "from-cyan-500 to-sky-600",
    stats: ["38 active", "9 follow-ups", "6 uploads"],
  },
  {
    title: "Operations Dashboard",
    description: "Governance visibility across approvals, status movement, and operations.",
    icon: ShieldCheck,
    accent: "from-slate-700 to-blue-700",
    stats: ["Role checks", "Audit logs", "Portal isolation"],
  },
];

const trustSignals = [
  ["Role Based Access", "Every portal opens only the role scope assigned to that user.", LockKeyhole],
  ["Portal Isolation", "Dealer, bank, executive, and finance surfaces stay separated.", ShieldCheck],
  ["Audit Logs", "Operational movement remains traceable for governance review.", FileCheck2],
  ["Workflow Visibility", "Teams see case movement without changing the underlying process.", Network],
  ["Secure Operations", "Access, approvals, and status handling remain controlled end to end.", CheckCircle2],
];

const platformRows = [
  ["CLS-2048", "Verna SX", "Bank review", "HDFC - Pune", "18 min"],
  ["CLS-2054", "Creta", "Docs requested", "SBI - Jaipur", "32 min"],
  ["CLS-2061", "Baleno", "Disbursal queued", "Axis - Delhi", "8 min"],
];

const dealershipBenefits = [
  ["Track every case easily", "See all active, pending, approved, rejected, and disbursed cases from one secure dashboard."],
  ["No more manual status chasing", "Finance teams no longer need repeated calls or WhatsApp follow-ups to know where a case stands."],
  ["Manage salespersons and finance staff", "Add, remove, and monitor salespersons and finance staff with clear role-based visibility."],
  ["Move beyond Excel sheets", "Keep dealership finance data organized in one platform instead of scattered files and manual registers."],
  ["Meeting-ready case status", "Open the dashboard during reviews and immediately see every case status, team workload, and bank movement."],
  ["Secure dealership data", "Customer case data, documents, status, and workflow history stay protected inside controlled portals."],
];

const bankBenefits = [
  ["All car loan cases in one place", "Receive dealership cases through one platform instead of depending on scattered branch or field follow-ups."],
  ["Know every executive's workload", "Track loan executive details, assigned cases, pending actions, and status movement from the bank portal."],
  ["Continuous case inflow", "Keep receiving cases even when a specific executive is not physically present at a dealership."],
  ["No more manual status calls", "Branch managers can see case progress directly instead of asking teams for repeated updates."],
  ["Reduce dealership dependency", "Executives do not need to sit across different dealerships just to collect or follow up on cases."],
  ["Clear branch performance view", "See case volume, movement, and outcomes in one place for faster operational decisions."],
];

const journeyStages = [
  ["Customer", "Case created"],
  ["Dealership", "Finance desk reviews"],
  ["Bank Branch", "Branch receives"],
  ["Loan Executive", "Field action"],
  ["Disbursed", "Journey complete"],
];

const lifecycleStatuses = ["Created", "Assigned", "Documents Pending", "Approved", "Disbursed"];

const animatedKpis = [
  ["Total Cases", 1284, "from all dealerships"],
  ["Approved", 418, "ready for next action"],
  ["Pending", 173, "needs attention"],
  ["Disbursed", 296, "completed cases"],
  ["Finance Managers", 42, "active users"],
  ["Bank Branches", 86, "connected partners"],
];

const notificationFeed = [
  ["Case Assigned", "CLS-1024 moved to HDFC Pune"],
  ["Document Uploaded", "Bank statement received"],
  ["Status Updated", "Documents pending review"],
  ["Approved", "CLS-1024 approved by branch"],
  ["Disbursed", "Final disbursement marked"],
];

const comparisonBefore = [
  ["Excel", Table2],
  ["WhatsApp", MessageCircle],
  ["Phone Calls", PhoneCall],
  ["Manual Tracking", FileText],
];

const comparisonAfter = [
  ["Centralized Platform", LayoutDashboard],
  ["Case Visibility", Network],
  ["Role-Based Access", LockKeyhole],
  ["Workflow Management", CheckCircle2],
];

function SectionHeader({ eyebrow, title, text }) {
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

function PortalLink({ to, label, variant = "primary" }) {
  const styles = {
    dealer: "border-blue-100 bg-blue-50 text-blue-800 hover:border-blue-200 hover:bg-blue-100",
    bank: "border-emerald-100 bg-emerald-50 text-emerald-800 hover:border-emerald-200 hover:bg-emerald-100",
    head: "border-amber-100 bg-amber-50 text-amber-800 hover:border-amber-200 hover:bg-amber-100",
    executive: "border-violet-100 bg-violet-50 text-violet-800 hover:border-violet-200 hover:bg-violet-100",
    primary: "border-blue-100 bg-blue-50 text-blue-800 hover:border-blue-200 hover:bg-blue-100",
  };
  const className = `group inline-flex h-12 min-w-[11rem] items-center justify-center whitespace-nowrap rounded-full border px-5 text-sm font-semibold leading-none transition hover:-translate-y-0.5 public-soft-shadow ${styles[variant] || styles.primary}`;

  return (
    <Link to={to} className={className}>
      {label}
      <ArrowRight className="ml-2 h-4 w-4 transition group-hover:translate-x-0.5" />
    </Link>
  );
}

function DashboardMockup() {
  return (
    <div className="relative mx-auto w-full max-w-2xl public-fade-in">
      <div className="absolute -left-8 top-12 hidden rounded-2xl bg-white/80 p-4 public-glass public-float lg:block">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">SLA</p>
        <p className="mt-1 text-2xl font-semibold text-slate-950">42 min</p>
        <p className="text-xs text-emerald-600">Response tracking live</p>
      </div>
      <div className="absolute -right-6 bottom-10 hidden rounded-2xl bg-white/85 p-4 public-glass public-float-delayed lg:block">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Queue</p>
        <p className="mt-1 text-2xl font-semibold text-slate-950">247</p>
        <p className="text-xs text-blue-700">Cases in motion</p>
      </div>

      <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 public-premium-shadow">
        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-5 py-4">
          <span className="h-3 w-3 rounded-full bg-red-400" />
          <span className="h-3 w-3 rounded-full bg-amber-400" />
          <span className="h-3 w-3 rounded-full bg-emerald-400" />
          <span className="ml-3 rounded-full bg-white px-4 py-1 text-xs font-medium text-slate-500">platform.carloansaathi</span>
        </div>
        <div className="grid gap-0 md:grid-cols-[170px_1fr]">
          <aside className="hidden border-r border-slate-100 bg-slate-950 p-4 text-white md:block">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-200">Workspace</p>
            {["Cases", "Bank Routing", "Documents", "Status", "Analytics"].map((item, index) => (
              <div
                key={item}
                className={`mt-3 rounded-xl px-3 py-2 text-sm ${index === 0 ? "bg-white text-slate-950" : "text-slate-300"}`}
              >
                {item}
              </div>
            ))}
          </aside>
          <div className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Live workflow</p>
                <h3 className="mt-2 text-xl font-semibold text-slate-950">Dealer to bank coordination</h3>
              </div>
              <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Operational</div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {["New cases", "Bank review", "Disbursed"].map((label, index) => (
                <div key={label} className="rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-blue-50 p-4">
                  <p className="text-xs font-medium text-slate-500">{label}</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">{[48, 126, 73][index]}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl border border-slate-100">
              {platformRows.map(([id, vehicle, status, branch, time]) => (
                <div key={id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-slate-100 bg-white px-4 py-3 last:border-b-0 sm:grid-cols-[0.8fr_0.9fr_1fr_auto]">
                  <div>
                    <p className="text-xs font-semibold text-slate-400">{id}</p>
                    <p className="text-sm font-semibold text-slate-900">{vehicle}</p>
                  </div>
                  <p className="hidden text-sm font-medium text-slate-600 sm:block">{status}</p>
                  <p className="hidden text-sm text-slate-500 sm:block">{branch}</p>
                  <p className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">{time}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShowcaseMock({ card }) {
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

function CountUpMetric({ value }) {
  const [count, setCount] = useState(value);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      setCount(value);
      return undefined;
    }
    let frame = 0;
    let start = 0;
    const duration = 1200;
    const tick = (timestamp) => {
      if (!start) start = timestamp;
      const progress = Math.min((timestamp - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(value * eased));
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value]);

  return <span>{count.toLocaleString("en-IN")}</span>;
}

function AnimatedWorkflow() {
  return (
    <article className="rounded-[2rem] border border-blue-100 bg-white p-6 public-soft-shadow">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">Automated journey</p>
          <h3 className="mt-2 text-xl font-semibold text-slate-950">Customer to disbursement</h3>
        </div>
        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">Live loop</span>
      </div>
      <div className="mt-6 grid gap-3">
        {journeyStages.map(([title, text], index) => (
          <div key={title} className="relative grid grid-cols-[2.5rem_1fr] gap-3">
            <div className="relative flex justify-center">
              {index < journeyStages.length - 1 && (
                <div className="absolute top-10 h-[calc(100%+0.75rem)] w-px overflow-hidden bg-blue-100">
                  <span className="public-flow-y absolute left-0 top-0 h-12 w-px bg-blue-500" style={{ animationDelay: `${index * 0.18}s` }} />
                </div>
              )}
              <div
                className="public-stage-glow relative z-10 flex h-10 w-10 items-center justify-center rounded-2xl border border-blue-100 bg-white text-sm font-semibold text-blue-700"
                style={{ animationDelay: `${index * 0.42}s` }}
              >
                {index + 1}
              </div>
            </div>
            <div
              className="public-soft-pulse rounded-2xl border border-slate-100 bg-gradient-to-r from-white to-blue-50/70 px-4 py-3"
              style={{ animationDelay: `${index * 0.42}s` }}
            >
              <p className="text-sm font-semibold text-slate-950">{title}</p>
              <p className="mt-1 text-xs text-slate-500">{text}</p>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function CaseLifecycleDemo() {
  return (
    <article className="rounded-[2rem] border border-emerald-100 bg-gradient-to-br from-white to-emerald-50 p-6 public-soft-shadow">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-600">Case lifecycle</p>
      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold text-slate-950">CLS-1024</h3>
          <p className="mt-1 text-sm text-slate-600">A loan case moving automatically through the platform.</p>
        </div>
        <BadgeCheck className="h-6 w-6 text-emerald-600" />
      </div>
      <div className="mt-6 grid gap-3">
        {lifecycleStatuses.map((status, index) => (
          <div
            key={status}
            className="public-lifecycle-pulse flex items-center justify-between rounded-2xl border border-emerald-100 bg-white px-4 py-3"
            style={{ animationDelay: `${index * 0.45}s` }}
          >
            <span className="text-sm font-semibold text-slate-800">{status}</span>
            <span className="public-dot-pulse h-2.5 w-2.5 rounded-full bg-emerald-500" style={{ animationDelay: `${index * 0.45}s` }} />
          </div>
        ))}
      </div>
    </article>
  );
}

function DashboardShowcaseAnimation() {
  return (
    <article className="rounded-[2rem] border border-slate-200 bg-white p-6 public-soft-shadow">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">Dashboard animation</p>
      <h3 className="mt-2 text-xl font-semibold text-slate-950">KPI cards that make operations visible</h3>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {animatedKpis.map(([label, value, note], index) => (
          <div
            key={label}
            className="public-fade-in rounded-2xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-4 transition-transform duration-200 hover:-translate-y-1"
            style={{ animationDelay: `${index * 0.06}s` }}
          >
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950">
              <CountUpMetric value={value} />
            </p>
            <p className="mt-1 text-xs text-blue-700">{note}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function ConnectivityAnimation() {
  const nodes = ["Dealership", "Bank Branch", "Executive", "Disbursement"];
  return (
    <article className="rounded-[2rem] border border-blue-100 bg-gradient-to-br from-white to-blue-50 p-6 public-soft-shadow">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">Connectivity flow</p>
      <h3 className="mt-2 text-xl font-semibold text-slate-950">Dealer, bank, and executive stay connected</h3>
      <div className="mt-7 grid gap-4 md:grid-cols-4">
        {nodes.map((node, index) => (
          <div key={node} className="relative">
            {index < nodes.length - 1 && (
              <div className="absolute left-1/2 top-6 hidden h-px w-full overflow-hidden bg-blue-100 md:block">
                <span className="public-flow-x absolute top-0 h-px w-16 bg-blue-500" style={{ animationDelay: `${index * 0.2}s` }} />
              </div>
            )}
            <div
              className="public-node-float relative z-10 rounded-2xl border border-white bg-white p-4 text-center public-soft-shadow"
              style={{ animationDelay: `${index * 0.25}s` }}
            >
              <Network className="mx-auto h-5 w-5 text-blue-700" />
              <p className="mt-3 text-sm font-semibold text-slate-900">{node}</p>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function NotificationShowcase() {
  return (
    <article className="rounded-[2rem] border border-amber-100 bg-gradient-to-br from-white to-amber-50 p-6 public-soft-shadow">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-600">Realtime updates</p>
          <h3 className="mt-2 text-xl font-semibold text-slate-950">Notifications appear as work moves</h3>
        </div>
        <Bell className="h-6 w-6 text-amber-600" />
      </div>
      <div className="mt-6 space-y-3">
        {notificationFeed.map(([title, text], index) => (
          <div
            key={title}
            className="public-notification-pulse rounded-2xl border border-amber-100 bg-white px-4 py-3"
            style={{ animationDelay: `${index * 0.5}s` }}
          >
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            <p className="mt-1 text-xs text-slate-500">{text}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function BeforeAfterComparison() {
  return (
    <article className="rounded-[2rem] border border-slate-200 bg-white p-6 public-soft-shadow">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">Before vs After</p>
      <h3 className="mt-2 text-xl font-semibold text-slate-950">From manual follow-up to controlled workflow</h3>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-red-100 bg-red-50/70 p-4">
          <p className="text-sm font-semibold text-red-700">Before</p>
          <div className="mt-4 grid gap-3">
            {comparisonBefore.map(([label, Icon]) => (
              <div key={label} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2">
                <Icon className="h-4 w-4 text-red-500" />
                <span className="text-sm font-semibold text-slate-700">{label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4">
          <p className="text-sm font-semibold text-emerald-700">After</p>
          <div className="mt-4 grid gap-3">
            {comparisonAfter.map(([label, Icon]) => (
              <div
                key={label}
                className="flex items-center gap-3 rounded-xl bg-white px-3 py-2 transition-transform duration-200 hover:translate-x-1"
              >
                <Icon className="h-4 w-4 text-emerald-600" />
                <span className="text-sm font-semibold text-slate-700">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

function EnterpriseAutomationSection() {
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

export function HomePage() {
  return (
    <main id="home" className="w-full overflow-x-hidden bg-white text-slate-950">
      <section className="relative overflow-hidden bg-[radial-gradient(circle_at_top_left,#dbeafe_0%,#ffffff_34%,#f8fafc_100%)] px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="public-gradient-orb absolute -left-28 top-16 h-72 w-72 rounded-full bg-blue-300/30 blur-3xl" />
        <div className="public-gradient-orb absolute right-0 top-0 h-96 w-96 rounded-full bg-cyan-200/40 blur-3xl" />

        <div className="relative mx-auto grid w-full max-w-7xl items-center gap-12 lg:grid-cols-[1fr_1.05fr]">
          <div className="public-fade-in">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white/80 px-4 py-2 text-sm font-semibold text-blue-700 public-glass">
              <Sparkles className="h-4 w-4" />
              Enterprise dealer-bank connectivity platform
            </div>
            <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-[1.05] tracking-[-0.055em] text-slate-950 sm:text-6xl lg:text-7xl">
              Loan workflow management built for modern dealership operations.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              CarLoanSaathi connects dealerships, finance teams, bank branches, and executives through a controlled platform for case tracking, bank coordination, and operational visibility.
            </p>
            <div className="mt-8 flex max-w-4xl flex-col gap-3 sm:flex-row sm:flex-wrap">
              <PortalLink to="/dealer/login" label="Dealer Login" variant="dealer" />
              <PortalLink to="/bank/login" label="Bank Login" variant="bank" />
              <PortalLink to="/finance/login" label="Dealership Head Login" variant="head" />
              <PortalLink to="/executive/login" label="Loan Executive Login" variant="executive" />
            </div>
            <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {heroMetrics.map(([value, label, note]) => (
                <div key={label} className="rounded-2xl border border-white bg-white/80 p-4 public-soft-shadow">
                  <p className="public-counter text-2xl font-semibold tracking-[-0.03em] text-slate-950">{value}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">{label}</p>
                  <p className="mt-2 text-[11px] font-semibold text-blue-700">{note}</p>
                </div>
              ))}
            </div>
          </div>

          <DashboardMockup />
        </div>
      </section>

      <section id="about" className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          <div className="public-fade-in">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">About CarLoanSaathi</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.03em] text-slate-950 sm:text-4xl">
              A professional operating layer between dealerships and banks.
            </h2>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ["Case Tracking", "See where a case stands across permitted operational roles."],
              ["Bank Coordination", "Keep branch ownership, executive movement, and decisions visible."],
              ["Dealership Operations", "Help finance desks manage cases, teams, and bank tie-ups."],
              ["Governance Ready", "Preserve workflow visibility, audit trails, and access boundaries."],
            ].map(([title, text]) => (
              <article key={title} className="rounded-[1.5rem] border border-slate-200 bg-white p-5 public-soft-shadow public-fade-in">
                <h3 className="text-base font-semibold text-slate-950">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white px-4 pb-16 sm:px-6 sm:pb-20 lg:px-8">
        <div className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-2">
          <article id="dealerships" className="rounded-[2rem] border border-slate-200 bg-gradient-to-br from-white to-blue-50 p-7 public-soft-shadow public-fade-in">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-700 text-white">
              <Building2 className="h-6 w-6" />
            </div>
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">Benefits for Dealerships</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-slate-950">Run dealership finance without Excel, repeated calls, or status confusion.</h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              CarLoanSaathi gives dealership owners and finance heads one convenient, advanced, easy-to-operate workspace for cases, salespersons, finance staff, and bank movement.
            </p>
            <div className="mt-6 grid gap-3">
              {dealershipBenefits.map(([title, text]) => (
                <div key={title} className="flex items-start gap-3 rounded-2xl bg-white px-4 py-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{title}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article id="banks" className="rounded-[2rem] border border-emerald-100 bg-gradient-to-br from-white to-emerald-50 p-7 public-soft-shadow public-fade-in">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white">
              <Landmark className="h-6 w-6" />
            </div>
            <p className="mt-6 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-600">Benefits for Banks</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-slate-950">Receive more cases with less field dependency and clearer executive control.</h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              Banks get one branch workspace to receive dealership cases, track loan executives, monitor status, and keep case flow moving continuously.
            </p>
            <div className="mt-6 grid gap-3">
              {bankBenefits.map(([title, text]) => (
                <div key={title} className="flex items-start gap-3 rounded-2xl bg-white px-4 py-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{title}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      <EnterpriseAutomationSection />

      <section id="showcase" className="bg-slate-50 px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <SectionHeader
            eyebrow="Product Showcase"
            title="Dashboards for every operational role."
            text="A premium public preview of the platform experience without loading portal data or calling internal APIs."
          />
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {showcaseCards.map((card) => (
              <ShowcaseMock key={card.title} card={card} />
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <SectionHeader
            eyebrow="Workflow Overview"
            title="Dealer to disbursement, visualized in one connected flow."
            text="The public website now shows the platform motion clearly while keeping the actual internal workflow unchanged."
          />
          <div className="mt-12 grid gap-4 lg:grid-cols-5">
            {workflowCards.map(([title, text, Icon], index) => (
              <article key={title} className="relative rounded-[1.5rem] border border-slate-200 bg-white p-5 public-soft-shadow public-fade-in">
                {index < workflowCards.length - 1 && (
                  <div className="absolute -right-4 top-1/2 z-10 hidden h-px w-8 bg-gradient-to-r from-blue-300 to-transparent lg:block" />
                )}
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
                  <Icon className="h-6 w-6" />
                </div>
                <p className="mt-5 text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">Step {index + 1}</p>
                <h3 className="mt-2 text-xl font-semibold text-slate-950">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="trust" className="bg-[linear-gradient(135deg,#eff6ff_0%,#ffffff_48%,#f8fafc_100%)] px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <SectionHeader
            eyebrow="Enterprise Trust"
            title="Built around controlled access and operational confidence."
            text="The design highlights the production-grade qualities dealership owners and bank teams need to trust the platform."
          />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {trustSignals.map(([title, text, Icon]) => (
              <article key={title} className="rounded-[1.5rem] border border-white bg-white/85 p-5 public-glass public-fade-in">
                <Icon className="h-6 w-6 text-blue-700" />
                <h3 className="mt-4 text-base font-semibold text-slate-950">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="contact" className="px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto grid w-full max-w-7xl gap-8 overflow-hidden rounded-[2rem] bg-slate-950 p-8 text-white public-premium-shadow lg:grid-cols-[1fr_auto] lg:items-center lg:p-10">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-200">Platform Access</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">Continue through your dedicated portal.</h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-blue-100">
              Approved dealerships, bank branches, finance heads, and loan executives can use their existing login paths. Public access paths remain disabled without deleting operational data or internal workflows.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <PortalLink to="/dealer/login" label="Dealer Login" variant="dealer" />
            <PortalLink to="/bank/login" label="Bank Login" variant="bank" />
            <PortalLink to="/finance/login" label="Dealership Head Login" variant="head" />
            <PortalLink to="/executive/login" label="Loan Executive Login" variant="executive" />
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-white px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col justify-between gap-5 text-sm text-slate-500 sm:flex-row">
          <p>(c) 2026 CarLoanSaathi. Dealer-bank connectivity for controlled loan workflow management.</p>
          <p className="flex items-center gap-2"><Phone className="h-4 w-4" /> Platform access managed by operations.</p>
        </div>
      </footer>
    </main>
  );
}
