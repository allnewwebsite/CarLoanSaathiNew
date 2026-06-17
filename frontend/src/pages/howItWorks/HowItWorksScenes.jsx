import { Banknote, Car, Check, CheckCircle2, Landmark, Network, XCircle } from "lucide-react";
import { motion } from "./howItWorksMotion.jsx";

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

export function CustomerScene() {
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

export function DealershipScene() {
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

export function DocumentsScene() {
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

export function PlatformHub() {
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

export function BankScene() {
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

export function ResultScene() {
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
