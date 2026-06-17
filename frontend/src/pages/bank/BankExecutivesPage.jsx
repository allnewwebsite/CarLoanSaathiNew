import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LEAD_TABLE_LABELS } from "../../constants/leadTableLabels.js";
import { BankManagerTable as Table, PageTitle } from "./BankManagerPanelParts.jsx";
import { useExecutiveCases, useExecutives } from "./bankManager.hooks.js";
import { caseId, dateTime, display, leadStatusLabel, moneyValue } from "./bankManager.helpers.js";

export function AllExecutivesPage() {
  const navigate = useNavigate();
  const { rows, loading } = useExecutives();
  const tableRows = useMemo(() => rows.map((executive) => ({
    key: executive.id,
    cells: [
      display(executive.name || executive.fullName),
      display(executive.mobile),
      display(executive.email || executive.officialEmail),
      executive.totalAssignedCases || 0,
      executive.currentActiveCases || 0,
      display(executive.status),
      <button key="cases" onClick={() => navigate(`/bank-manager/executives/${executive.id}/cases`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">All Cases</button>,
    ],
  })), [navigate, rows]);
  return (
    <section className="space-y-4">
      <PageTitle title="All Executives" />
      <Table title="Bank Executives" headers={["Executive Name", "Mobile Number", "Official Email", "Total Assigned Cases", "Current Active Cases", "Status", "All Cases"]} rows={tableRows} loading={loading} />
    </section>
  );
}

export function ExecutiveCasesPage() {
  const { executiveId } = useParams();
  const navigate = useNavigate();
  const { payload, loading } = useExecutiveCases(executiveId);
  const rows = useMemo(() => payload.data.map((lead) => ({
    key: lead.id,
    cells: [
      caseId(lead),
      display(lead.fullName || lead.customerName),
      display(lead.mobile),
      display(lead.city || lead.dealershipCity),
      moneyValue(lead.loanAmount || lead.requiredLoanAmount),
      leadStatusLabel(lead),
      dateTime(lead.assignmentTimestamp || lead.createdAt),
      dateTime(lead.updatedAt || lead.statusUpdatedAt || lead.createdAt),
      <button key="docs" onClick={() => navigate(`/bank-manager/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">Documents</button>,
    ],
  })), [navigate, payload.data]);
  return (
    <section className="space-y-4">
      <PageTitle title={payload.executive ? `${payload.executive.name || payload.executive.fullName} Cases` : "Executive Cases"} />
      <Table title="Assigned Cases" headers={["Case ID", "Customer Name", "Customer Mobile", "Customer City", "Loan Amount", LEAD_TABLE_LABELS.currentStatus, "Assigned Date", LEAD_TABLE_LABELS.lastUpdated, "Documents"]} rows={rows} loading={loading} />
    </section>
  );
}
