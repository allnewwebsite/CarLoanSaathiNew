import { normalizeStatus, statusLabel } from "../constants/status.js";
import { portalLeadStatusLabel } from "../utils/portalDisplay.js";

export function StatusBadge({ status, lead }) {
  const normalized = normalizeStatus(status);
  return (
    <span className="text-xs font-normal text-slate-700">
      {lead ? portalLeadStatusLabel(lead) : statusLabel(normalized)}
    </span>
  );
}
