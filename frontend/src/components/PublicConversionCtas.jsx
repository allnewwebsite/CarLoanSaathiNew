import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Check,
  FileCheck2,
  LayoutDashboard,
  LockKeyhole,
  Network,
  ShieldCheck,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { CONVERSION_EVENTS, trackConversionEvent } from "../services/conversionAnalytics.js";

const planFeatures = [
  ["Unlimited Leads", BadgeCheck],
  ["Unlimited Users", Users],
  ["Workflow Management", Workflow],
  ["Document Management", FileCheck2],
  ["Bank Coordination", Network],
  ["Analytics", BarChart3],
  ["Activity Tracking", LayoutDashboard],
  ["Real-Time Visibility", ShieldCheck],
];

const trustIndicators = [
  "No Setup Fee",
  "No Hidden Charges",
  "No Per User Charges",
  "No Per Lead Charges",
  "Manual Renewal",
  "Secure Payment Processing",
];

const activationSteps = [
  "Dealership Registration",
  "Admin Approval",
  "Professional Plan Payment",
  "Account Activated",
];

function CtaBadge({ children, tone = "blue" }) {
  const toneClass = tone === "emerald"
    ? "bg-emerald-100 text-emerald-800"
    : "bg-blue-100 text-blue-800";
  return (
    <span className={`mb-1.5 inline-flex w-fit rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${toneClass}`}>
      {children}
    </span>
  );
}

function ProfessionalPlanModal({ open, onClose, location }) {
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/60 p-0 sm:items-center sm:p-6" role="presentation">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close Professional Plan details" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="professional-plan-title"
        className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-4xl sm:rounded-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
          aria-label="Close Professional Plan details"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="grid lg:grid-cols-[1fr_0.86fr]">
          <div className="p-6 sm:p-9">
            <span className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">
              Ready To Launch
            </span>
            <h2 id="professional-plan-title" className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-4xl">
              CarLoanSaathi Professional
            </h2>
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <span className="text-4xl font-semibold tracking-[-0.04em] text-slate-950">₹15,000</span>
              <span className="pb-1 text-base font-medium text-slate-500">/ Month + GST</span>
            </div>
            <p className="mt-4 max-w-xl text-sm leading-6 text-slate-600">
              Choose the paid plan when your dealership is ready to launch. Registration and admin approval happen before any payment is requested.
            </p>

            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {planFeatures.map(([label, Icon]) => (
                <div key={label} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <Icon className="h-4 w-4 shrink-0 text-blue-700" />
                  <span className="text-sm font-semibold text-slate-800">{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-200 bg-slate-50 p-6 sm:p-9 lg:border-l lg:border-t-0">
            <div className="flex items-center gap-3">
              <LockKeyhole className="h-5 w-5 text-emerald-700" />
              <h3 className="text-lg font-semibold text-slate-950">Approval-first activation</h3>
            </div>
            <ol className="mt-6 space-y-3">
              {activationSteps.map((step, index) => (
                <li key={step} className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-sm">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-800">
                    {index + 1}
                  </span>
                  <span className="text-sm font-semibold text-slate-800">{step}</span>
                </li>
              ))}
            </ol>

            <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
              You will not be charged now. Payment becomes available only after the dealership is verified and approved.
            </p>

            <div className="mt-6 grid gap-2">
              {trustIndicators.map((item) => (
                <div key={item} className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <Check className="h-4 w-4 text-emerald-600" />
                  {item}
                </div>
              ))}
            </div>

            <Link
              to="/dealer/register"
              onClick={() => {
                trackConversionEvent(CONVERSION_EVENTS.PROFESSIONAL_PLAN, `${location}_modal_continue`);
                onClose();
              }}
              className="mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800"
            >
              Register For Professional Plan
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function PublicConversionCtas({
  location,
  dark = false,
  className = "",
  buttonShape = "rounded-xl",
  trialLabel = "Start 60-Day Free Trial",
  professionalLabel = "Get Professional Plan",
  showBadges = true,
  showTrial = true,
  showProfessional = true,
  showContact = true,
}) {
  const [planOpen, setPlanOpen] = useState(false);
  const baseClass = `inline-flex min-h-12 w-full items-center justify-center px-5 py-3 text-center text-sm font-semibold transition sm:w-auto ${buttonShape}`;

  return (
    <>
      <div className={`flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-end ${className}`}>
        {showTrial ? <div className="flex flex-col">
          {showBadges ? <CtaBadge>Most Popular</CtaBadge> : null}
          <Link
            to="/dealer/register"
            onClick={() => trackConversionEvent(CONVERSION_EVENTS.FREE_TRIAL, location)}
            className={`${baseClass} bg-blue-700 text-white shadow-lg shadow-blue-700/15 hover:-translate-y-0.5 hover:bg-blue-800`}
          >
            {trialLabel}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div> : null}

        {showProfessional ? <div className="flex flex-col">
          {showBadges ? <CtaBadge tone="emerald">Ready To Launch</CtaBadge> : null}
          <button
            type="button"
            onClick={() => {
              trackConversionEvent(CONVERSION_EVENTS.PROFESSIONAL_PLAN, location);
              setPlanOpen(true);
            }}
            className={`${baseClass} border ${
              dark
                ? "border-emerald-300/60 bg-emerald-400/10 text-emerald-100 hover:-translate-y-0.5 hover:bg-emerald-400/20"
                : "border-emerald-300 bg-white text-emerald-800 shadow-sm hover:-translate-y-0.5 hover:border-emerald-400 hover:bg-emerald-50"
            }`}
          >
            {professionalLabel}
          </button>
        </div> : null}

        {showContact ? <a
          href="/#contact"
          onClick={() => trackConversionEvent(CONVERSION_EVENTS.CONTACT_SALES, location)}
          className={`${baseClass} ${
            dark
              ? "border border-white/30 bg-white/10 text-white hover:-translate-y-0.5 hover:bg-white/15"
              : "border border-slate-300 bg-white text-slate-800 hover:-translate-y-0.5 hover:border-slate-400 hover:bg-slate-50"
          } ${showBadges ? "sm:mt-[1.75rem]" : ""}`}
        >
          Contact Sales
        </a> : null}
      </div>

      <ProfessionalPlanModal open={planOpen} onClose={() => setPlanOpen(false)} location={location} />
    </>
  );
}
