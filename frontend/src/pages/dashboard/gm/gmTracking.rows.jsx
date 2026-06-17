import { LEAD_TABLE_LABELS } from "../../../constants/leadTableLabels.js";
import { DocumentsButton } from "./GmTrackingParts.jsx";
import { caseId, dateValue, display, generatedAt, moneyValue, statusLabel, timeValue } from "./gmTracking.helpers.js";

export function totalRows(leads) {
  return leads.map((lead) => ({
    key: lead.id,
    cells: [
      caseId(lead),
      display(lead.fullName || lead.customerName),
      display(lead.mobile),
      display(lead.city || lead.dealershipCity),
      moneyValue(lead.carPrice || lead.carOnRoadPrice || lead.onRoadPrice),
      moneyValue(lead.loanAmount || lead.requiredLoanAmount),
      display(lead.assignedSalesperson || lead.salespersonName),
      display(lead.assignedExecutiveName),
      display(lead.assignedExecutiveMobile || lead.executiveMobile),
      statusLabel(lead),
      generatedAt(lead),
      <DocumentsButton key="docs" lead={lead} />,
    ],
  }));
}

export function caseRows(leads) {
  return leads.map((lead) => ({
    key: lead.id,
    cells: [
      caseId(lead),
      display(lead.fullName || lead.customerName),
      display(lead.mobile),
      display(lead.city || lead.dealershipCity),
      moneyValue(lead.carPrice || lead.carOnRoadPrice || lead.onRoadPrice),
      moneyValue(lead.loanAmount || lead.requiredLoanAmount),
      display(lead.assignedSalesperson || lead.salespersonName),
      display(lead.bankPartner || lead.assignedBankName),
      display(lead.assignedExecutiveName),
      display(lead.assignedExecutiveMobile || lead.executiveMobile),
      statusLabel(lead),
      generatedAt(lead),
      <DocumentsButton key="docs" lead={lead} />,
    ],
  }));
}

export function statusRows(leads, rejected) {
  return leads.map((lead) => {
    const cells = [
      caseId(lead),
      display(lead.fullName || lead.customerName),
      display(lead.assignedSalesperson || lead.salespersonName),
      moneyValue(lead.loanAmount || lead.requiredLoanAmount),
      statusLabel(lead),
    ];
    if (rejected) cells.push(display(lead.rejectionReason || lead.loanRejectionReason));
    cells.push(dateValue(lead.statusUpdatedAt || lead.updatedAt || lead.createdAt));
    cells.push(timeValue(lead.statusUpdatedAt || lead.updatedAt || lead.createdAt));
    cells.push(<DocumentsButton key="docs" lead={lead} />);
    return { key: lead.id, cells };
  });
}

export const totalLeadHeaders = ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Car On-Road Price", "Required Loan Amount", "Assigned Salesperson", LEAD_TABLE_LABELS.assignedExecutive, LEAD_TABLE_LABELS.executiveMobile, LEAD_TABLE_LABELS.currentStatus, LEAD_TABLE_LABELS.generatedDate, "Documents"];

export const allCaseHeaders = ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Car On-Road Price", "Required Loan Amount", "Assigned Salesperson", "Assigned Bank", LEAD_TABLE_LABELS.assignedExecutive, LEAD_TABLE_LABELS.executiveMobile, LEAD_TABLE_LABELS.currentStatus, LEAD_TABLE_LABELS.generatedDate, "Documents"];
