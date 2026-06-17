import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LEAD_TABLE_LABELS } from "../../constants/leadTableLabels.js";
import { CURRENT_WORKFLOW_STATUS_OPTIONS, LEAD_STATUSES, normalizeStatus, statusLabel as standardStatusLabel } from "../../constants/status.js";
import { mutationUrlMatches, useRoleLeadRealtime } from "../../hooks/useRealtimeRefresh.js";
import { useRealtimeLeadPatch } from "../../hooks/useRealtimeEntityPatch.js";
import { useCursorPager } from "../../hooks/useCursorPager.js";
import { api, getCachedGetData } from "../../services/api.js";
import { normalizePagedResponse } from "../../services/apiResponse.js";
import { usePageLatency } from "../../services/frontendLatency.js";
import { cachedLeadRows, scheduleLeadPrefetch } from "../../services/leadInstantData.js";
import { portalLeadStatusLabel } from "../../utils/portalDisplay.js";
import { AddLeadOnlyScreen } from "./finance/AddLeadOnlyScreen.jsx";
import { BankTieUpsScreen } from "./finance/BankTieUpsScreen.jsx";
import { FinanceManagerManagementScreen, SalespersonManagementScreen } from "./finance/FinanceStaffManagementScreens.jsx";
import { FINANCE_PAGE_SIZE as pageSize, FinanceTable as Table, SectionTitle } from "./finance/FinanceDeskPanelParts.jsx";
import { useFinanceManagers, useSalespersons } from "./finance/financeStaff.hooks.js";
import { StaffManagementScreen } from "./finance/StaffManagementScreen.jsx";
import { dateTime, display, moneyValue } from "./financeDesk.helpers.js";

const leadMutationFilter = (detail) => mutationUrlMatches(detail, ["/dealer/leads", "/dealer/dead-cases", "/bank/leads", "/gm/leads", "/documents"]);
const statusTabs = CURRENT_WORKFLOW_STATUS_OPTIONS.map((value) => ({ label: standardStatusLabel(value), value }));

function caseId(lead) {
  return lead.caseId || lead.id;
}

function bankDisplay(lead) {
  return lead.assignedBankName || lead.bankName || lead.selectedBankName || lead.bankPartner || "";
}

function workflowStatus(value) {
  const normalized = normalizeStatus(value);
  if (normalized === LEAD_STATUSES.ASSIGNED) return LEAD_STATUSES.NEW;
  if ([LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW, LEAD_STATUSES.APPROVED].includes(normalized)) return LEAD_STATUSES.UNDER_BANK_PROCESS;
  if (normalized === LEAD_STATUSES.DOCS_PENDING) return LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS;
  return normalized;
}

function financeStatus(lead) {
  return portalLeadStatusLabel(lead);
}

function StatusBadge({ lead }) {
  const label = financeStatus(lead);
  return <span className="text-xs font-normal text-slate-700">{label}</span>;
}

