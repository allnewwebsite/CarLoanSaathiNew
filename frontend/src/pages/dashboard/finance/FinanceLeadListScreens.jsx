import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LEAD_TABLE_LABELS } from "../../../constants/leadTableLabels.js";
import { CURRENT_WORKFLOW_STATUS_OPTIONS, LEAD_STATUSES, normalizeStatus, statusLabel as standardStatusLabel } from "../../../constants/status.js";
import { portalLeadStatusLabel } from "../../../utils/portalDisplay.js";
import { dateTime, display, moneyValue } from "../financeDesk.helpers.js";
import { FinanceTable as Table, SectionTitle } from "./FinanceDeskPanelParts.jsx";
import { useDealerLeads } from "./financeLeadList.data.js";
import { useActiveMembers, useFinanceManagers, useSalespersons } from "./financeStaff.hooks.js";

const statusTabs = CURRENT_WORKFLOW_STATUS_OPTIONS.map((value) => ({ label: standardStatusLabel(value), value }));

function caseId(lead) {
  return lead.caseId || lead.id;
}

function bankDisplay(lead) {
  return lead.assignedBankName || lead.bankName || lead.selectedBankName || lead.bankPartner || "";
}

function financeStatus(lead) {
  return portalLeadStatusLabel(lead);
}

function StatusBadge({ lead }) {
  const label = financeStatus(lead);
  return <span className="text-xs font-normal text-slate-700">{label}</span>;
}

function normalizedMemberRole(role = "") {
  const value = String(role || "").trim().toLowerCase().replace(/_/g, "-");
  if (value === "general-manager") return "gm";
  if (value === "finance manager") return "finance-manager";
  if (value === "sales") return "salesperson";
  return value;
}

function roleBadgeClass(role = "") {
  const normalized = normalizedMemberRole(role);
  if (normalized === "gm") return "border-blue-100 bg-blue-50 text-blue-700";
  if (normalized === "finance-manager") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  return "border-amber-100 bg-amber-50 text-amber-700";
}

