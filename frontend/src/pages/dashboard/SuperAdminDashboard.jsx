import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Building2, ClipboardCheck, Landmark, Search, Shield, Users } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { StatusBadge } from "../../components/StatusBadge.jsx";
import { LEAD_TABLE_LABELS } from "../../constants/leadTableLabels.js";
import { ADMIN_STATUS_OPTIONS, BANK_STATUS_OPTIONS, LEAD_STATUSES, statusLabel } from "../../constants/status.js";
import { useDebouncedValue } from "../../hooks/useDebouncedValue.js";
import { useRoleLeadRealtime } from "../../hooks/useRealtimeRefresh.js";
import { useRealtimeLeadPatch } from "../../hooks/useRealtimeEntityPatch.js";
import { api, getCachedGetData } from "../../services/api.js";
import { normalizeRows } from "../../services/apiResponse.js";
import { usePageLatency } from "../../services/frontendLatency.js";
import { cachedLeadRows, scheduleLeadPrefetch } from "../../services/leadInstantData.js";
import { DataTable, MetricCard, PageTitle } from "./superAdmin/SuperAdminParts.jsx";
export { SuperAdminApprovalDetailPage } from "./superAdmin/SuperAdminApprovalDetailPage.jsx";
export { SuperAdminDealershipDetailPage } from "./superAdmin/SuperAdminDealershipDetailPage.jsx";
export { SuperAdminLeadDetailPage } from "./superAdmin/SuperAdminLeadDetailPage.jsx";
import { SystemSettings } from "./superAdmin/SuperAdminSettings.jsx";
import { adminLeadMutationFilter, useAdminEcosystem } from "./superAdmin/superAdmin.hooks.js";
import {
  approvalRatio,
  assignmentDisplay,
  bankCapacityDisplay,
  bankIfscDisplay,
  caseId,
  display,
  downloadCsv,
  enterpriseLeadStatus,
  formatDate,
  generatedAt,
  leadStatus,
  superAdminMoney as money,
  SUPER_ADMIN_PAGE_SIZE as pageSize,
} from "./superAdmin/superAdmin.helpers.js";

function Filters({ search, setSearch, status, setStatus, options = [] }) {
  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-4">
      <div className="relative md:col-span-2">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
        <input className="h-9 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-[#0d47a1]" placeholder="Search records" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      {options.length ? <select className="h-9 rounded-md border border-slate-200 px-3 text-sm text-slate-700 outline-none focus:border-[#0d47a1]" value={status} onChange={(event) => setStatus(event.target.value)}>
        <option value="">All statuses</option>
        {options.map((item) => <option key={item} value={item}>{statusLabel(item) || item}</option>)}
      </select> : null}
    </div>
  );
}

