import { Info, Search } from "lucide-react";

const COPY = {
  rejected: {
    title: "Rejected Cases",
    subtitle: "Cases rejected by the loan processing workflow.",
    empty: "No rejected cases available.",
  },
  disbursed: {
    title: "Disbursed Cases",
    subtitle: "Successfully completed and disbursed loan cases.",
    empty: "No disbursed cases available.",
  },
};

export function lifecycleArchiveCopy(kind) {
  return COPY[kind] || COPY.rejected;
}

export function PolicyInformationBanner({ title, description }) {
  return (
    <section className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-950">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-[#0d47a1]" aria-hidden="true" />
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-blue-900">{description}</p>
      </div>
    </section>
  );
}

export function LifecycleArchiveHeader({ kind, search, onSearch }) {
  const copy = lifecycleArchiveCopy(kind);
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-slate-950">{copy.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{copy.subtitle}</p>
      </div>
      <PolicyInformationBanner title="Archive Retention Policy" description="Rejected and Disbursed cases are retained for 3 calendar months from the date they enter their final lifecycle state. After 3 calendar months, all customer information, uploaded documents, workflow history, notifications, assignments, and related records are permanently deleted from the CarLoanSaathi ecosystem. This action cannot be reversed." />
      <label className="relative block rounded-lg border border-slate-200 bg-white p-3">
        <span className="sr-only">Search archived cases</span>
        <Search className="absolute left-6 top-5.5 h-4 w-4 text-slate-400" />
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search by customer name, case ID, mobile, city, or bank" className="h-9 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100" />
      </label>
    </>
  );
}
