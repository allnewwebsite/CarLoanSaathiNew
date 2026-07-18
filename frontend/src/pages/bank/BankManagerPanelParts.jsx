import { Search } from "lucide-react";
import { OperationalTable } from "../../components/OperationalTable.jsx";

export const BANK_MANAGER_PAGE_SIZE = 10;

export function BankManagerTable({ title, headers, rows, loading, page, total, hasMore, onPage, emptyMessage }) {
  return (
    <OperationalTable
      title={title}
      headers={headers}
      rows={rows}
      loading={loading}
      page={page}
      total={total}
      hasMore={hasMore}
      onPage={onPage}
      pageSize={BANK_MANAGER_PAGE_SIZE}
      emptyMessage={emptyMessage}
    />
  );
}

export function MetricCard({ label, value, subtext }) {
  const loading = value === "-";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      {loading ? <div className="mt-3 h-8 w-24 animate-pulse rounded-md bg-slate-100" /> : <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>}
      {loading ? <div className="mt-3 h-3 w-36 animate-pulse rounded bg-slate-100" /> : subtext ? <p className="mt-1 text-xs font-medium text-slate-500">{subtext}</p> : null}
    </div>
  );
}

export function DetailState({ title, message, requestId, onRetry, tone = "slate" }) {
  const tones = {
    slate: "border-slate-200 bg-white text-slate-600",
    red: "border-red-100 bg-red-50 text-red-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
  };
  return (
    <section className={`rounded-lg border p-5 text-sm ${tones[tone] || tones.slate}`}>
      <p className="font-semibold">{title}</p>
      <p className="mt-1">{message}</p>
      {requestId ? <p className="mt-2 text-xs opacity-80">Request ID: {requestId}</p> : null}
      {onRetry ? <button onClick={onRetry} className="mt-4 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700">Retry</button> : null}
    </section>
  );
}

export function SearchBar({ value, onChange }) {
  return (
    <div className="relative rounded-lg border border-slate-200 bg-white p-3">
      <Search className="absolute left-6 top-5 h-4 w-4 text-slate-400" />
      <input className="h-9 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-[#0d47a1]" placeholder="Search records" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

export function PageTitle({ title }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Bank Manager</p>
      <h1 className="mt-1 text-xl font-semibold text-slate-900">{title}</h1>
    </div>
  );
}
