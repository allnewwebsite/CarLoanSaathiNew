import { LEAD_STATUSES } from "../../../constants/status.js";
import { formatPortalDate, formatPortalDateTime, formatPortalMoney, formatPortalTime, portalCaseId, portalGeneratedAt, portalLeadStatusLabel, portalWorkflowStatus } from "../../../utils/portalDisplay.js";

export function display(value) {
  return value || "-";
}

export function caseId(lead) {
  return portalCaseId(lead);
}

export function moneyValue(value) {
  return formatPortalMoney(value);
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
  return portalGeneratedAt(lead);
}

export function workflowStatus(value) {
  return portalWorkflowStatus(value);
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
