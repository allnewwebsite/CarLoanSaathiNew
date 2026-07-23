import { CURRENT_WORKFLOW_STATUS_OPTIONS, LEAD_STATUSES, normalizeStatus, statusLabel as leadStatusLabel } from "../../constants/status.js";
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

const VALID_STATUS_TRANSITIONS = Object.freeze({
  NEW: ["CONTACTED", "REQUEST_DOCUMENT", "REQUEST_PENDING_DOCUMENTS", "UNDER_BANK_PROCESS", "DISBURSED", "REJECTED"],
  CONTACTED: ["REQUEST_DOCUMENT", "DOCUMENT_RECEIVED", "REQUEST_PENDING_DOCUMENTS", "UNDER_BANK_PROCESS", "DISBURSED", "REJECTED"],
  REQUEST_DOCUMENT: ["DOCUMENT_RECEIVED", "REQUEST_PENDING_DOCUMENTS", "UNDER_BANK_PROCESS", "DISBURSED", "REJECTED"],
  DOCUMENT_RECEIVED: ["REQUEST_PENDING_DOCUMENTS", "UNDER_BANK_PROCESS", "DISBURSED", "REJECTED"],
  REQUEST_PENDING_DOCUMENTS: ["DOCUMENT_RECEIVED", "UNDER_BANK_PROCESS", "DISBURSED", "REJECTED"],
  UNDER_BANK_PROCESS: ["REQUEST_PENDING_DOCUMENTS", "DOCS_PENDING", "DISBURSED", "REJECTED"],
  ASSIGNED: ["CONTACTED", "REQUEST_DOCUMENT", "UNDER_BANK_PROCESS", "REJECTED"],
  ACCEPTED: ["CONTACTED", "REQUEST_DOCUMENT", "UNDER_BANK_PROCESS", "DOCS_PENDING", "REJECTED"],
  UNDER_REVIEW: ["REQUEST_PENDING_DOCUMENTS", "UNDER_BANK_PROCESS", "DOCS_PENDING", "REJECTED", "DISBURSED"],
  DOCS_PENDING: ["DOCUMENT_RECEIVED", "REQUEST_PENDING_DOCUMENTS", "UNDER_BANK_PROCESS", "REJECTED"],
});

export function statusOptionsForLead(lead = {}) {
  const current = normalizeStatus(lead.status || lead.assignmentStatus);
  const allowed = new Set([current, ...(VALID_STATUS_TRANSITIONS[current] || [])]);
  return statusOptions.filter((option) => allowed.has(option.value));
}

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
