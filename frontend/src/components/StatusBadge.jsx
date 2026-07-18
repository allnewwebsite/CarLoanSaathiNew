import { normalizeStatus, statusLabel } from "../constants/status.js";
import { portalLeadStatusLabel } from "../utils/portalDisplay.js";

export function StatusBadge({ status, lead }) {
  const normalized = normalizeStatus(status);
  const location = lead?.currentLocation;
  const locationLabel = location === "dead-case" ? "Dead Case" : location === "rejected" ? "Rejected" : location === "disbursed" ? "Disbursed" : "";
  return (
    <span className="text-xs font-normal text-slate-700">
      {lead ? portalLeadStatusLabel(lead) : statusLabel(normalized)}
      {locationLabel ? <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">Location: {locationLabel}</span> : null}
    </span>
  );
}
