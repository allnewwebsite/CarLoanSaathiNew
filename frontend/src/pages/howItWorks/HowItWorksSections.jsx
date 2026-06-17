import { ArrowDown, Network } from "lucide-react";
import { networkNodes } from "./howItWorks.data.js";
import { motion, reveal } from "./howItWorksMotion.jsx";

export function SectionTitle({ eyebrow, title, copy }) {
  return (
    <motion.div {...reveal} className="mx-auto max-w-3xl text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-600">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.04em] text-slate-950 sm:text-5xl">{title}</h2>
      {copy ? <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-600">{copy}</p> : null}
    </motion.div>
  );
}

export function StoryStage({ number, title, caption, children }) {
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

export function NetworkSection() {
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

export function FinalFlowSection({ reducedMotion }) {
  return (
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
  );
}

export function NetworkIcon() {
  return <Network className="h-7 w-7 text-blue-600" />;
}
