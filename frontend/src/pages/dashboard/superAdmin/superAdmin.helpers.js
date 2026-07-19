import { LEAD_STATUSES, normalizeStatus } from "../../../constants/status.js";
import { CUSTOMER_DOCUMENTS } from "../../../constants/customerDocuments.js";
import { formatPortalDateTime } from "../../../utils/portalDisplay.js";

export const SUPER_ADMIN_PAGE_SIZE = 10;
export const superAdminMoney = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export const customerDocumentTypes = CUSTOMER_DOCUMENTS;

export function display(value) {
  return value || "-";
}

export function bankCapacityDisplay(item) {
  return display(item?.monthlyLoanCapacity || item?.monthlyCapacity || item?.approvalLimit);
}

export function formatDate(value) {
  return formatPortalDateTime(value);
}

export function leadStatus(lead) {
  return normalizeStatus(lead.status || LEAD_STATUSES.NEW);
}

export function approvalStatusOf(item) {
  return String(item?.status || item?.approvalStatus || "pending").trim().toLowerCase();
}

export function finalApprovalStatus(item) {
  return ["approved", "rejected", "suspended", "deleted", "disabled", "inactive"].includes(approvalStatusOf(item));
}

export function canActOnApproval(item) {
  if (!item) return false;
  if (item.accountApproved === true || item.approved === true) return false;
  return !finalApprovalStatus(item);
}

export function approvalRatio(leads) {
  if (!leads.length) return "0%";
  const approved = leads.filter((lead) => [LEAD_STATUSES.APPROVED, LEAD_STATUSES.DISBURSED].includes(leadStatus(lead))).length;
  return `${Math.round((approved / leads.length) * 100)}%`;
}
