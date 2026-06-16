import { LEAD_STATUSES, normalizeStatus } from "../../constants/status.js";
import { normalizeRows } from "../../services/apiResponse.js";
import { formatPortalDateTime, portalLeadStatusLabel } from "../../utils/portalDisplay.js";

const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function display(value) {
  return value || "-";
}

export function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function cleanEmail(value) {
  return cleanText(value).toLowerCase();
}

export function digits10(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 10);
}

export function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(value));
}

export function executiveDeleteId(executive = {}) {
  return executive.sourceId || executive.executiveId || executive.email || executive.officialEmail || executive.id;
}

export function caseId(lead = {}) {
  return lead.caseId || lead.id;
}

export function moneyValue(value) {
  return `Rs. ${money.format(Number(value || 0))}`;
}

export function numberValue(value) {
  return money.format(Number(value || 0));
}

export function dateTime(value) {
  return formatPortalDateTime(value);
}

export function generatedAt(lead = {}) {
  return dateTime(lead.generatedAt || lead.createdAt);
}

export function workflowStatus(value) {
  const normalized = normalizeStatus(value);
  if (normalized === LEAD_STATUSES.ASSIGNED) return LEAD_STATUSES.NEW;
  if ([LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW, LEAD_STATUSES.APPROVED].includes(normalized)) {
    return LEAD_STATUSES.UNDER_BANK_PROCESS;
  }
  if (normalized === LEAD_STATUSES.DOCS_PENDING) return LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS;
  return normalized;
}

export function leadStatusLabel(lead) {
  return portalLeadStatusLabel(lead);
}

export function responseRows(response) {
  return normalizeRows(response);
}

export function sameValue(left, right) {
  const a = String(left || "").trim().toLowerCase();
  const b = String(right || "").trim().toLowerCase();
  return Boolean(a && b && a === b);
}

export function normalizedBranch(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\b(branch|br|city|district)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function branchValue(record = {}) {
  return record.branchId || record.bankBranchLocation || record.branchCity || record.branchLocation || record.bankLocation || record.branch || record.city || "";
}

export function branchMatch(lead = {}, executive = {}) {
  const leadIfsc = lead.assignedBankIfsc || lead.bankIfsc || lead.ifscCode || "";
  const executiveIfsc = executive.bankIfsc || executive.ifsc || executive.ifscCode || executive.branchIfsc || executive.assignedBankIfsc || "";
  if (leadIfsc && executiveIfsc) return sameValue(leadIfsc, executiveIfsc);
  const leadBranch = lead.branchId || lead.bankBranchId || lead.bankBranchCity || lead.branchCity || lead.branchLocation || lead.bankBranchLocation || lead.city || "";
  const executiveBranch = branchValue(executive);
  const leadNormalized = normalizedBranch(leadBranch);
  const executiveNormalized = normalizedBranch(executiveBranch);
  if (!leadNormalized || !executiveNormalized) return true;
  return leadNormalized === executiveNormalized
    || leadNormalized.includes(executiveNormalized)
    || executiveNormalized.includes(leadNormalized);
}

export function executiveIdentity(executive = {}) {
  return [executive.id, executive.sourceId, executive.executiveId, executive.email, executive.officialEmail, executive.mobile]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
}

export function currentExecutiveIdentity(lead = {}) {
  return [lead.assignedExecutiveId, lead.assignedExecutiveEmail, lead.assignedExecutiveMobile, lead.assignedExecutiveName]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
}

export function reassignmentExecutiveId(executive = {}) {
  return executive.sourceId || executive.executiveId || executive.email || executive.officialEmail || executive.id;
}
