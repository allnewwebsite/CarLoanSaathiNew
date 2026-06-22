import { LEAD_STATUSES, normalizeStatus } from "../../../constants/status.js";
import { mutationUrlMatches } from "../../../hooks/useRealtimeRefresh.js";
import { portalLeadStatusLabel } from "../../../utils/portalDisplay.js";

export const documentTypes = ["Aadhaar", "PAN", "Salary Slip", "ITR", "Bank Statement", "Electricity Bill", "Rent Agreement", "Form 16"];

export const leadMutationFilter = (detail) => mutationUrlMatches(detail, ["/dealer/leads", "/dealer/dead-cases", "/bank/leads", "/gm/leads", "/documents"]);

export function caseId(lead = {}) {
  return lead.caseId || lead.id;
}

export function bankDisplay(lead = {}) {
  return lead.assignedBankName || lead.bankName || lead.selectedBankName || lead.bankPartner || "";
}

export function financeStatus(lead = {}) {
  return portalLeadStatusLabel(lead);
}

export function workflowStatus(value) {
  const normalized = normalizeStatus(value);
  if (normalized === LEAD_STATUSES.ASSIGNED) return LEAD_STATUSES.NEW;
  if ([LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW, LEAD_STATUSES.APPROVED].includes(normalized)) return LEAD_STATUSES.UNDER_BANK_PROCESS;
  if (normalized === LEAD_STATUSES.DOCS_PENDING) return LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS;
  return normalized;
}