function useDealerLeads(filters = {}) {
  const initialParams = { page: 1, limit: pageSize, ...filters };
  const cached = getCachedGetData("/dealer/leads", initialParams);
  const fallbackRows = cached ? [] : cachedLeadRows("/dealer/leads", { status: filters.status, search: filters.search, limit: pageSize });
  const cachedPayload = cached
    ? normalizePagedResponse(cached, { defaultLimit: pageSize })
    : { data: fallbackRows, total: fallbackRows.length, hasMore: false, nextCursor: "" };
  const [leads, setLeads] = useState(() => cachedPayload?.data || []);
  const [total, setTotal] = useState(() => cachedPayload?.total || 0);
  const [hasMore, setHasMore] = useState(() => Boolean(cachedPayload?.hasMore || cachedPayload?.nextCursor));
  const [loading, setLoading] = useState(false);
  const { cursorParamsForPage, rememberNextCursor } = useCursorPager([filters.status || "", filters.salespersonId || "", filters.financeManagerId || "", filters.search || ""]);
  const loadLeads = useCallback(async (next = {}) => {
    const silent = next.silent === true;
    if (!silent) setLoading(true);
    try {
      const { silent: _silent, ...params } = next;
      const targetPage = Math.max(Number(params.page || 1), 1);
      const response = await api.get("/dealer/leads", { params: { page: targetPage, limit: pageSize, ...filters, ...params, ...cursorParamsForPage(targetPage) } });
      const payload = normalizePagedResponse(response, { defaultLimit: pageSize });
      const rows = payload.data || [];
      setLeads(rows);
      setHasMore(Boolean(payload.hasMore || payload.nextCursor));
      rememberNextCursor(targetPage, payload.nextCursor);
      setTotal(Number.isFinite(Number(payload.total)) ? Number(payload.total) : (targetPage - 1) * pageSize + rows.length + (payload.hasMore || payload.nextCursor ? 1 : 0));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filters.status, filters.salespersonId, filters.financeManagerId, filters.search, cursorParamsForPage, rememberNextCursor]);

  useEffect(() => {
    loadLeads({ silent: true });
  }, [loadLeads]);
  useEffect(() => {
    scheduleLeadPrefetch("/dealer/leads", CURRENT_WORKFLOW_STATUS_OPTIONS, { limit: pageSize, search: filters.search || "" });
  }, [filters.search]);
  useRealtimeLeadPatch({ setRows: setLeads, statusFilter: filters.status });
  useRoleLeadRealtime({ onRefresh: loadLeads, pageSize, mutationFilter: leadMutationFilter });
  return { leads, total, hasMore, loading, loadLeads };
}

function DocumentsButton({ lead }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(`/finance/leads/${lead.id}/documents`)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">View Documents</button>;
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
      cells.push(<DocumentsButton key="docs" lead={lead} />);
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
          <DocumentsButton key="docs" lead={lead} />,
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
        <DocumentsButton key="docs" lead={lead} />,
      ],
    };
  });
}

export function FinanceDeskPanel({ mode = "total" }) {
  usePageLatency("FinanceDesk", { mode });
  if (mode === "add") return <AddLeadOnlyScreen />;
  if (mode === "bank-tieups") return <BankTieUpsScreen />;
  if (mode === "staff") return <StaffManagementScreen />;
  if (mode === "finance-managers") return <FinanceManagerManagementScreen />;
  if (mode === "salespersons") return <SalespersonManagementScreen />;
  if (mode === "active-salespersons") return <ActiveSalespersonsScreen />;
  if (mode === "cases") return <AllCasesScreen />;
  if (mode === "status") return <StatusScreen />;
  return <TotalLeadsScreen />;
}

function TotalLeadsScreen() {
  const [page, setPage] = useState(1);
  const { leads, total, hasMore, loading, loadLeads } = useDealerLeads();
  const pageTo = (nextPage) => {
    setPage(nextPage);
    loadLeads({ page: nextPage });
  };
  return (
    <div className="space-y-4">
      <SectionTitle title="Total Leads" subtitle="All cases submitted by this dealership finance desk." />
      <Table headers={["Case ID", "Customer Name", "Mobile Number", "Customer City", "Assigned Bank", "Loan Amount", LEAD_TABLE_LABELS.generatedDate, "Finance Manager", LEAD_TABLE_LABELS.currentStatus, LEAD_TABLE_LABELS.assignedExecutive, LEAD_TABLE_LABELS.executiveMobile, "Documents"]} rows={leadRows(leads)} loading={loading} page={page} total={total} hasMore={hasMore} onPage={pageTo} />
    </div>
  );
}

function ActiveSalespersonsScreen() {
  const { salespersons, loading } = useSalespersons();
  const rows = salespersons.map((person) => ({ key: person.id, cells: [person.name, person.mobile, person.jobId, person.email] }));
  return (
    <div className="space-y-4">
      <SectionTitle title="Active Salespersons" subtitle="Only active salespersons attached to this dealership." />
      <Table headers={["Salesperson Name", "Mobile Number", "Job ID", "Mail ID"]} rows={rows} loading={loading} />
    </div>
  );
}

