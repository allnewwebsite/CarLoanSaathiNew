import {
  ArrowDown,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Building2,
  Car,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileText,
  Landmark,
  LockKeyhole,
  Network,
  Phone,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  Workflow,
  XCircle,
} from "lucide-react";
import { motion, MotionConfig, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

const ease = [0.22, 1, 0.36, 1];
const reveal = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.16 },
  transition: { duration: 0.65, ease },
};

const benefits = [
  ["Real-Time Tracking", Clock3],
  ["Centralized Workflow", Workflow],
  ["Secure Documents", LockKeyhole],
  ["Dealer Visibility", Building2],
  ["Bank Visibility", Landmark],
  ["Unlimited Leads", Users],
  ["Activity Timeline", ClipboardCheck],
  ["Case History", FileText],
  ["Workflow Monitoring", ScanSearch],
];

const networkNodes = [
  ["Customer", UserRound],
  ["Salesperson", Users],
  ["Finance Desk", FileCheck2],
  ["CarLoanSaathi", Workflow],
  ["Bank", Landmark],
  ["Result", BadgeCheck],
];

function SectionTitle({ eyebrow, title, copy }) {
  return (
    <motion.div {...reveal} className="mx-auto max-w-3xl text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-600">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.04em] text-slate-950 sm:text-5xl">{title}</h2>
      {copy ? <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-600">{copy}</p> : null}
    </motion.div>
  );
}

function Person({ role = "customer", walking = false }) {
  const colors = role === "bank"
    ? ["#0f766e", "#ecfeff", "#0f172a"]
    : role === "finance"
      ? ["#2563eb", "#eff6ff", "#1e293b"]
      : ["#334155", "#ffffff", "#1e3a8a"];
  return (
    <motion.svg
      viewBox="0 0 120 190"
      className="h-36 w-24 overflow-visible sm:h-44 sm:w-28"
      aria-hidden="true"
      animate={walking ? { x: [0, 10, 0] } : { y: [0, -3, 0] }}
      transition={{ duration: walking ? 1.2 : 3, repeat: Infinity, ease: "easeInOut" }}
    >
      <circle cx="60" cy="28" r="20" fill="#d8a47f" />
      <path d="M43 22c4-18 31-20 37 0-9-6-28-6-37 0Z" fill="#263238" />
      <rect x="36" y="50" width="48" height="68" rx="16" fill={colors[0]} />
      <path d="M49 53h22l-4 42H53Z" fill={colors[1]} />
      <motion.path d="M39 65 18 105" stroke="#d8a47f" strokeWidth="12" strokeLinecap="round" animate={walking ? { d: ["M39 65 18 105", "M39 65 25 113", "M39 65 18 105"] } : undefined} transition={{ duration: 0.6, repeat: Infinity }} />
      <motion.path d="M81 65 101 105" stroke="#d8a47f" strokeWidth="12" strokeLinecap="round" animate={walking ? { d: ["M81 65 101 105", "M81 65 94 112", "M81 65 101 105"] } : undefined} transition={{ duration: 0.6, repeat: Infinity }} />
      <rect x="43" y="113" width="18" height="55" rx="8" fill={colors[2]} />
      <rect x="64" y="113" width="18" height="55" rx="8" fill={colors[2]} />
      <motion.path d="M50 165 38 184" stroke="#172033" strokeWidth="12" strokeLinecap="round" animate={walking ? { d: ["M50 165 38 184", "M50 165 61 184", "M50 165 38 184"] } : undefined} transition={{ duration: 0.6, repeat: Infinity }} />
      <motion.path d="M74 165 86 184" stroke="#172033" strokeWidth="12" strokeLinecap="round" animate={walking ? { d: ["M74 165 86 184", "M74 165 63 184", "M74 165 86 184"] } : undefined} transition={{ duration: 0.6, repeat: Infinity }} />
      {role === "customer" ? <rect x="91" y="91" width="15" height="25" rx="3" fill="#0f172a" /> : null}
    </motion.svg>
  );
}

