import { CheckCircle2, FileCheck2, Landmark, RefreshCw } from "lucide-react";

export function SectionHeading({ eyebrow, title, text, align = "center" }) {
  const alignment = align === "left" ? "text-left" : "mx-auto text-center";
  return (
    <div className={`max-w-3xl ${alignment}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#0d47a1]">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.035em] text-slate-950 sm:text-4xl">{title}</h2>
      {text && <p className="mt-4 text-base leading-7 text-slate-600">{text}</p>}
    </div>
  );
}

export function WorkflowPreview() {
  return (
    <div className="relative mx-auto w-full max-w-xl" aria-label="CarLoanSaathi workflow preview">
      <div className="absolute -inset-5 rounded-[2rem] bg-gradient-to-br from-blue-100 via-white to-emerald-100 opacity-80" />
      <div className="relative overflow-hidden rounded-2xl border border-white bg-white p-5 shadow-xl shadow-slate-900/10 sm:p-7">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0d47a1]">Live case workflow</p>
            <p className="mt-1 text-lg font-semibold text-slate-950">Customer loan journey</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">On track</span>
        </div>
        <div className="mt-5 space-y-3">
          {[
            ["Enquiry received", "Salesperson", "Completed", CheckCircle2, "bg-emerald-50 text-emerald-700"],
            ["Documents reviewed", "Finance Desk", "Completed", FileCheck2, "bg-emerald-50 text-emerald-700"],
            ["Bank processing", "Loan Executive", "In progress", RefreshCw, "bg-blue-50 text-blue-700"],
            ["Decision", "Bank Branch", "Next", Landmark, "bg-slate-100 text-slate-600"],
          ].map(([title, owner, status, Icon, color]) => (
            <div key={title} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${color}`}>
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">{title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{owner}</p>
              </div>
              <span className="text-xs font-semibold text-slate-500">{status}</span>
            </div>
          ))}
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {[["24", "Activities"], ["4", "Documents"], ["Live", "Updates"]].map(([value, label]) => (
            <div key={label} className="rounded-xl bg-slate-950 p-3 text-center">
              <p className="text-lg font-semibold text-white">{value}</p>
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function BenefitCard({ item, tone }) {
  const [title, text, Icon] = item;
  const iconStyle = tone === "bank" ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700";
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <span className={`flex h-11 w-11 items-center justify-center rounded-lg ${iconStyle}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <h3 className="mt-4 text-lg font-semibold text-slate-950">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
    </article>
  );
}
