import { normalizeStatus, statusLabel } from "../constants/status.js";

export function StatusBadge({ status }) {
  const normalized = normalizeStatus(status);
  return (
    <span className="text-xs font-normal text-slate-700">
      {statusLabel(normalized)}
    </span>
  );
}
