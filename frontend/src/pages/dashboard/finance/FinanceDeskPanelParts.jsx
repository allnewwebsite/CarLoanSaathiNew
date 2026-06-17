import { OperationalTable } from "../../../components/OperationalTable.jsx";
import { digits10 } from "../financeDesk.helpers.js";

export const FINANCE_PAGE_SIZE = 10;

export function FinanceTable({ headers, rows, loading, page, total, hasMore, onPage }) {
  return (
    <OperationalTable
      headers={headers}
      rows={rows}
      loading={loading}
      page={page}
      total={total}
      hasMore={hasMore}
      onPage={onPage}
      pageSize={FINANCE_PAGE_SIZE}
    />
  );
}

export function SectionTitle({ title, subtitle }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

export function Field({ label, children, error, help = "" }) {
  const slotText = error || help || "No validation issue";
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      {children}
      <span className={`validation-slot ${error ? "" : help ? "!text-slate-500" : "validation-slot-empty"}`}>{slotText}</span>
    </label>
  );
}

export function MobileInput({ value, onChange, onBlur, error, required = false }) {
  return (
    <div className={`mt-1.5 flex h-10 overflow-hidden rounded-md border bg-white ${error ? "border-red-300" : "border-slate-300"} focus-within:border-[#0d47a1] focus-within:ring-2 focus-within:ring-blue-100`}>
      <span className="inline-flex items-center border-r border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">+91</span>
      <input
        required={required}
        aria-invalid={Boolean(error)}
        className="h-full min-w-0 flex-1 px-3 text-sm font-normal text-slate-900 outline-none"
        inputMode="numeric"
        maxLength={10}
        value={value}
        onBlur={onBlur}
        onChange={(event) => onChange(digits10(event.target.value))}
      />
    </div>
  );
}