function FloatingChip({ children, delay = 0, className = "", style }) {
  return (
    <span className={`absolute ${className}`} style={style}>
      <motion.span
        className="block rounded-full border border-blue-100 bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-slate-700 shadow-sm"
        animate={{ y: [0, -7, 0] }}
        transition={{ duration: 3.4, repeat: Infinity, delay, ease: "easeInOut" }}
      >
        {children}
      </motion.span>
    </span>
  );
}

function CustomerScene() {
  return (
    <div className="relative flex h-72 items-end justify-center overflow-hidden rounded-lg bg-gradient-to-b from-sky-50 to-white p-5">
      <div className="absolute bottom-5 left-5 right-5 h-1 rounded-full bg-slate-200" />
      <motion.div animate={{ x: [-24, 18, -24] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}><Person walking /></motion.div>
      <Car className="absolute bottom-7 right-5 h-20 w-20 text-blue-200" strokeWidth={1.2} />
      <FloatingChip className="left-4 top-5">Need a new car</FloatingChip>
      <FloatingChip className="right-3 top-16" delay={0.5}>Looking for financing</FloatingChip>
      <FloatingChip className="left-8 top-28" delay={1}>Vehicle selected</FloatingChip>
      <FloatingChip className="right-5 top-40" delay={1.5}>Loan enquiry created</FloatingChip>
    </div>
  );
}

function DealershipScene() {
  return (
    <div className="relative flex h-72 items-end justify-center overflow-hidden rounded-lg bg-gradient-to-b from-indigo-50 to-white p-5">
      <div className="absolute bottom-7 left-8 h-16 w-48 rounded-lg border border-slate-200 bg-white shadow-sm" />
      <Person role="finance" />
      <motion.div className="absolute right-4 top-8 w-40 rounded-lg border border-blue-100 bg-white p-3 shadow-lg" animate={{ y: [0, -8, 0] }} transition={{ duration: 3, repeat: Infinity }}>
        <p className="text-[10px] font-semibold text-blue-600">CLS-2048</p>
        {["Customer Data", "Vehicle Details", "Loan Request", "Documents Pending"].map((line, index) => (
          <motion.div key={line} className="mt-2 flex items-center gap-2 text-[10px] text-slate-600" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 2.4, delay: index * 0.35, repeat: Infinity }}>
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />{line}
          </motion.div>
        ))}
      </motion.div>
      <motion.div className="absolute bottom-20 left-[44%] h-1 w-8 rounded bg-blue-500" animate={{ scaleX: [0.2, 1, 0.2] }} transition={{ duration: 0.8, repeat: Infinity }} />
    </div>
  );
}

function DocumentsScene() {
  return (
    <div className="relative flex h-72 items-end justify-center overflow-hidden rounded-lg bg-gradient-to-b from-cyan-50 to-white p-5">
      <Person role="finance" />
      <motion.div className="absolute bottom-6 right-7 h-20 w-28 rounded-lg border border-blue-200 bg-blue-50" animate={{ scale: [1, 1.03, 1] }} transition={{ duration: 2, repeat: Infinity }}><div className="absolute -top-3 left-4 h-4 w-16 rounded-t bg-blue-100" /></motion.div>
      {["PAN", "Aadhaar", "Address Proof", "Income Proof"].map((item, index) => (
        <motion.div key={item} className="absolute left-5 top-5 flex w-28 items-center justify-between rounded-md border border-slate-200 bg-white px-2 py-2 text-[10px] font-semibold text-slate-600 shadow-sm" animate={{ x: [0, 155], y: [index * 42, 185 - index * 8], opacity: [0, 1, 1, 0] }} transition={{ duration: 3.6, repeat: Infinity, delay: index * 0.65, ease: "easeInOut" }}>
          {item}<Check className="h-3 w-3 text-emerald-600" />
        </motion.div>
      ))}
    </div>
  );
}