function AllCasesScreen() {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(Number(params.get("page") || 1));
  const salespersonId = params.get("salespersonId") || "";
  const financeManagerId = params.get("financeManagerId") || "";
  const search = params.get("search") || "";
  const { salespersons } = useSalespersons();
  const { financeManagers } = useFinanceManagers();
  const filters = useMemo(() => ({ salespersonId, financeManagerId, search }), [salespersonId, financeManagerId, search]);
  const { leads, total, hasMore, loading, loadLeads } = useDealerLeads(filters);
  const updateFilter = (next) => {
    const merged = { salespersonId, financeManagerId, search, page: "1", ...next };
    Object.keys(merged).forEach((key) => !merged[key] && delete merged[key]);
    setPage(1);
    setParams(merged);
    loadLeads({ ...merged, page: 1 });
  };
  const pageTo = (nextPage) => {
    setPage(nextPage);
    loadLeads({ page: nextPage });
  };
  return (
    <div className="space-y-4">
      <SectionTitle title="All Cases" subtitle="Main dealership monitoring page with salesperson and Finance Manager filtering." />
      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-[1fr_220px_220px]">
        <div className="flex items-center gap-2"><Search className="h-4 w-4 text-slate-400" /><input className="h-9 flex-1 outline-none" placeholder="Search customer or mobile" defaultValue={search} onChange={(e) => updateFilter({ search: e.target.value })} /></div>
        <select className="field" value={salespersonId} onChange={(e) => updateFilter({ salespersonId: e.target.value })}>
          <option value="">Filter By Salesperson</option>
          {salespersons.map((person) => <option key={person.id} value={person.id}>{person.name} - {person.jobId}</option>)}
        </select>
        <select className="field" value={financeManagerId} onChange={(e) => updateFilter({ financeManagerId: e.target.value })}>
          <option value="">Filter By Finance Manager</option>
          {financeManagers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name} - {manager.employeeId}</option>)}
        </select>
      </div>
      <Table headers={["Case ID", "Customer Name", "Mobile Number", "Customer City", "Car On-Road Price", "Required Loan Amount", "Assigned Bank", "Finance Manager", LEAD_TABLE_LABELS.assignedExecutive, LEAD_TABLE_LABELS.executiveMobile, LEAD_TABLE_LABELS.currentStatus, LEAD_TABLE_LABELS.lastUpdated, "Documents"]} rows={leadRows(leads, "cases")} loading={loading} page={page} total={total} hasMore={hasMore} onPage={pageTo} />
    </div>
  );
}

function StatusScreen() {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(Number(params.get("page") || 1));
  const requestedStatus = params.get("status") || CURRENT_WORKFLOW_STATUS_OPTIONS[0];
  const status = CURRENT_WORKFLOW_STATUS_OPTIONS.includes(normalizeStatus(requestedStatus))
    ? normalizeStatus(requestedStatus)
    : CURRENT_WORKFLOW_STATUS_OPTIONS[0];
  const { leads, total, hasMore, loading, loadLeads } = useDealerLeads({ status });
  const choose = (value) => {
    setPage(1);
    const next = { status: value, page: "1" };
    Object.keys(next).forEach((key) => !next[key] && delete next[key]);
    setParams(next);
    loadLeads({ ...next, page: 1 });
  };
  const pageTo = (nextPage) => {
    setPage(nextPage);
    loadLeads({ page: nextPage, status });
  };
  const rejected = normalizeStatus(status) === LEAD_STATUSES.REJECTED;
  return (
    <div className="space-y-4">
      <SectionTitle title="Status" subtitle="Status lists update from Loan Executive changes." />
      <div className="flex flex-wrap gap-2">
        {statusTabs.map((item) => <button key={item.value} onClick={() => choose(item.value)} className={`rounded-md border px-3 py-2 text-sm font-medium ${status === item.value ? "border-[#0d47a1] bg-[#0d47a1] text-white" : "border-slate-200 bg-white text-slate-700"}`}>{item.label}</button>)}
      </div>
      <Table headers={rejected ? ["Case ID", "Customer Name", "Mobile Number", "Loan Amount", LEAD_TABLE_LABELS.currentStatus, "Rejection Reason", "Finance Manager", LEAD_TABLE_LABELS.assignedExecutive, LEAD_TABLE_LABELS.executiveMobile, LEAD_TABLE_LABELS.lastUpdated, "Documents"] : ["Case ID", "Customer Name", "Mobile Number", "Loan Amount", LEAD_TABLE_LABELS.currentStatus, "Finance Manager", LEAD_TABLE_LABELS.assignedExecutive, LEAD_TABLE_LABELS.executiveMobile, LEAD_TABLE_LABELS.lastUpdated, "Documents"]} rows={leadRows(leads, "status")} loading={loading} page={page} total={total} hasMore={hasMore} onPage={pageTo} />
    </div>
  );
}
