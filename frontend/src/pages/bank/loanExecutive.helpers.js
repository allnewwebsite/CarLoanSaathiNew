import { BANK_STATUS_OPTIONS, LEAD_STATUSES, normalizeStatus, statusLabel as leadStatusLabel } from "../../constants/status.js";
import { CUSTOMER_DOCUMENTS, OTHER_CUSTOMER_DOCUMENT } from "../../constants/customerDocuments.js";
import { mutationUrlMatches } from "../../hooks/useRealtimeRefresh.js";
import { normalizeRows } from "../../services/apiResponse.js";
import { formatPortalDateTime, portalLeadStatusLabel } from "../../utils/portalDisplay.js";

export const LOAN_EXECUTIVE_PAGE_SIZE = 10;
export const loanExecutiveDocs = CUSTOMER_DOCUMENTS;
export const otherDocumentLabel = OTHER_CUSTOMER_DOCUMENT;
export const leadMutationFilter = (detail) => mutationUrlMatches(detail, ["/bank/leads", "/documents"]);

const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export const statusOptions = [
  LEAD_STATUSES.CONTACTED,
  LEAD_STATUSES.DOCUMENT_RECEIVED,
  LEAD_STATUSES.UNDER_BANK_PROCESS,
  LEAD_STATUSES.DISBURSED,
  LEAD_STATUSES.REJECTED,
  LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS,
].map((value) => ({ label: leadStatusLabel(value), value }));

export const statusFilters = BANK_STATUS_OPTIONS.map((value) => ({ label: leadStatusLabel(value), value }));

export function display(value) {
  return value || "-";
}

export function caseId(lead) {
  return lead.caseId || lead.id;
}

export function moneyValue(value) {
  return `Rs. ${money.format(Number(value || 0))}`;
}

export function dateTime(value) {
  return formatPortalDateTime(value);
}

export function generatedAt(lead) {
  return dateTime(lead.generatedAt || lead.createdAt);
}

export function executiveStatusLabel(lead) {
  return portalLeadStatusLabel(lead);
}

export function apiStatus(value) {
  return value === "REJECTED_REASON" ? LEAD_STATUSES.REJECTED : value;
}

export function workflowStatus(value) {
  const normalized = normalizeStatus(value);
  if (normalized === LEAD_STATUSES.ASSIGNED) return LEAD_STATUSES.NEW;
  if ([LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW, LEAD_STATUSES.APPROVED].includes(normalized)) return LEAD_STATUSES.UNDER_BANK_PROCESS;
  if (normalized === LEAD_STATUSES.DOCS_PENDING) return LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS;
  return normalized;
}

export function responseRows(response) {
  return normalizeRows(response);
}