function RoleBadge({ member }) {
  const role = normalizedMemberRole(member.role);
  const fallbackLabel = role === "gm" ? "GM" : role.replace(/-/g, " ");
  const label = String(member.roleLabel || fallbackLabel || "Member").trim().toUpperCase();
  return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${roleBadgeClass(role)}`}>{label}</span>;
}

function MemberStatusBadge({ member }) {
  const inactive = member.active === false || ["inactive", "disabled", "removed"].includes(String(member.status || "").trim().toLowerCase());
  const label = inactive ? "Inactive" : "Active";
  const className = inactive
    ? "border-slate-200 bg-slate-100 text-slate-600"
    : "border-emerald-100 bg-emerald-50 text-emerald-700";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>{label}</span>;
}

function MemberMetricCard({ label, value }) {
  return (
    <div className="rounded-[10px] border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function DocumentsButton({ lead }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(`/finance/leads/${lead.id}/documents`)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">View Documents</button>;
}

function LeadActions({ lead }) {
  return <div className="flex flex-wrap gap-2"><DocumentsButton lead={lead} /></div>;
}

function leadRows(leads, mode = "total") {
  return leads.map((lead) => {
    const base = [
      caseId(lead),
      display(lead.fullName || lead.customerName),
      display(lead.mobile),
      display(lead.city || lead.dealershipCity),
    ];
    if (mode === "status") {
      const cells = [
        caseId(lead),
        display(lead.fullName || lead.customerName),
        display(lead.mobile),
        moneyValue(lead.loanAmount || lead.requiredLoanAmount),
        <StatusBadge key="status" lead={lead} />,
      ];
      if (normalizeStatus(lead.status) === LEAD_STATUSES.REJECTED) cells.push(display(lead.rejectionReason));
      cells.push(
        display(lead.financeManagerName || lead.assignedFinanceManager),
        display(lead.assignedExecutiveName),
        display(lead.assignedExecutiveMobile || lead.executiveMobile),
        dateTime(lead.statusUpdatedAt || lead.updatedAt || lead.createdAt),
      );
      cells.push(<LeadActions key="actions" lead={lead} />);
      return { key: lead.id, cells };
    }
    if (mode === "cases") {
      return {
        key: lead.id,
        cells: [
          ...base,
          moneyValue(lead.carPrice || lead.carOnRoadPrice),
          moneyValue(lead.loanAmount || lead.requiredLoanAmount),
          display(lead.bankPartner || lead.assignedBankName),
          display(lead.financeManagerName || lead.assignedFinanceManager),
          display(lead.assignedExecutiveName),
          display(lead.assignedExecutiveMobile || lead.executiveMobile),
          <StatusBadge key="status" lead={lead} />,
          dateTime(lead.statusUpdatedAt || lead.updatedAt || lead.createdAt),
          <LeadActions key="actions" lead={lead} />,
        ],
      };
    }
    return {
      key: lead.id,
      cells: [
        ...base,
        display(bankDisplay(lead)),
        moneyValue(lead.loanAmount || lead.requiredLoanAmount),
        dateTime(lead.generatedAt || lead.createdAt),
        display(lead.financeManagerName || lead.assignedFinanceManager),
        <StatusBadge key="status" lead={lead} />,
        display(lead.assignedExecutiveName),
        display(lead.assignedExecutiveMobile || lead.executiveMobile),
        <LeadActions key="actions" lead={lead} />,
      ],
    };
  });
}

export function TotalLeadsScreen() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(Number(params.get("page") || 1), 1);
  const { leads, total, hasMore, loading } = useDealerLeads({ page });
  const pageTo = (nextPage) => {
    setParams({ page: String(Math.max(Number(nextPage || 1), 1)) });
  };
  return (
    <div className="space-y-4">
      <SectionTitle title="Total Leads" subtitle="All cases submitted by this dealership finance desk." />
      <Table headers={["Case ID", "Customer Name", "Mobile Number", "Customer City", "Assigned Bank", "Loan Amount", LEAD_TABLE_LABELS.generatedDate, "Finance Manager", LEAD_TABLE_LABELS.currentStatus, LEAD_TABLE_LABELS.assignedExecutive, LEAD_TABLE_LABELS.executiveMobile, "Actions"]} rows={leadRows(leads, "total")} loading={loading} page={page} total={total} hasMore={hasMore} onPage={pageTo} />
    </div>
  );
}

export function ActiveMembersScreen() {
  const { members, loading } = useActiveMembers();
  const stats = useMemo(() => {
    const activeMembers = members.filter((member) => member.active !== false && !["inactive", "disabled", "removed"].includes(String(member.status || "").trim().toLowerCase()));
    return activeMembers.reduce((summary, member) => {
      const role = normalizedMemberRole(member.role);
      summary.total += 1;
      if (role === "gm") summary.gm += 1;
      if (role === "finance-manager") summary.finance += 1;
      if (role === "salesperson") summary.sales += 1;
      return summary;
    }, { total: 0, gm: 0, finance: 0, sales: 0 });
  }, [members]);
  const rows = members.map((member) => ({
    key: member.id || member.memberId,
    cells: [
      display(member.memberName || member.name),
      <RoleBadge key="role" member={member} />,
      display(member.mobile),
      display(member.email),
      <MemberStatusBadge key="status" member={member} />,
      dateTime(member.createdAt),
    ],
  }));
  return (
    <div className="space-y-6">
      <SectionTitle title="Active Members" subtitle="Active dealership members across sales, finance, and GM roles." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MemberMetricCard label="Total Members" value={stats.total} />
        <MemberMetricCard label="GM Count" value={stats.gm} />
        <MemberMetricCard label="Finance Count" value={stats.finance} />
        <MemberMetricCard label="Sales Count" value={stats.sales} />
      </div>
      <Table
        headers={["Member Name", "Role", "Mobile", "Email", "Status", "Created Date"]}
        rows={rows}
        loading={loading}
        fitToWidth
        tableMinWidth="100%"
        gridTemplateColumns="minmax(140px,1.1fr) minmax(130px,0.9fr) minmax(120px,0.8fr) minmax(190px,1.4fr) minmax(110px,0.7fr) minmax(150px,0.9fr)"
      />
    </div>
  );
}

export function AllCasesScreen() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(Number(params.get("page") || 1), 1);
  const salespersonId = params.get("salespersonId") || "";
  const financeManagerId = params.get("financeManagerId") || "";
  const { salespersons } = useSalespersons();
  const { financeManagers } = useFinanceManagers();
  const filters = useMemo(() => ({ salespersonId, financeManagerId, page }), [salespersonId, financeManagerId, page]);
  const { leads, total, hasMore, loading } = useDealerLeads(filters);
  const updateFilter = (next) => {
    const merged = { salespersonId, financeManagerId, page: "1", ...next };
    Object.keys(merged).forEach((key) => !merged[key] && delete merged[key]);
    setParams(merged);
  };
  const pageTo = (nextPage) => {
    const next = { salespersonId, financeManagerId, page: String(Math.max(Number(nextPage || 1), 1)) };
    Object.keys(next).forEach((key) => !next[key] && delete next[key]);
    setParams(next);
  };
  return (
    <div className="space-y-4">
      <SectionTitle title="All Cases" subtitle="Main dealership monitoring page with salesperson and Finance Manager filtering." />
      <div className="flex flex-col gap-3 rounded-[10px] border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:justify-end">
        <select className="field h-11 sm:w-64" value={salespersonId} onChange={(event) => updateFilter({ salespersonId: event.target.value })}>
          <option value="">Select Salesperson</option>
          {salespersons.map((person) => <option key={person.id} value={person.id}>{person.name} - {person.jobId}</option>)}
        </select>
        <select className="field h-11 sm:w-64" value={financeManagerId} onChange={(event) => updateFilter({ financeManagerId: event.target.value })}>
          <option value="">Select Finance Manager</option>
          {financeManagers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name} - {manager.employeeId}</option>)}
        </select>
      </div>
      <Table headers={["Case ID", "Customer Name", "Mobile Number", "Customer City", "Car On-Road Price", "Required Loan Amount", "Assigned Bank", "Finance Manager", LEAD_TABLE_LABELS.assignedExecutive, LEAD_TABLE_LABELS.executiveMobile, LEAD_TABLE_LABELS.currentStatus, LEAD_TABLE_LABELS.lastUpdated, "Actions"]} rows={leadRows(leads, "cases")} loading={loading} page={page} total={total} hasMore={hasMore} onPage={pageTo} />
    </div>
  );
}

export function StatusScreen() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(Number(params.get("page") || 1), 1);
  const requestedStatus = params.get("status") || CURRENT_WORKFLOW_STATUS_OPTIONS[0];
  const status = CURRENT_WORKFLOW_STATUS_OPTIONS.includes(normalizeStatus(requestedStatus))
    ? normalizeStatus(requestedStatus)
    : CURRENT_WORKFLOW_STATUS_OPTIONS[0];
  const { leads, total, hasMore, loading } = useDealerLeads({ status, page });
  const choose = (value) => {
    const next = { status: value, page: "1" };
    Object.keys(next).forEach((key) => !next[key] && delete next[key]);
    setParams(next);
  };
  const pageTo = (nextPage) => {
    setParams({ status, page: String(Math.max(Number(nextPage || 1), 1)) });
  };
  const rejected = normalizeStatus(status) === LEAD_STATUSES.REJECTED;
  return (
    <div className="space-y-4">
      <SectionTitle title="Status" subtitle="Status lists update from Loan Executive changes." />
      <div className="flex flex-wrap gap-2">
        {statusTabs.map((item) => <button key={item.value} onClick={() => choose(item.value)} className={`rounded-md border px-3 py-2 text-sm font-medium ${status === item.value ? "border-[#0d47a1] bg-[#0d47a1] text-white" : "border-slate-200 bg-white text-slate-700"}`}>{item.label}</button>)}
      </div>
      <Table headers={rejected ? ["Case ID", "Customer Name", "Mobile Number", "Loan Amount", LEAD_TABLE_LABELS.currentStatus, "Rejection Reason", "Finance Manager", LEAD_TABLE_LABELS.assignedExecutive, LEAD_TABLE_LABELS.executiveMobile, LEAD_TABLE_LABELS.lastUpdated, "Actions"] : ["Case ID", "Customer Name", "Mobile Number", "Loan Amount", LEAD_TABLE_LABELS.currentStatus, "Finance Manager", LEAD_TABLE_LABELS.assignedExecutive, LEAD_TABLE_LABELS.executiveMobile, LEAD_TABLE_LABELS.lastUpdated, "Actions"]} rows={leadRows(leads, "status")} loading={loading} page={page} total={total} hasMore={hasMore} onPage={pageTo} />
    </div>
  );
}