function PlatformHub() {
  const statuses = ["Tracked", "Verified", "Assigned", "Updated", "Monitored", "Visible", "Connected"];
  return (
    <div className="relative min-h-[28rem] overflow-hidden rounded-lg border border-blue-100 bg-[radial-gradient(circle_at_center,#dbeafe_0%,#eff6ff_34%,#ffffff_72%)] p-5">
      <div className="absolute inset-0 opacity-60 [background-image:linear-gradient(#dbeafe_1px,transparent_1px),linear-gradient(90deg,#dbeafe_1px,transparent_1px)] [background-size:28px_28px]" />
      {[0, 1, 2, 3].map((index) => <motion.span key={index} className="absolute h-2 w-2 rounded-full bg-blue-500" style={{ top: `${22 + index * 17}%`, left: "8%" }} animate={{ x: [0, 410], opacity: [0, 1, 1, 0] }} transition={{ duration: 3.4, delay: index * 0.55, repeat: Infinity, ease: "linear" }} />)}
      <div className="absolute left-1/2 top-1/2 w-[72%] -translate-x-1/2 -translate-y-1/2">
        <motion.div className="rounded-lg border border-white bg-white/85 p-5 shadow-xl backdrop-blur-md" animate={{ scale: [1, 1.015, 1] }} transition={{ duration: 4, repeat: Infinity }}>
          <div className="flex items-center justify-between">
            <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-600">Live workflow hub</p><p className="mt-1 text-lg font-semibold text-slate-950">CarLoanSaathi</p></div>
            <Network className="h-7 w-7 text-blue-600" />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2">
            {[["Active", "1,284"], ["In review", "126"], ["Disbursed", "296"]].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><p className="text-[9px] text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold text-slate-900">{value}</p></div>)}
          </div>
          <motion.div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3" animate={{ x: [-6, 6, -6] }} transition={{ duration: 3, repeat: Infinity }}>
            <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-blue-800">CLS-2048</span><span className="rounded-full bg-white px-2 py-1 text-[9px] font-semibold text-blue-700">Under Bank Process</span></div>
          </motion.div>
        </motion.div>
      </div>
      {statuses.map((status, index) => {
        const angle = (Math.PI * 2 * index) / statuses.length;
        return <FloatingChip key={status} delay={index * 0.2} className="-translate-x-1/2 -translate-y-1/2" style={{ left: `${50 + Math.cos(angle) * 40}%`, top: `${50 + Math.sin(angle) * 42}%` }}>{status}</FloatingChip>;
      })}
    </div>
  );
}

