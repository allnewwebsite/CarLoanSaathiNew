import { ArrowDown, Phone, ShieldCheck, Sparkles } from "lucide-react";
import { useRef } from "react";
import { PublicConversionCtas } from "../../components/PublicConversionCtas.jsx";
import { benefits } from "./howItWorks.data.js";
import { MotionConfig, motion, reveal } from "./howItWorksMotion.jsx";
import {
  BankScene,
  CustomerScene,
  DealershipScene,
  DocumentsScene,
  PlatformHub,
  ResultScene,
} from "./HowItWorksScenes.jsx";
import { FinalFlowSection, NetworkSection, SectionTitle, StoryStage } from "./HowItWorksSections.jsx";

export function HowItWorksContent() {
  const reducedMotion = true;
  const heroRef = useRef(null);

  return (
    <MotionConfig reducedMotion="user">
      <main className="bg-white text-slate-700">
        <section ref={heroRef} className="relative flex min-h-[calc(100vh-4rem)] items-center overflow-hidden bg-[linear-gradient(135deg,#f8fbff_0%,#eef6ff_45%,#ffffff_100%)] px-4 py-20 sm:px-6 lg:px-8">
          <motion.div className="absolute -left-32 top-20 h-80 w-80 rounded-full bg-blue-200/35 blur-3xl" />
          <motion.div className="absolute -right-28 bottom-10 h-96 w-96 rounded-full bg-cyan-200/30 blur-3xl" animate={reducedMotion ? undefined : { scale: [1, 1.12, 1], x: [0, -24, 0] }} transition={{ duration: 9, repeat: Infinity }} />
          <div className="relative mx-auto grid w-full max-w-7xl gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div className="min-w-0">
              <motion.p {...reveal} className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-blue-700 shadow-sm"><Sparkles className="h-4 w-4" />How the workflow moves</motion.p>
              <h1 className="mt-7 text-5xl font-semibold leading-[1.02] tracking-[-0.055em] text-slate-950 sm:text-6xl lg:text-7xl">
                <span className="flex flex-wrap gap-x-[0.22em]">
                  {"See Every Loan Move".split(" ").map((word, index) => (
                    <motion.span key={word} className="inline-block" initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.1, duration: 0.55, ease: [0.22, 1, 0.36, 1] }}>{word}</motion.span>
                  ))}
                </span>
                <span className="mt-2 block bg-gradient-to-r from-blue-700 via-cyan-600 to-emerald-600 bg-clip-text text-transparent">From Customer To Disbursement</span>
              </h1>
              <motion.p {...reveal} className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">One platform connecting dealerships, finance teams, loan executives, and banks through a trackable workflow.</motion.p>
              <motion.div {...reveal} className="mt-8">
                <a href="#live-workflow" className="inline-flex h-12 items-center justify-center rounded-full bg-blue-700 px-6 text-sm font-semibold text-white shadow-lg shadow-blue-700/20 transition hover:-translate-y-0.5 hover:bg-blue-800">Watch Workflow <ArrowDown className="ml-2 h-4 w-4" /></a>
                <PublicConversionCtas location="how_it_works_hero" className="mt-5" buttonShape="rounded-full" showContact={false} />
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
        <FinalFlowSection reducedMotion={reducedMotion} />

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
            <h2 className="mt-6 text-4xl font-semibold tracking-[-0.045em] text-slate-950 sm:text-6xl">Ready to Get Started?</h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-600">Evaluate the platform free for 60 days, or choose Professional and complete payment only after dealership approval.</p>
            <PublicConversionCtas location="how_it_works_final_cta" className="mt-8 justify-center" buttonShape="rounded-full" />
          </motion.div>
        </section>

        <footer className="border-t border-slate-200 bg-white px-4 py-8 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-7xl flex-col justify-between gap-3 text-sm text-slate-500 sm:flex-row"><p>(c) 2026 CarLoanSaathi. Trackable vehicle loan operations.</p><p className="flex items-center gap-2"><Phone className="h-4 w-4" /> Platform access managed by operations.</p></div>
        </footer>
      </main>
    </MotionConfig>
  );
}
