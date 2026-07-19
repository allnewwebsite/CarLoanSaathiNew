import { moneyValue } from "./financeDesk.helpers.js";
import {
  assignedBank,
  assignedExecutive,
  carPrice,
  customerCity,
  customerName,
  displayDate,
  executiveMobile,
  financeManager,
  financeManagerMobile,
  generatedDate,
  requiredLoan,
  value,
} from "./deadCases.helpers.js";

function clipped(input, className = "") {
  const text = value(input);
  return <span className={`block max-w-full truncate ${className}`} title={text}>{text}</span>;
}

export function roleColumns(audience, canModify, openEdit) {
  const caseColumn = {
    header: "Case ID",
    cell: (lead) => canModify ? (
      <button type="button" onClick={() => openEdit(lead)} className="block max-w-full truncate text-left font-semibold text-[#0d47a1]" title={value(lead.caseId || lead.id)}>
        {value(lead.caseId || lead.id)}
      </button>
    ) : clipped(lead.caseId || lead.id, "font-semibold text-slate-800"),
  };
  const common = {
    customer: { header: "Customer Name", cell: (lead) => clipped(customerName(lead)) },
    mobile: { header: "Mobile Number", cell: (lead) => clipped(lead.mobile || lead.customerMobile) },
    city: { header: "Customer City", cell: (lead) => clipped(customerCity(lead)) },
    assignedBank: { header: "Assigned Bank", cell: (lead) => clipped(assignedBank(lead)) },
    loanAmount: { header: "Loan Amount", cell: (lead) => clipped(moneyValue(requiredLoan(lead))) },
    requiredLoan: { header: "Required Loan Amount", cell: (lead) => clipped(moneyValue(requiredLoan(lead))) },
    carPrice: { header: "Car On-Road Price", cell: (lead) => clipped(moneyValue(carPrice(lead))) },
    generatedDate: { header: "Generated Date", cell: (lead) => clipped(displayDate(generatedDate(lead))) },
    financeManager: { header: "Finance Manager", cell: (lead) => clipped(financeManager(lead)) },
    financeManagerMobile: { header: "Finance Manager Mobile", cell: (lead) => clipped(financeManagerMobile(lead)) },
    executive: { header: "Assigned Executive", cell: (lead) => clipped(assignedExecutive(lead)) },
    executiveMobile: { header: "Executive Mobile", cell: (lead) => clipped(executiveMobile(lead)) },
    reason: { header: "Dead Reason", cell: (lead) => clipped(lead.deadCaseReason) },
    notes: { header: "Dead Notes", cell: (lead) => clipped(lead.deadCaseNotes) },
    deadDate: { header: "Dead Date", cell: (lead) => clipped(displayDate(lead.deadCaseDate)) },
  };
  const financeGm = [caseColumn, common.customer, common.mobile, common.city, common.assignedBank, common.loanAmount, common.generatedDate, common.financeManager, common.executive, common.executiveMobile, common.reason, common.notes, common.deadDate];
  if (audience === "bank") return [caseColumn, common.customer, common.mobile, common.city, common.carPrice, common.requiredLoan, common.generatedDate, common.financeManager, common.financeManagerMobile, common.executive, common.executiveMobile, common.reason, common.notes, common.deadDate];
  if (audience === "executive") return [caseColumn, common.customer, common.mobile, common.city, common.carPrice, common.requiredLoan, common.generatedDate, common.financeManager, common.financeManagerMobile, common.reason, common.notes, common.deadDate];
  if (audience === "salesperson") return [caseColumn, common.customer, common.mobile, common.city, common.assignedBank, common.requiredLoan, common.generatedDate, common.reason, common.notes, common.deadDate];
  return financeGm;
}
