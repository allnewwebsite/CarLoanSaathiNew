import { LEAD_STATUSES, normalizeStatus } from "../../../constants/status.js";
import { formatPortalDate, formatPortalDateTime, formatPortalTime, portalLeadStatusLabel } from "../../../utils/portalDisplay.js";

const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function display(value) {
  return value || "-";
}

export function caseId(lead) {
  return lead.caseId || lead.id;
}

export function moneyValue(value) {
  return `Rs. ${money.format(Number(value || 0))}`;
}

export function dateValue(value) {
  return formatPortalDate(value);
}

export function timeValue(value) {
  return formatPortalTime(value);
}

export function dateTime(value) {
  return formatPortalDateTime(value);
}

export function generatedAt(lead) {
  return dateTime(lead.generatedAt || lead.createdAt);
}

export function workflowStatus(value) {
  const normalized = normalizeStatus(value);
  if (normalized === LEAD_STATUSES.ASSIGNED) return LEAD_STATUSES.NEW;
  if ([LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW, LEAD_STATUSES.APPROVED].includes(normalized)) return LEAD_STATUSES.UNDER_BANK_PROCESS;
  if (normalized === LEAD_STATUSES.DOCS_PENDING) return LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS;
  return normalized;
}

export function statusLabel(lead) {
  return portalLeadStatusLabel(lead);
}

export function salespersonFilterValue(person = {}) {
  return person.sourceId || person.salespersonId || person.id || person.email || person.mobile || "";
}

export function sameSalesperson(person = {}, value = "") {
  const requested = String(value || "").trim();
  if (!requested) return false;
  return [
    person.id,
    person.sourceId,
    person.salespersonId,
    person.jobId,
    person.email,
    person.mobile,
    salespersonFilterValue(person),
  ].some((item) => String(item || "").trim() === requested);
}
