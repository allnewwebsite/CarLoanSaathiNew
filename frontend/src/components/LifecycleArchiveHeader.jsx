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

const POLICY_COPY = {
  dead: {
    title: "Dead Case Policy",
    lines: [
      "Auto moved after 7 days without a status update.",
      "Available for 3 months for reference.",
      "Permanently deleted after 3 months.",
      "A new case must be created if the customer returns.",
    ],
  },
  rejected: {
    title: "Rejected Case Policy",
    lines: [
      "Rejected cases are archived automatically.",
      "Available for 3 months for reference.",
      "Permanently deleted after 3 months.",
    ],
  },
  disbursed: {
    title: "Disbursed Case Policy",
    lines: [
      "Successfully completed loan cases.",
      "Available for 3 months for reference.",
      "Permanently deleted after 3 months.",
    ],
  },
};

export function lifecycleArchiveCopy(kind) {
  return COPY[kind] || COPY.rejected;
}

export function PolicyInformationBanner({ kind = "rejected" }) {
  const policy = POLICY_COPY[kind] || POLICY_COPY.rejected;
  return (
    <section className="flex gap-2.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-blue-950">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#0d47a1]" aria-hidden="true" />
      <div className="min-w-0">
        <h2 className="text-sm font-semibold leading-5">{policy.title}</h2>
        <ul className="mt-1 grid gap-x-6 gap-y-0.5 text-xs leading-5 text-blue-900 sm:grid-cols-2" role="list">
          {policy.lines.map((line) => <li key={line} className="flex min-w-0 gap-1.5"><span aria-hidden="true">•</span><span>{line}</span></li>)}
        </ul>
      </div>
    </section>
  );
}

export function LifecycleArchiveHeader({ kind, search, onSearch, dealerships = [], dealershipId = "", onDealershipChange, dealershipsLoading = false }) {
  const copy = lifecycleArchiveCopy(kind);
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-slate-950">{copy.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{copy.subtitle}</p>
      </div>
      <PolicyInformationBanner kind={kind} />
      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_16rem]">
        {onDealershipChange ? (
          <label className="sr-only" htmlFor={`${kind}-dealership-filter`}>Select Dealership</label>
        ) : null}
        {onDealershipChange ? (
          <select id={`${kind}-dealership-filter`} value={dealershipId} onChange={(event) => onDealershipChange(event.target.value)} disabled={dealershipsLoading} className="order-first h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100 sm:order-last">
            <option value="">All Dealerships</option>
            {dealerships.map((dealership) => <option key={dealership.dealershipId} value={dealership.dealershipId}>{dealership.dealershipName}</option>)}
          </select>
        ) : null}
        <label className="relative block">
        <span className="sr-only">Search archived cases</span>
        <Search className="absolute left-6 top-5.5 h-4 w-4 text-slate-400" />
        <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search by customer name, case ID, mobile, city, or bank" className="h-9 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100" />
        </label>
      </div>
    </>
  );
}