function DashboardView({ data }) {
  const navigate = useNavigate();
  const activeDealerships = data.pendingDealershipApprovals.filter((request) => request.status === "approved" && (request.accountType || request.type || "dealership") === "dealership").length || data.dealerships.filter((item) => item.active !== false).length;
  const activeBranches = data.branches.filter((item) => item.active !== false).length || data.branchManagers.length;
  const activeExecutives = data.loanExecutives.filter((item) => item.active !== false && item.status !== "inactive").length;
  const approved = data.leads.filter((lead) => leadStatus(lead) === LEAD_STATUSES.APPROVED).length;
  const rejected = data.leads.filter((lead) => leadStatus(lead) === LEAD_STATUSES.REJECTED).length;
  const disbursedAmount = data.leads.filter((lead) => leadStatus(lead) === LEAD_STATUSES.DISBURSED).reduce((sum, lead) => sum + Number(lead.disbursedAmount || lead.loanAmount || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const rows = data.auditLogs.slice(0, 10).map((event) => ({
    key: event.id || event.timestamp,
    cells: [
      formatDate(event.createdAt || event.timestamp),
      event.actionType || "System activity",
      event.meta?.dealershipName || event.meta?.bankName || "-",
      event.meta?.branchId || event.branchId || "-",
      event.actorId || event.actorEmail || "-",
      event.newValue ? <StatusBadge status={event.newValue} /> : "-",
      <button key="view" className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View</button>,
    ],
  }));

  return (
    <section className="space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Super Admin</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Master ecosystem control</h1>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Total Leads" value={data.analytics.totalLeads || data.leads.length} icon={BarChart3} onClick={() => navigate("/admin/leads")} />
        <MetricCard label="Active Dealerships" value={activeDealerships} icon={Building2} onClick={() => navigate("/admin/dealerships")} />
        <MetricCard label="Active Branches" value={activeBranches} icon={Landmark} onClick={() => navigate("/admin/branches")} />
        <MetricCard label="Active Executives" value={activeExecutives} icon={Users} onClick={() => navigate("/admin/executives")} />
        <MetricCard label="Approved Cases" value={approved} icon={ClipboardCheck} onClick={() => navigate("/admin/leads?status=APPROVED")} />
        <MetricCard label="Rejected Cases" value={rejected} icon={Shield} onClick={() => navigate("/admin/leads?status=REJECTED")} />
        <MetricCard label="Disbursed Amount" value={`Rs. ${money.format(disbursedAmount)}`} icon={Landmark} onClick={() => navigate("/admin/leads?status=DISBURSED")} />
        <MetricCard label="Daily Lead Volume" value={data.leads.filter((lead) => (lead.createdAt || "").startsWith(today)).length} icon={BarChart3} onClick={() => navigate("/admin/leads")} />
        <MetricCard label="Monthly Approval Ratio" value={approvalRatio(data.leads)} icon={ClipboardCheck} onClick={() => navigate("/admin/analytics")} />
      </div>
      <DataTable title="Recent System Activity" headers={["Time", "Event", "Dealership", "Branch", "Executive", "Status", "Actions"]} rows={rows} loading={data.loading} />
    </section>
  );
}

function usePagedRows(rows) {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") || 1);
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const onPage = (nextPage) => setParams((current) => {
    const next = Object.fromEntries(current.entries());
    next.page = String(nextPage);
    return next;
  });
  return { page, pageRows, onPage };
}

function textMatch(item, search) {
  return !search || JSON.stringify(item).toLowerCase().includes(search.toLowerCase());
}

function responseRows(response) {
  return normalizeRows(response);
}

const STATUS_FILTERS = BANK_STATUS_OPTIONS.map((value) => ({ label: statusLabel(value), value }));

function adminPanelRequest(mode, search, leadFilter) {
  if (mode === "dealerships") return { url: "/admin/approvals/dealerships", params: { status: "approved", search } };
  if (mode === "approval-dealerships") return { url: "/admin/approvals/dealerships", params: { status: "pending", search } };
  if (mode === "banks") return { url: "/admin/approvals/banks", params: { status: "approved", search } };
  if (mode === "approval-banks") return { url: "/admin/approvals/banks", params: { status: "pending", search } };
  if (mode === "status") return { url: "/admin/leads", params: { status: leadFilter || LEAD_STATUSES.NEW, search } };
  return { url: "/admin/leads", params: { search } };
}

function useAdminPanelData(mode, search, leadFilter) {
  const initialRequest = adminPanelRequest(mode, search, leadFilter);
  const cached = getCachedGetData(initialRequest.url, initialRequest.params);
  const fallbackRows = !cached && initialRequest.url === "/admin/leads"
    ? cachedLeadRows("/admin/leads", { status: mode === "status" ? leadFilter || LEAD_STATUSES.NEW : "", search, limit: pageSize })
    : [];
  const [rows, setRows] = useState(() => (cached ? responseRows({ data: cached }) : fallbackRows));
  const [loading, setLoading] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      if (mode === "dealerships") {
        const response = await api.get("/admin/approvals/dealerships", { params: { status: "approved", search } });
        setRows(responseRows(response));
      } else if (mode === "approval-dealerships") {
        const response = await api.get("/admin/approvals/dealerships", { params: { status: "pending", search } });
        setRows(responseRows(response));
      } else if (mode === "banks") {
        const response = await api.get("/admin/approvals/banks", { params: { status: "approved", search } });
        setRows(responseRows(response));
      } else if (mode === "approval-banks") {
        const response = await api.get("/admin/approvals/banks", { params: { status: "pending", search } });
        setRows(responseRows(response));
      } else if (mode === "status") {
        const status = leadFilter || LEAD_STATUSES.NEW;
        const response = await api.get("/admin/leads", { params: { status, search } });
        setRows(responseRows(response));
      } else {
        const response = await api.get("/admin/leads", { params: { search } });
        setRows(responseRows(response));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [leadFilter, mode, search]);

  useEffect(() => { load({ silent: true }); }, [load]);
  useEffect(() => {
    if (mode === "status" || mode === "leads") {
      scheduleLeadPrefetch("/admin/leads", ADMIN_STATUS_OPTIONS, { limit: pageSize, search: search || "" });
    }
  }, [mode, search]);
  useRealtimeLeadPatch({ setRows, statusFilter: mode === "status" ? leadFilter || LEAD_STATUSES.NEW : "", enabled: mode === "status" || mode === "leads" });
  useRoleLeadRealtime({ onRefresh: load, pageSize: 10, mutationFilter: adminLeadMutationFilter });
  return { rows, loading, load };
}

function AdminListPage({ mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") || "");
  const debouncedSearch = useDebouncedValue(search, 180);
  const [updatingId, setUpdatingId] = useState("");
  const leadFilter = params.get("status") || LEAD_STATUSES.NEW;
  const pageData = useAdminPanelData(mode, debouncedSearch, leadFilter);
  const refresh = pageData.load;

  const updateLeadStatus = async (lead, nextStatus) => {
    setUpdatingId(lead.id);
    try {
      await api.patch(`/admin/leads/${lead.id}/status`, { status: nextStatus });
      await refresh();
    } finally {
      setUpdatingId("");
    }
  };

  const approveApplication = async (type, item) => {
    setUpdatingId(item.id);
    try {
      await api.post(`/admin/approvals/${type}/${item.id}/approve`);
      await refresh();
    } finally {
      setUpdatingId("");
    }
  };

  const rejectApplication = async (type, item) => {
    const reason = window.prompt("Enter rejection reason");
    if (!reason?.trim()) return;
    setUpdatingId(item.id);
    try {
      await api.post(`/admin/approvals/${type}/${item.id}/reject`, { reason });
      await refresh();
    } finally {
      setUpdatingId("");
    }
  };

  const suspendApplication = async (item) => {
    const reason = window.prompt("Enter suspension reason", "Suspended by Super Admin");
    if (!reason?.trim()) return;
    setUpdatingId(item.id);
    try {
      await api.post(`/admin/approvals/dealerships/${item.id}/suspend`, { reason });
      await refresh();
    } finally {
      setUpdatingId("");
    }
  };

  const suspendBankApplication = async (item) => {
    const reason = window.prompt("Enter suspension reason", "Suspended by Super Admin");
    if (!reason?.trim()) return;
    setUpdatingId(item.id);
    try {
      await api.post(`/admin/approvals/banks/${item.id}/suspend`, { reason });
      await refresh();
    } finally {
      setUpdatingId("");
    }
  };

  const deleteDealership = async (item) => {
    const label = item.dealershipName || item.name || item.loginEmail || item.id;
    const confirmed = window.confirm(`Delete ${label}? This will remove dealership account, users, approvals, and access records. Existing leads, documents, audit logs, and customer history will remain saved.`);
    if (!confirmed) return;
    setUpdatingId(item.id);
    try {
      await api.delete(`/admin/dealerships/${item.id}/permanent`);
      await refresh();
    } finally {
      setUpdatingId("");
    }
  };

  const deleteBank = async (item) => {
    const label = item.bankName || item.companyName || item.email || item.id;
    const confirmed = window.confirm(`Delete ${label}? This will remove the bank account, users, executives, and approval/profile records. Existing leads, documents, audit logs, and customer history will remain saved.`);
    if (!confirmed) return;
    setUpdatingId(item.id);
    try {
      await api.delete(`/admin/banks/${item.id}/permanent`);
      await refresh();
    } finally {
      setUpdatingId("");
    }
  };

  const setLeadFilter = (value) => {
    setParams((current) => {
      const next = Object.fromEntries(current.entries());
      next.status = value;
      next.page = "1";
      return next;
    });
  };

  const config = useMemo(() => {
    const records = pageData.rows;
    if (mode === "dealerships") {
      return {
        title: "Approved Dealerships",
        headers: ["Dealership Name", "Brand", "Location", "Login Email", "Status", "Actions"],
        rows: records.map((item) => ({ key: item.id, cells: [display(item.dealershipName), display(item.dealershipBrand), display(item.city), display(item.loginEmail || item.email || item.id), display(item.accountActive === false ? "Disabled" : "Active"), <div key="actions" className="flex flex-wrap gap-2"><button onClick={() => navigate(`/admin/dealerships/${item.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View</button><button disabled={updatingId === item.id} onClick={() => deleteDealership(item)} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50">Delete</button></div>] })),
      };
    }
    if (mode === "approval-dealerships") {
      return {
        title: "Pending Approval Dealerships",
        headers: ["Dealership Name", "Brand", "Location", "Selected Plan", "Login Email", "Registration Date", "Status", "Actions"],
        rows: records.map((item) => ({ key: item.id, cells: [display(item.dealershipName), display(item.dealershipBrand), display(item.city), display(item.selectedPlan || "TRIAL"), display(item.loginEmail || item.email), formatDate(item.submittedAt || item.createdAt), display(item.status), <div key="actions" className="flex flex-wrap gap-2"><button onClick={() => navigate(`/admin/approvals/dealerships/${item.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View</button><button disabled={updatingId === item.id} onClick={() => deleteDealership(item)} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50">Delete</button></div>] })),
      };
    }
    if (mode === "banks") {
      return {
        title: "Approved Banks",
        headers: ["Bank Name", "IFSC Code", "Bank Location", "Manager Name", "Manager Mobile", "Official Email", "Monthly Capacity", "Number Of Executives", "Approval Date", "Status", "Actions"],
        rows: records.map((item) => ({ key: item.id, cells: [display(item.bankName || item.companyName), display(item.ifsc), display(item.bankBranchLocation || item.branchLocation || item.city), display(item.managerName || item.contactPerson), display(item.mobile), display(item.email), bankCapacityDisplay(item), display(item.executiveCount), formatDate(item.approvedAt || item.updatedAt), display(item.accountActive === false ? "Disabled" : item.status), <div key="actions" className="flex flex-wrap gap-2"><button onClick={() => navigate(`/admin/approvals/banks/${item.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View</button><button disabled={updatingId === item.id} onClick={() => deleteBank(item)} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50">Delete</button></div>] })),
      };
    }
    if (mode === "approval-banks") {
      return {
        title: "Pending Approval Banks",
        headers: ["Bank Name", "IFSC Code", "Location", "Manager Name", "Manager Mobile", "Official Email", "Monthly Capacity", "Registration Date", "Status", "Actions"],
        rows: records.map((item) => ({ key: item.id, cells: [display(item.bankName || item.companyName), display(item.ifsc), display(item.bankBranchLocation || item.branchLocation || item.city), display(item.managerName || item.contactPerson), display(item.mobile), display(item.email), bankCapacityDisplay(item), formatDate(item.submittedAt || item.createdAt), display(item.status), <div key="actions" className="flex flex-wrap gap-2"><button onClick={() => navigate(`/admin/approvals/banks/${item.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View</button><button disabled={updatingId === item.id} onClick={() => deleteBank(item)} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50">Delete</button></div>] })),
      };
    }
    if (mode === "status") {
      const rejectedReason = leadFilter === "REJECTED_REASON";
      return {
        title: rejectedReason ? "Loan Rejected" : "Status",
        headers: rejectedReason ? ["Case ID", "Customer Name", "Customer Mobile", "Customer City", "Required Loan", LEAD_TABLE_LABELS.assignedExecutive, LEAD_TABLE_LABELS.executiveMobile, LEAD_TABLE_LABELS.currentStatus, "Rejection Reason", "Updated By", LEAD_TABLE_LABELS.lastUpdated] : ["Case ID", "Customer Name", "Customer Mobile", "Customer City", "Required Loan", LEAD_TABLE_LABELS.assignedExecutive, LEAD_TABLE_LABELS.executiveMobile, LEAD_TABLE_LABELS.currentStatus, LEAD_TABLE_LABELS.lastUpdated],
        rows: records.map((lead) => ({ key: lead.id, cells: rejectedReason ? [caseId(lead), display(lead.fullName || lead.customerName), display(lead.mobile), display(lead.city), `Rs. ${money.format(Number(lead.loanAmount || lead.requiredLoanAmount || 0))}`, display(lead.assignedExecutiveName || lead.assignedExecutiveEmail), display(lead.assignedExecutiveMobile || lead.executiveMobile), enterpriseLeadStatus(lead), display(lead.rejectionReason || lead.loanRejectionReason), display(lead.updatedBy || lead.assignedExecutiveEmail), formatDate(lead.updatedAt || lead.statusUpdatedAt || lead.createdAt)] : [caseId(lead), display(lead.fullName || lead.customerName), display(lead.mobile), display(lead.city), `Rs. ${money.format(Number(lead.loanAmount || lead.requiredLoanAmount || 0))}`, display(lead.assignedExecutiveName || lead.assignedExecutiveEmail), display(lead.assignedExecutiveMobile || lead.executiveMobile), enterpriseLeadStatus(lead), formatDate(lead.updatedAt || lead.statusUpdatedAt || lead.createdAt)] })),
      };
    }
    return {
      title: "Total Leads",
      headers: ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Car On-Road Price", "Required Loan Amount", "Dealership Name", "Dealer City", LEAD_TABLE_LABELS.generatedDate, "Assigned Bank Name", "Assigned Bank IFSC Code", LEAD_TABLE_LABELS.assignedExecutive, LEAD_TABLE_LABELS.executiveMobile, LEAD_TABLE_LABELS.currentStatus, LEAD_TABLE_LABELS.lastUpdated, "Documents"],
      rows: records.map((lead) => ({ key: lead.id, cells: [caseId(lead), display(lead.fullName || lead.customerName), display(lead.mobile), display(lead.city || lead.dealershipCity), `Rs. ${money.format(Number(lead.onRoadPrice || lead.carOnRoadPrice || lead.carPrice || 0))}`, `Rs. ${money.format(Number(lead.loanAmount || lead.requiredLoanAmount || 0))}`, assignmentDisplay(lead.dealershipName || lead.dealerName || lead.dealerEmail, "Pending"), display(lead.dealershipCity || lead.city), generatedAt(lead.createdAt), assignmentDisplay(lead.assignedBankName || lead.bankPartner || lead.assignedPartnerId), bankIfscDisplay(lead), assignmentDisplay(lead.assignedExecutiveName || lead.assignedExecutiveEmail), assignmentDisplay(lead.assignedExecutiveMobile || lead.executiveMobile), enterpriseLeadStatus(lead), formatDate(lead.updatedAt || lead.statusUpdatedAt || lead.createdAt), <button key="docs" onClick={() => navigate(`/admin/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View Documents</button>] })),
    };
  }, [leadFilter, mode, navigate, pageData.rows, updatingId]);

  const { page, pageRows, onPage } = usePagedRows(config.rows);
  return (
    <section className="space-y-4">
      <PageTitle mode={mode} />
      <Filters search={search} setSearch={setSearch} status="" setStatus={() => {}} options={[]} />
      {mode === "status" && <div className="flex flex-wrap gap-2">{STATUS_FILTERS.map((item) => <button key={item.value} onClick={() => setLeadFilter(item.value)} className={`rounded-md border px-3 py-2 text-sm font-medium ${leadFilter === item.value ? "border-[#0d47a1] bg-[#0d47a1] text-white" : "border-slate-200 bg-white text-slate-700"}`}>{item.label}</button>)}</div>}
      <DataTable title={config.title} headers={config.headers} rows={pageRows} loading={pageData.loading} page={page} total={config.rows.length} onPage={onPage} onExport={() => downloadCsv(config.title.toLowerCase().replace(/\s+/g, "-"), config.headers, config.rows.map((row) => row.cells.map((cell) => typeof cell === "string" || typeof cell === "number" ? cell : "")))} />
    </section>
  );
}

function actionButtons(labels) {
  return <span className="text-xs text-slate-500">{labels.join(" / ")} API required</span>;
}

function summarize(value) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function SuperAdminDashboard({ mode = "dashboard" }) {
  usePageLatency("SuperAdmin", { mode });
  if (mode === "dashboard") return <AdminListPage mode="leads" />;
  return <AdminListPage mode={mode} />;
}
