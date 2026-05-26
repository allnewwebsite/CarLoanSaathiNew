import { LEAD_STATUSES, normalizeStatus, statusLabel } from "../constants/status.js";

const tone = {
  [LEAD_STATUSES.NEW]: "bg-blue-50 text-blue-700 ring-blue-100",
  [LEAD_STATUSES.ASSIGNED]: "bg-blue-50 text-blue-700 ring-blue-100",
  [LEAD_STATUSES.ACCEPTED]: "bg-indigo-50 text-indigo-700 ring-indigo-100",
  [LEAD_STATUSES.UNDER_REVIEW]: "bg-amber-50 text-amber-700 ring-amber-100",
  [LEAD_STATUSES.DOCS_PENDING]: "bg-orange-50 text-orange-700 ring-orange-100",
  [LEAD_STATUSES.APPROVED]: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  [LEAD_STATUSES.REJECTED]: "bg-rose-50 text-rose-700 ring-rose-100",
  [LEAD_STATUSES.DISBURSED]: "bg-slate-100 text-slate-700 ring-slate-200",
  [LEAD_STATUSES.CLOSED]: "bg-slate-100 text-slate-700 ring-slate-200",
};

export function StatusBadge({ status }) {
  const normalized = normalizeStatus(status);
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${tone[normalized] || tone[LEAD_STATUSES.NEW]}`}>
      {statusLabel(normalized)}
    </span>
  );
}
