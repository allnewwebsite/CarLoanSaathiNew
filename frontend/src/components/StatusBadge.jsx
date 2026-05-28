import { LEAD_STATUSES, normalizeStatus, statusLabel } from "../constants/status.js";

const tone = {
  [LEAD_STATUSES.NEW]: "bg-blue-50 text-blue-700 ring-blue-100",
  [LEAD_STATUSES.CONTACTED]: "bg-cyan-50 text-cyan-700 ring-cyan-100",
  [LEAD_STATUSES.REQUEST_DOCUMENT]: "bg-orange-50 text-orange-700 ring-orange-100",
  [LEAD_STATUSES.DOCUMENT_RECEIVED]: "bg-teal-50 text-teal-700 ring-teal-100",
  [LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS]: "bg-yellow-50 text-yellow-700 ring-yellow-100",
  [LEAD_STATUSES.ALL_DOCUMENTS_RECEIVED]: "bg-indigo-50 text-indigo-700 ring-indigo-100",
  [LEAD_STATUSES.UNDER_BANK_PROCESS]: "bg-purple-50 text-purple-700 ring-purple-100",
  [LEAD_STATUSES.ASSIGNED]: "bg-blue-50 text-blue-700 ring-blue-100",
  [LEAD_STATUSES.ACCEPTED]: "bg-indigo-50 text-indigo-700 ring-indigo-100",
  [LEAD_STATUSES.UNDER_REVIEW]: "bg-amber-50 text-amber-700 ring-amber-100",
  [LEAD_STATUSES.DOCS_PENDING]: "bg-orange-50 text-orange-700 ring-orange-100",
  [LEAD_STATUSES.APPROVED]: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  [LEAD_STATUSES.REJECTED]: "bg-rose-50 text-rose-700 ring-rose-100",
  [LEAD_STATUSES.DISBURSED]: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  [LEAD_STATUSES.CLOSED]: "bg-slate-100 text-slate-700 ring-slate-200",
};

export function StatusBadge({ status }) {
  const normalized = normalizeStatus(status);
  return (
    <span className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-semibold leading-4 ring-1 ${tone[normalized] || tone[LEAD_STATUSES.NEW]}`}>
      {statusLabel(normalized)}
    </span>
  );
}
