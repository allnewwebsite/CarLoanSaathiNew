import { formatPortalDateTime } from "../../utils/portalDisplay.js";

export const PAGE_SIZE = 20;

export const DEAD_CASE_ENDPOINTS = {
  finance: "/dealer/dead-cases",
  gm: "/gm/dead-cases",
  bank: "/bank/dead-cases",
  executive: "/bank/dead-cases",
  salesperson: "/dealer/dead-cases",
};

export const AUDIENCE_LABELS = {
  finance: "Finance Desk",
  gm: "General Manager",
  bank: "Bank Manager",
  executive: "Loan Executive",
  salesperson: "Salesperson",
};

export function value(input) {
  return String(input || "").trim() || "-";
}

export function displayDate(input) {
  return formatPortalDateTime(input);
}

export function customerName(lead = {}) {
  return lead.fullName || lead.customerName;
}

export function customerCity(lead = {}) {
  return lead.city || lead.customerCity || lead.dealershipCity;
}

export function assignedBank(lead = {}) {
  return lead.assignedBankName || lead.bankName || lead.selectedBankName || lead.bankPartner;
}

export function requiredLoan(lead = {}) {
  return lead.requiredLoanAmount || lead.loanAmount;
}

export function carPrice(lead = {}) {
  return lead.carOnRoadPrice || lead.onRoadPrice || lead.carPrice;
}

export function generatedDate(lead = {}) {
  return lead.generatedAt || lead.createdAt;
}

export function financeManager(lead = {}) {
  return lead.financeManagerName || lead.assignedFinanceManager || lead.financeManagerEmail;
}

export function financeManagerMobile(lead = {}) {
  return lead.financeManagerMobile || lead.assignedFinanceManagerMobile;
}

export function assignedExecutive(lead = {}) {
  return lead.assignedExecutiveName || lead.assignedExecutiveEmail;
}

export function executiveMobile(lead = {}) {
  return lead.assignedExecutiveMobile || lead.executiveMobile;
}

export function leadIds(lead = {}) {
  return [lead.id, lead.leadId, lead.sourceId, lead.caseId].map((item) => String(item || "").trim()).filter(Boolean);
}

export function sameLead(left = {}, right = {}) {
  const rightIds = new Set(leadIds(right));
  return leadIds(left).some((id) => rightIds.has(id));
}

function escapeCsv(input) {
  const text = String(input ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export function downloadCsv(rows, audience, columns) {
  const data = rows.map((lead) => columns.map((column) => column.csv(lead)));
  const csv = [columns.map((column) => column.header), ...data].map((row) => row.map(escapeCsv).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${audience}-dead-cases.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