function BankScene() {
  const statuses = ["Contacted", "Document Received", "Under Bank Process", "Review Complete"];
  return (
    <div className="relative h-72 overflow-hidden rounded-lg bg-gradient-to-b from-emerald-50 to-white p-5">
      <Landmark className="absolute bottom-5 left-4 h-32 w-32 text-emerald-700" strokeWidth={1.1} />
      <div className="absolute bottom-4 right-7"><Person role="bank" /></div>
      <div className="absolute right-4 top-5 w-44 space-y-2">
        {statuses.map((status, index) => (
          <motion.div key={status} className="rounded-md border border-emerald-100 bg-white p-2 shadow-sm" animate={{ opacity: [0.45, 1, 0.45] }} transition={{ duration: 3, repeat: Infinity, delay: index * 0.6 }}>
            <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-700"><span className="h-2 w-2 rounded-full bg-emerald-500" />{status}</div>
            <motion.div className="mt-2 h-1 rounded-full bg-emerald-500" initial={{ width: "10%" }} animate={{ width: "100%" }} transition={{ duration: 2.5, repeat: Infinity, delay: index * 0.6 }} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function ResultScene() {
  return (
    <div className="grid h-72 overflow-hidden rounded-lg sm:grid-cols-2">
      <motion.div className="flex flex-col items-center justify-center bg-emerald-50 p-5 text-center" animate={{ backgroundColor: ["#ecfdf5", "#d1fae5", "#ecfdf5"] }} transition={{ duration: 4, repeat: Infinity }}>
        <CheckCircle2 className="h-12 w-12 text-emerald-600" /><p className="mt-3 text-xl font-semibold text-emerald-900">Approved</p><p className="mt-1 text-sm text-emerald-700">Disbursed</p><p className="text-sm text-emerald-700">Vehicle Delivered</p>
        <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 1.8, repeat: Infinity }}><Banknote className="mt-3 h-8 w-8 text-emerald-600" /></motion.div>
      </motion.div>
      <div className="flex flex-col items-center justify-center bg-orange-50 p-5 text-center">
        <XCircle className="h-12 w-12 text-orange-500" /><p className="mt-3 text-xl font-semibold text-orange-900">Rejected</p>
        {["Remark Added", "History Preserved", "Audit Trail Available"].map((line, index) => <motion.p key={line} className="mt-1 text-sm text-orange-700" animate={{ opacity: [0.45, 1, 0.45] }} transition={{ duration: 2.5, delay: index * 0.4, repeat: Infinity }}>{line}</motion.p>)}
      </div>
    </div>
  );
}

function StoryStage({ number, title, caption, children }) {
  return (
    <motion.article {...reveal} className="snap-center rounded-lg border border-slate-200 bg-white p-3 shadow-sm lg:min-w-[32rem]">
      <div className="mb-3 flex items-center justify-between px-2 pt-2">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-600">Stage {number}</p><h3 className="mt-1 text-xl font-semibold text-slate-950">{title}</h3></div>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700">{number}</span>
      </div>
      {children}<p className="px-2 pb-2 pt-4 text-sm leading-6 text-slate-600">{caption}</p>
    </motion.article>
  );
}

function NetworkSection() {
  return (
    <section className="bg-gradient-to-b from-white to-blue-50 px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionTitle eyebrow="Live Data Network" title="Every participant stays connected." copy="Status, documents, and case movement travel through one visible operating network." />
        <motion.div {...reveal} className="relative mt-14 grid gap-5 sm:grid-cols-3 lg:grid-cols-6">
          <div className="absolute left-[8%] right-[8%] top-10 hidden h-px bg-blue-200 lg:block" />
          <motion.span className="absolute left-[8%] top-[37px] hidden h-2 w-2 rounded-full bg-blue-600 lg:block" animate={{ left: ["8%", "91%"], opacity: [0, 1, 1, 0] }} transition={{ duration: 4.5, repeat: Infinity, ease: "linear" }} />
          {networkNodes.map(([label, Icon], index) => (
            <motion.div key={label} className="relative z-10 rounded-lg border border-white bg-white/90 p-5 text-center shadow-sm backdrop-blur-sm" animate={{ y: [0, -6, 0] }} transition={{ duration: 3.2, repeat: Infinity, delay: index * 0.22 }}>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Icon className="h-6 w-6" /></div><p className="mt-3 text-sm font-semibold text-slate-900">{label}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

export function HowItWorksPage() {
  const reducedMotion = useReducedMotion();
  const heroRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroY = useTransform(scrollYProgress, [0, 1], [0, reducedMotion ? 0 : 90]);

  useEffect(() => {
    const oldTitle = document.title;
    document.title = "How It Works | CarLoanSaathi";
    let meta = document.querySelector('meta[name="description"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    const oldDescription = meta.content;
    meta.content = "See how CarLoanSaathi moves a vehicle loan enquiry from dealership and secure documents to bank review, decision, and disbursement.";
    return () => {
      document.title = oldTitle;
      if (created) meta.remove();
      else meta.content = oldDescription;
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <main className="bg-white text-slate-700">
      <section ref={heroRef} className="relative flex min-h-[calc(100vh-4rem)] items-center overflow-hidden bg-[linear-gradient(135deg,#f8fbff_0%,#eef6ff_45%,#ffffff_100%)] px-4 py-20 sm:px-6 lg:px-8">
        <motion.div style={{ y: heroY }} className="absolute -left-32 top-20 h-80 w-80 rounded-full bg-blue-200/35 blur-3xl" />
        <motion.div className="absolute -right-28 bottom-10 h-96 w-96 rounded-full bg-cyan-200/30 blur-3xl" animate={reducedMotion ? undefined : { scale: [1, 1.12, 1], x: [0, -24, 0] }} transition={{ duration: 9, repeat: Infinity }} />
        <div className="relative mx-auto grid w-full max-w-7xl gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div className="min-w-0">
            <motion.p {...reveal} className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-blue-700 shadow-sm"><Sparkles className="h-4 w-4" />How the workflow moves</motion.p>
            <h1 className="mt-7 text-5xl font-semibold leading-[1.02] tracking-[-0.055em] text-slate-950 sm:text-6xl lg:text-7xl">
              <span className="flex flex-wrap gap-x-[0.22em]">
                {"See Every Loan Move".split(" ").map((word, index) => (
                  <motion.span key={word} className="inline-block" initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.1, duration: 0.55, ease }}>{word}</motion.span>
                ))}
              </span>
              <span className="mt-2 block bg-gradient-to-r from-blue-700 via-cyan-600 to-emerald-600 bg-clip-text text-transparent">From Customer To Disbursement</span>
            </h1>
            <motion.p {...reveal} className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">One platform connecting dealerships, finance teams, loan executives, and banks through a trackable workflow.</motion.p>
            <motion.div {...reveal} className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href="#live-workflow" className="inline-flex h-12 items-center justify-center rounded-full bg-blue-700 px-6 text-sm font-semibold text-white shadow-lg shadow-blue-700/20 transition hover:-translate-y-0.5 hover:bg-blue-800">Watch Workflow <ArrowDown className="ml-2 h-4 w-4" /></a>
              <Link to="/dealer/register" className="inline-flex h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-6 text-sm font-semibold text-slate-800 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200">Start Free Trial <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </motion.div>
          </div>
          <motion.div {...reveal} className="relative min-h-[30rem]"><div className="absolute inset-5 rounded-lg border border-white/80 bg-white/65 shadow-2xl shadow-blue-900/10 backdrop-blur-xl" /><div className="absolute left-1/2 top-1/2 w-[88%] -translate-x-1/2 -translate-y-1/2"><PlatformHub /></div></motion.div>
        </div>
      </section>

      <section id="live-workflow" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionTitle eyebrow="Live Animated Story" title="Follow one enquiry through the complete journey." copy="People, documents, case data, and decisions move together without losing workflow history." />
          <div className="mt-14 flex snap-x gap-5 overflow-x-auto pb-5 lg:grid lg:grid-cols-2 lg:overflow-visible">
            <StoryStage number="1" title="Customer" caption="Customer visits dealership and selects a vehicle."><CustomerScene /></StoryStage>
            <StoryStage number="2" title="Dealership" caption="The salesperson records customer, vehicle, and requested loan details."><DealershipScene /></StoryStage>
            <StoryStage number="3" title="Finance Desk" caption="All customer documents securely managed in one place."><DocumentsScene /></StoryStage>
            <StoryStage number="4" title="CarLoanSaathi Platform" caption="The case stays tracked, verified, assigned, updated, monitored, and visible."><PlatformHub /></StoryStage>
            <StoryStage number="5" title="Bank" caption="The branch and loan officer review documents and update every status."><BankScene /></StoryStage>
            <StoryStage number="6" title="Result" caption="Every decision remains visible with a complete preserved history."><ResultScene /></StoryStage>
          </div>
        </div>
      </section>

      <section className="bg-slate-50 px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionTitle eyebrow="Why It Is Better" title="Everything teams need to stay in control." />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {benefits.map(([label, Icon], index) => (
              <motion.article key={label} {...reveal} transition={{ ...reveal.transition, delay: (index % 3) * 0.08 }} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <motion.div animate={reducedMotion ? undefined : { y: [0, -5, 0] }} transition={{ duration: 3.2, repeat: Infinity, delay: index * 0.15 }} className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Icon className="h-5 w-5" /></motion.div>
                <h3 className="mt-4 text-lg font-semibold text-slate-950">{label}</h3>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <NetworkSection />

      <section className="overflow-hidden px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl text-center">
          <motion.p {...reveal} className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-600">One continuous experience</motion.p>
          <div className="mt-10 space-y-5">
            {["Every Lead Tracked", "Every Document Secured", "Every Status Visible", "Every Workflow Connected", "Every Update Recorded", "One Platform", "Complete Control"].map((line, index, rows) => (
              <div key={line}>
                <motion.p className={`font-semibold tracking-[-0.045em] ${index > 4 ? "text-5xl text-blue-700 sm:text-7xl" : "text-3xl text-slate-900 sm:text-5xl"}`} animate={reducedMotion ? undefined : { opacity: [0.35, 1, 0.35], scale: [0.98, 1, 0.98] }} transition={{ duration: 4, repeat: Infinity, delay: index * 0.42 }}>{line}</motion.p>
                {index < rows.length - 1 ? <ArrowDown className="mx-auto mt-5 h-5 w-5 text-blue-300" /> : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-gradient-to-br from-blue-50 via-white to-cyan-50 px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          {["No Lost Documents", "No Spreadsheet Chaos", "No Blind Follow-Ups", "No Workflow Confusion"].map((line, index) => <motion.p key={line} {...reveal} transition={{ ...reveal.transition, delay: index * 0.08 }} className="border-b border-blue-100 py-5 text-4xl font-semibold tracking-[-0.045em] text-slate-900 sm:text-6xl">{line}</motion.p>)}
          <motion.div {...reveal} className="mt-16 grid gap-3 text-center sm:grid-cols-3">
            {["One Platform", "One Workflow", "One Source Of Truth"].map((line, index) => <motion.div key={line} className="rounded-lg border border-white bg-white/80 p-7 text-2xl font-semibold text-blue-800 shadow-sm backdrop-blur" animate={reducedMotion ? undefined : { y: [0, -5, 0] }} transition={{ duration: 3.5, repeat: Infinity, delay: index * 0.35 }}>{line}</motion.div>)}
          </motion.div>
        </div>
      </section>

      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <motion.div {...reveal} className="mx-auto max-w-6xl overflow-hidden rounded-lg border border-blue-100 bg-[linear-gradient(135deg,#eff6ff_0%,#ffffff_52%,#ecfeff_100%)] p-8 text-center shadow-xl shadow-blue-900/5 sm:p-14">
          <ShieldCheck className="mx-auto h-12 w-12 text-blue-700" />
          <h2 className="mt-6 text-4xl font-semibold tracking-[-0.045em] text-slate-950 sm:text-6xl">Ready To Transform Your Loan Operations?</h2>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/dealer/register" className="inline-flex h-12 items-center justify-center rounded-full bg-blue-700 px-7 text-sm font-semibold text-white shadow-lg shadow-blue-700/20 transition hover:-translate-y-0.5 hover:bg-blue-800">Start 60-Day Free Trial <ArrowRight className="ml-2 h-4 w-4" /></Link>
            <Link to="/plans-and-billing" className="inline-flex h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-7 text-sm font-semibold text-slate-800 transition hover:-translate-y-0.5 hover:border-blue-200">View Plans & Billing</Link>
          </div>
        </motion.div>
      </section>

      <footer className="border-t border-slate-200 bg-white px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-3 text-sm text-slate-500 sm:flex-row"><p>(c) 2026 CarLoanSaathi. Trackable vehicle loan operations.</p><p className="flex items-center gap-2"><Phone className="h-4 w-4" /> Platform access managed by operations.</p></div>
      </footer>
      </main>
    </MotionConfig>
  );
}
