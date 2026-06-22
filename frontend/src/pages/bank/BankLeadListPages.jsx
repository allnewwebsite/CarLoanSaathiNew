import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LEAD_TABLE_LABELS } from "../../constants/leadTableLabels.js";
import { CURRENT_WORKFLOW_STATUS_OPTIONS, LEAD_STATUSES, normalizeStatus, statusLabel as standardStatusLabel } from "../../constants/status.js";
import { BankManagerTable as Table, PageTitle } from "./BankManagerPanelParts.jsx";
import { ReassignLeadDialog } from "./ReassignLeadDialog.jsx";
import { useBankLeads } from "./bankManager.hooks.js";
import { caseId, dateTime, display, generatedAt, leadStatusLabel, moneyValue } from "./bankManager.helpers.js";

export function TotalLeadsPage() {
  const navigate = useNavigate();
  const { rows, total, hasMore, loading, page, onPage, load } = useBankLeads("");
  const [executiveFilter, setExecutiveFilter] = useState("");
  const [knownExecutives, setKnownExecutives] = useState([]);
  const [actionError, setActionError] = useState("");
  const [pendingReassign, setPendingReassign] = useState(null);
  useEffect(() => {
    setKnownExecutives((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      rows.forEach((lead) => {
        const id = String(lead.assignedExecutiveId || lead.assignedExecutiveEmail || lead.assignedExecutiveName || "").trim();
        if (!id) return;
        byId.set(id, {
          id,
          name: lead.assignedExecutiveName || lead.assignedExecutiveEmail || id,
        });
      });
      return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
    });
  }, [rows]);
  const visibleRows = useMemo(() => rows.filter((lead) => {
    if (!executiveFilter) return true;
    return [
      lead.assignedExecutiveId,
      lead.assignedExecutiveEmail,
      lead.assignedExecutiveName,
    ].some((value) => String(value || "").trim() === executiveFilter);
  }), [executiveFilter, rows]);
  const tableRows = useMemo(() => visibleRows.map((lead) => ({
    key: lead.id,
    cells: [
      caseId(lead),
      display(lead.fullName || lead.customerName),
      display(lead.mobile),
      display(lead.city || lead.dealershipCity),
      moneyValue(lead.onRoadPrice || lead.carOnRoadPrice),
      moneyValue(lead.loanAmount || lead.requiredLoanAmount),
      generatedAt(lead),
      display(lead.financeManagerName || lead.assignedFinanceManager),
      display(lead.financeManagerMobile),
      display(lead.assignedExecutiveName),
      display(lead.assignedExecutiveMobile || lead.executiveMobile),
      leadStatusLabel(lead),
      <div key="actions" className="flex flex-wrap gap-2">
        <button onClick={() => navigate(`/bank-manager/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View</button>
        <button
          onClick={() => {
            setActionError("");
            setPendingReassign(lead);
          }}
          className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-[#0d47a1]"
        >
          {lead.assignedExecutiveId || lead.assignedExecutiveEmail ? "Reassign" : "Assign"}
        </button>
      </div>,
    ],
  })), [navigate, visibleRows]);
  return (
    <section className="space-y-4">
      <PageTitle title="Total Leads" />
      {actionError ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{actionError}</p> : null}
      <ReassignLeadDialog lead={pendingReassign} onCancel={() => setPendingReassign(null)} onDone={() => load(page, { silent: true })} />
      <div className="flex justify-end">
        <label htmlFor="bank-lead-executive-filter" className="sr-only">Filter leads by executive</label>
        <select id="bank-lead-executive-filter" value={executiveFilter} onChange={(event) => setExecutiveFilter(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100 sm:w-64">
          <option value="">All Executives</option>
          {knownExecutives.map((executive) => <option key={executive.id} value={executive.id}>{executive.name}</option>)}
        </select>
      </div>
      <Table title="Assigned Bank Leads" headers={["Case ID", "Customer Name", "Mobile Number", "Customer City", "Car On-Road Price", "Required Loan Amount", LEAD_TABLE_LABELS.generatedDate, "Finance Manager", "Finance Manager Mobile", LEAD_TABLE_LABELS.assignedExecutive, LEAD_TABLE_LABELS.executiveMobile, LEAD_TABLE_LABELS.currentStatus, "Actions"]} rows={tableRows} loading={loading} page={page} total={total} hasMore={hasMore} onPage={onPage} />
    </section>
  );
}

export function StatusPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedStatus = params.get("status") || CURRENT_WORKFLOW_STATUS_OPTIONS[0];
  const status = CURRENT_WORKFLOW_STATUS_OPTIONS.includes(normalizeStatus(requestedStatus))
    ? normalizeStatus(requestedStatus)
    : CURRENT_WORKFLOW_STATUS_OPTIONS[0];
  const { rows, total, hasMore, loading, page, onPage } = useBankLeads("", status);
  const choose = (nextStatus) => setParams({ status: nextStatus, page: "1" });
  const tableRows = useMemo(() => rows.map((lead) => ({
    key: lead.id,
    cells: [
      caseId(lead),
      display(lead.fullName || lead.customerName),
      display(lead.mobile),
      display(lead.city || lead.dealershipCity),
      moneyValue(lead.loanAmount || lead.requiredLoanAmount),
      leadStatusLabel(lead),
      dateTime(lead.statusUpdatedAt || lead.updatedAt || lead.createdAt),
      ...(normalizeStatus(status) === LEAD_STATUSES.REJECTED ? [display(lead.rejectionReason || lead.loanRejectionReason)] : []),
      display(lead.assignedExecutiveName || lead.assignedExecutiveEmail),
      <button key="docs" onClick={() => navigate(`/bank-manager/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">Documents</button>,
    ],
  })), [navigate, rows, status]);
  const headers = normalizeStatus(status) === LEAD_STATUSES.REJECTED
    ? ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Loan Amount", LEAD_TABLE_LABELS.currentStatus, LEAD_TABLE_LABELS.lastUpdated, "Rejection Reason", LEAD_TABLE_LABELS.assignedExecutive, "Documents"]
    : ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Loan Amount", LEAD_TABLE_LABELS.currentStatus, LEAD_TABLE_LABELS.lastUpdated, LEAD_TABLE_LABELS.assignedExecutive, "Documents"];
  return (
    <section className="space-y-4">
      <PageTitle title="Status" />
      <div className="flex flex-wrap gap-2">
        {CURRENT_WORKFLOW_STATUS_OPTIONS.map((value) => <button key={value} onClick={() => choose(value)} className={`rounded-md border px-3 py-2 text-sm font-medium ${status === value ? "border-[#0d47a1] bg-[#0d47a1] text-white" : "border-slate-200 bg-white text-slate-700"}`}>{standardStatusLabel(value)}</button>)}
      </div>
      <Table title="Status Cases" headers={headers} rows={tableRows} loading={loading} page={page} total={total} hasMore={hasMore} onPage={onPage} />
    </section>
  );
}
