import { CURRENT_WORKFLOW_STATUS_OPTIONS, LEAD_STATUSES, statusLabel as leadStatusLabel } from "../../constants/status.js";
import { CUSTOMER_DOCUMENTS, OTHER_CUSTOMER_DOCUMENT } from "../../constants/customerDocuments.js";
import { mutationUrlMatches } from "../../hooks/useRealtimeRefresh.js";
import { normalizeRows } from "../../services/apiResponse.js";
import { formatPortalDateTime, formatPortalMoney, portalCaseId, portalGeneratedAt, portalLeadStatusLabel, portalWorkflowStatus } from "../../utils/portalDisplay.js";

export const LOAN_EXECUTIVE_PAGE_SIZE = 10;
export const loanExecutiveDocs = CUSTOMER_DOCUMENTS;
export const otherDocumentLabel = OTHER_CUSTOMER_DOCUMENT;
export const leadMutationFilter = (detail) => mutationUrlMatches(detail, ["/bank/leads", "/documents"]);

export const statusOptions = [
  LEAD_STATUSES.CONTACTED,
  LEAD_STATUSES.DOCUMENT_RECEIVED,
  LEAD_STATUSES.UNDER_BANK_PROCESS,
  LEAD_STATUSES.DISBURSED,
  LEAD_STATUSES.REJECTED,
  LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS,
].map((value) => ({ label: leadStatusLabel(value), value }));

export const statusFilters = CURRENT_WORKFLOW_STATUS_OPTIONS.map((value) => ({ label: leadStatusLabel(value), value }));

export function display(value) {
  return value || "-";
}

export function caseId(lead) {
  return portalCaseId(lead);
}

export function moneyValue(value) {
  return formatPortalMoney(value);
}

export function dateTime(value) {
  return formatPortalDateTime(value);
}

export function generatedAt(lead) {
  return portalGeneratedAt(lead);
}

export function executiveStatusLabel(lead) {
  return portalLeadStatusLabel(lead);
}

export function apiStatus(value) {
  return value === "REJECTED_REASON" ? LEAD_STATUSES.REJECTED : value;
}

export function workflowStatus(value) {
  return portalWorkflowStatus(value);
}

export function responseRows(response) {
  return normalizeRows(response);
}
