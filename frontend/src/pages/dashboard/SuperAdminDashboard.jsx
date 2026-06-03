import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Building2, ClipboardCheck, Download, FileClock, Landmark, Search, Shield, Users } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { DetailPageSkeleton } from "../../components/ui/Loading.jsx";
import { StatusBadge } from "../../components/StatusBadge.jsx";
import { ADMIN_STATUS_OPTIONS, LEAD_STATUSES, normalizeStatus, statusLabel } from "../../constants/status.js";
import { useRoleLeadRealtime } from "../../hooks/useRealtimeRefresh.js";
import { api } from "../../services/api.js";

const pageSize = 10;
const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

function display(value) {
  return value || "-";
}

function assignmentDisplay(value, fallback = "Not Assigned") {
  return value === undefined || value === null || value === "" ? fallback : value;
}

function bankIfscDisplay(lead) {
  return lead.assignedBankIfsc || lead.bankIfsc || lead.ifsc || "IFSC Pending";
}

function caseId(lead) {
  return lead?.caseId || lead?.id || "-";
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function leadStatus(lead) {
  return normalizeStatus(lead.status || LEAD_STATUSES.NEW);
}

function slaState(lead) {
  const value = lead.slaAcceptDeadlineAt || lead.assignmentTimestamp;
  if (!value) return "Tracked";
  const deadline = lead.slaAcceptDeadlineAt ? new Date(value).getTime() : new Date(value).getTime() + 60 * 60 * 1000;
  return deadline <= Date.now() ? "Overdue" : "Active";
}

function approvalRatio(leads) {
  if (!leads.length) return "0%";
  const approved = leads.filter((lead) => [LEAD_STATUSES.APPROVED, LEAD_STATUSES.DISBURSED].includes(leadStatus(lead))).length;
  return `${Math.round((approved / leads.length) * 100)}%`;
}

function enterpriseLeadStatus(lead) {
  const status = leadStatus(lead);
  if (status === LEAD_STATUSES.NEW) return "New Lead";
  if (status === LEAD_STATUSES.DISBURSED) return "Disbursed";
  if (status === LEAD_STATUSES.REJECTED) return lead.rejectionReason || lead.loanRejectionReason ? "Loan Rejected With Reason" : "Rejected";
  if ([LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.DOCUMENT_RECEIVED, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING].includes(status)) return "Pending Documents";
  if (status === LEAD_STATUSES.CONTACTED) return "Contacted";
  if (status === LEAD_STATUSES.ALL_DOCUMENTS_RECEIVED) return "All Documents Received";
  if (status === LEAD_STATUSES.UNDER_BANK_PROCESS) return "Under Bank Process";
  return "Bank Process";
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(name, headers, rows) {
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

const MetricCard = memo(function MetricCard({ label, value, icon: Icon, onClick }) {
  return (
    <button onClick={onClick} className="rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-[#0d47a1]/40">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
          <p className="mt-2 text-xl font-semibold text-slate-900">{value}</p>
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-50 text-[#0d47a1]">
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </button>
  );
});

function Pagination({ page, total, onPage }) {
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  return (
    <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-4 py-3 text-sm">
      <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded-md border border-slate-200 px-3 py-1.5 text-slate-700 disabled:opacity-50">Prev</button>
      <span className="text-slate-500">Page {page} of {pages}</span>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="rounded-md border border-slate-200 px-3 py-1.5 text-slate-700 disabled:opacity-50">Next</button>
    </div>
  );
}

function DataTable({ title, headers, rows, loading, page, total, onPage, onExport }) {
  const action = onExport ? <button onClick={onExport} className="inline-flex items-center gap-2 rounded-md bg-[#0d47a1] px-3 py-2 text-xs font-medium text-white"><Download className="h-3.5 w-3.5" /> Export</button> : null;
  return <OperationalTable title={title} headers={headers} rows={rows} loading={loading} page={page} total={total} onPage={onPage} pageSize={pageSize} action={action} />;
}

function useAdminEcosystem() {
  const [state, setState] = useState({
    leads: [],
    onboardingRequests: [],
    dealerships: [],
    financeDesks: [],
    dealershipManagers: [],
    bankPartners: [],
    banks: [],
    branches: [],
    branchManagers: [],
    loanExecutives: [],
    assignments: [],
    slaLogs: [],
    reassignmentLogs: [],
    documents: [],
    bankDocuments: [],
    pendingDealershipApprovals: [],
    pendingBankApprovals: [],
    approvalLogs: [],
    pendingGoogleAccounts: [],
    loginActivity: [],
    users: [],
    auditLogs: [],
  });
  const [analytics, setAnalytics] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [ecosystem, analyticsResponse, auditResponse] = await Promise.all([
        api.get("/admin/ecosystem"),
        api.get("/admin/analytics"),
        api.get("/admin/audit-logs"),
      ]);
      setState((current) => ({ ...current, ...(ecosystem.data || {}), auditLogs: auditResponse.data || [] }));
      setAnalytics(analyticsResponse.data || {});
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useRoleLeadRealtime({ onRefresh: load, pageSize: 10 });
  return { ...state, analytics, loading, load };
}

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
        <MetricCard label="Pending SLA" value={data.leads.filter((lead) => slaState(lead) === "Overdue").length} icon={FileClock} onClick={() => navigate("/admin/sla")} />
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
  return Array.isArray(response?.data?.data) ? response.data.data : Array.isArray(response?.data) ? response.data : [];
}

function generatedDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function generatedTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

const STATUS_FILTERS = [
  { label: "Disbursed", value: LEAD_STATUSES.DISBURSED },
  { label: "Rejected", value: LEAD_STATUSES.REJECTED },
  { label: "Under Bank Process", value: LEAD_STATUSES.UNDER_BANK_PROCESS },
  { label: "Loan Rejected With Reason", value: "REJECTED_REASON" },
  { label: "Pending Documents", value: LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS },
];

function useAdminPanelData(mode, search, leadFilter) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

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
        const status = leadFilter === "REJECTED_REASON" ? LEAD_STATUSES.REJECTED : leadFilter || LEAD_STATUSES.DISBURSED;
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

  useEffect(() => { load(); }, [load]);
  useRoleLeadRealtime({ onRefresh: load, pageSize: 10 });
  return { rows, loading, load };
}

function AdminListPage({ mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") || "");
  const [updatingId, setUpdatingId] = useState("");
  const leadFilter = params.get("status") || LEAD_STATUSES.DISBURSED;
  const pageData = useAdminPanelData(mode, search, leadFilter);
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
        headers: ["Dealership Name", "Brand", "Dealership Location", "Finance Desk Email", "GM/SM Email", "Total Leads", "Approval Date", "Active Status", "Actions"],
        rows: records.map((item) => ({ key: item.id, cells: [display(item.dealershipName), display(item.dealershipBrand), display(item.city), display(item.financeDesk?.officialEmail || item.loginEmail || item.email), display(item.generalManager?.email), display(item.totalLeads || 0), formatDate(item.approvedAt || item.updatedAt), display(item.accountActive === false ? "Disabled" : "Active"), <div key="actions" className="flex flex-wrap gap-2"><button onClick={() => navigate(`/admin/dealerships/${item.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View</button><button disabled={updatingId === item.id} onClick={() => deleteDealership(item)} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50">Delete</button></div>] })),
      };
    }
    if (mode === "approval-dealerships") {
      return {
        title: "Pending Approval Dealerships",
        headers: ["Dealership Name", "Brand", "Location", "Finance Desk Email", "Registration Date", "GSTIN", "Dealer Code", "Status", "Actions"],
        rows: records.map((item) => ({ key: item.id, cells: [display(item.dealershipName), display(item.dealershipBrand), display(item.city), display(item.financeDesk?.officialEmail || item.loginEmail || item.email), formatDate(item.submittedAt || item.createdAt), display(item.dealership?.gstin || item.gstin), display(item.dealership?.authorizedDealerCode || item.authorizedDealerCode), display(item.status), <div key="actions" className="flex flex-wrap gap-2"><button onClick={() => navigate(`/admin/approvals/dealerships/${item.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View</button><button disabled={updatingId === item.id} onClick={() => deleteDealership(item)} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50">Delete</button></div>] })),
      };
    }
    if (mode === "banks") {
      return {
        title: "Approved Banks",
        headers: ["Bank Name", "IFSC Code", "Bank Location", "Manager Name", "Manager Mobile", "Official Email", "Monthly Capacity", "Number Of Executives", "Approval Date", "Status", "Actions"],
        rows: records.map((item) => ({ key: item.id, cells: [display(item.bankName || item.companyName), display(item.ifsc), display(item.bankBranchLocation || item.branchLocation || item.city), display(item.managerName || item.contactPerson), display(item.mobile), display(item.email), display(item.monthlyCapacity), display(item.executiveCount), formatDate(item.approvedAt || item.updatedAt), display(item.accountActive === false ? "Disabled" : item.status), <div key="actions" className="flex flex-wrap gap-2"><button onClick={() => navigate(`/admin/approvals/banks/${item.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View</button><button disabled={updatingId === item.id} onClick={() => deleteBank(item)} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50">Delete</button></div>] })),
      };
    }
    if (mode === "approval-banks") {
      return {
        title: "Pending Approval Banks",
        headers: ["Bank Name", "IFSC Code", "Location", "Manager Name", "Manager Mobile", "Official Email", "Monthly Capacity", "Registration Date", "Status", "Actions"],
        rows: records.map((item) => ({ key: item.id, cells: [display(item.bankName || item.companyName), display(item.ifsc), display(item.bankBranchLocation || item.branchLocation || item.city), display(item.managerName || item.contactPerson), display(item.mobile), display(item.email), display(item.monthlyCapacity), formatDate(item.submittedAt || item.createdAt), display(item.status), <div key="actions" className="flex flex-wrap gap-2"><button onClick={() => navigate(`/admin/approvals/banks/${item.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View</button><button disabled={updatingId === item.id} onClick={() => deleteBank(item)} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50">Delete</button></div>] })),
      };
    }
    if (mode === "status") {
      const rejectedReason = leadFilter === "REJECTED_REASON";
      return {
        title: rejectedReason ? "Loan Rejected With Reason" : "Status",
        headers: rejectedReason ? ["Case ID", "Customer Name", "Customer Mobile", "Customer City", "Preferred Bank", "Required Loan", "Assigned Executive", "Current Status", "Rejection Reason", "Updated By", "Last Updated"] : ["Case ID", "Customer Name", "Customer Mobile", "Customer City", "Preferred Bank", "Required Loan", "Assigned Executive", "Current Status", "Last Updated"],
        rows: records.map((lead) => ({ key: lead.id, cells: rejectedReason ? [caseId(lead), display(lead.fullName || lead.customerName), display(lead.mobile), display(lead.city), display(lead.preferredBank || lead.bankPartner), `Rs. ${money.format(Number(lead.loanAmount || lead.requiredLoanAmount || 0))}`, display(lead.assignedExecutiveName || lead.assignedExecutiveEmail), enterpriseLeadStatus(lead), display(lead.rejectionReason || lead.loanRejectionReason), display(lead.updatedBy || lead.assignedExecutiveEmail), formatDate(lead.updatedAt || lead.statusUpdatedAt || lead.createdAt)] : [caseId(lead), display(lead.fullName || lead.customerName), display(lead.mobile), display(lead.city), display(lead.preferredBank || lead.bankPartner), `Rs. ${money.format(Number(lead.loanAmount || lead.requiredLoanAmount || 0))}`, display(lead.assignedExecutiveName || lead.assignedExecutiveEmail), enterpriseLeadStatus(lead), formatDate(lead.updatedAt || lead.statusUpdatedAt || lead.createdAt)] })),
      };
    }
    return {
      title: "Total Leads",
      headers: ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Preferred Bank", "Car On-Road Price", "Required Loan Amount", "Dealership Name", "Dealer City", "Case Generated Date", "Case Generated Time", "Assigned Bank Name", "Assigned Bank IFSC Code", "Assigned Executive Name", "Assigned Executive Mobile Number", "Current Lead Status", "Last Updated", "Documents"],
      rows: records.map((lead) => ({ key: lead.id, cells: [caseId(lead), display(lead.fullName || lead.customerName), display(lead.mobile), display(lead.city || lead.dealershipCity), display(lead.preferredBank || lead.bankPartner), `Rs. ${money.format(Number(lead.onRoadPrice || lead.carOnRoadPrice || lead.carPrice || 0))}`, `Rs. ${money.format(Number(lead.loanAmount || lead.requiredLoanAmount || 0))}`, assignmentDisplay(lead.dealershipName || lead.dealerName || lead.dealerEmail, "Pending"), display(lead.dealershipCity || lead.city), generatedDate(lead.createdAt), generatedTime(lead.createdAt), assignmentDisplay(lead.assignedBankName || lead.bankPartner || lead.assignedPartnerId), bankIfscDisplay(lead), assignmentDisplay(lead.assignedExecutiveName || lead.assignedExecutiveEmail), assignmentDisplay(lead.assignedExecutiveMobile || lead.executiveMobile), enterpriseLeadStatus(lead), formatDate(lead.updatedAt || lead.statusUpdatedAt || lead.createdAt), <button key="docs" onClick={() => navigate(`/admin/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View Documents</button>] })),
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

function PageTitle({ mode }) {
  const title = {
    dealerships: "Approved Dealerships",
    "approval-dealerships": "Pending Approval Dealerships",
    banks: "Approved Banks",
    "approval-banks": "Pending Approval Banks",
    status: "Status",
    leads: "Total Leads",
  }[mode] || `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
  return <div><p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Super Admin</p><h1 className="mt-1 text-xl font-semibold text-slate-900">{title}</h1></div>;
}

function SystemSettings({ data }) {
  const [settings, setSettings] = useState(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    api.get("/admin/workflow/settings").then((response) => setSettings(response.data || {})).catch(() => setSettings({}));
  }, []);
  const update = async (patch) => {
    const next = { ...(settings || {}), ...patch };
    setSettings(next);
    const response = await api.patch("/admin/workflow/settings", next);
    setMessage(response.data.message || "Settings updated");
  };
  if (!settings) return <DetailPageSkeleton cards={3} />;
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      {message && <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700 lg:col-span-3">{message}</div>}
      <SettingCard title="SLA Timings" text="Configure acceptance and processing timers.">
        <input className="h-9 rounded-md border border-slate-200 px-3 text-sm" type="number" value={settings.slaAcceptMinutes || 60} onChange={(event) => update({ slaAcceptMinutes: Number(event.target.value) })} />
      </SettingCard>
      <SettingCard title="Routing Logic" text="City match, fallback routing, and assignment engine.">
        <button onClick={() => update({ routingEngineEnabled: !settings.routingEngineEnabled })} className="rounded-md bg-[#0d47a1] px-3 py-2 text-sm font-medium text-white">{settings.routingEngineEnabled === false ? "Enable Routing" : "Pause Routing"}</button>
      </SettingCard>
      <SettingCard title="WhatsApp Provider" text="Dry-run mode and notification provider controls.">
        <button onClick={() => update({ whatsappDryRun: !settings.whatsappDryRun })} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">{settings.whatsappDryRun ? "Disable Dry Run" : "Enable Dry Run"}</button>
      </SettingCard>
      <SettingCard title="Supported Cities" text={`${data.onboardingRequests.map((item) => item.city).filter(Boolean).length} dealership city mappings tracked.`} />
      <SettingCard title="Active Banks" text={`${data.bankPartners.length + data.banks.length} bank records available.`} />
      <SettingCard title="Audit Records" text={`${data.auditLogs.length} platform audit records available.`} />
    </section>
  );
}

function SettingCard({ title, text, children }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="text-base font-semibold text-slate-900">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{text}</p>{children && <div className="mt-3">{children}</div>}</div>;
}

export function SuperAdminDashboard({ mode = "dashboard" }) {
  if (mode === "dashboard") return <AdminListPage mode="leads" />;
  return <AdminListPage mode={mode} />;
}

export function SuperAdminLeadDetailPage() {
  const { leadId } = useParams();
  const data = useAdminEcosystem();
  const lead = data.leads.find((item) => item.id === leadId || item.caseId === leadId);
  const documents = useMemo(() => [...(data.documents || []), ...(data.bankDocuments || [])].filter((item) => item.leadId === (lead?.id || leadId)), [data.bankDocuments, data.documents, lead, leadId]);
  if (data.loading) return <DetailPageSkeleton />;
  if (!lead) return <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Lead not found.</section>;
  return (
    <section className="space-y-5">
      <PageTitle mode="lead details" />
      <div className="grid gap-3 md:grid-cols-4">
        {[["Case ID", caseId(lead)], ["Customer", lead.fullName || lead.customerName], ["Dealership", lead.dealershipName || lead.dealerEmail], ["Branch", lead.bankBranchCity || lead.branchCity || lead.city], ["Executive", lead.assignedExecutiveName || lead.assignedExecutiveEmail], ["Loan Amount", `Rs. ${money.format(Number(lead.loanAmount || 0))}`], ["Status", statusLabel(leadStatus(lead))], ["SLA", slaState(lead)]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-1 font-medium text-slate-900">{display(value)}</p></div>)}
      </div>
      <DataTable title="Customer Uploaded Documents" headers={["Document", "Preview", "Uploaded Date/Time", "Download"]} rows={(documents.length ? documents : [
        { id: "aadhaar", type: "Aadhaar" },
        { id: "pan", type: "PAN" },
        { id: "salary-slip", type: "Salary Slip" },
        { id: "itr", type: "ITR" },
        { id: "bank-statement", type: "Bank Statement" },
        { id: "electricity-bill", type: "Electricity Bill" },
        { id: "rent-agreement", type: "Rent Agreement" },
        { id: "form-16", type: "Form 16" },
      ]).map((document) => {
        const url = document.fileUrl || document.url || document.downloadUrl;
        return { key: document.id, cells: [display(document.label || document.type || document.documentType), url ? <a key="preview" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Preview</a> : "Not uploaded", formatDate(document.createdAt || document.uploadedAt), url ? <a key="download" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Download</a> : "-"] };
      })} loading={false} />
      <DataTable title="Audit / SLA History" headers={["Type", "Detail", "Time"]} rows={[...data.slaLogs.filter((item) => item.leadId === lead.id).map((item) => ({ key: `sla-${item.id}`, cells: ["SLA", display(item.status || item.type), formatDate(item.createdAt)] })), ...data.auditLogs.filter((item) => item.leadId === lead.id).map((item) => ({ key: `audit-${item.id}`, cells: ["Audit", display(item.actionType), formatDate(item.createdAt || item.timestamp)] }))]} loading={false} />
    </section>
  );
}

export function SuperAdminDealershipDetailPage() {
  const { id } = useParams();
  const data = useAdminEcosystem();
  const dealer = data.pendingDealershipApprovals.find((item) => item.id === id)
    || data.onboardingRequests.find((item) => item.id === id)
    || data.dealerships.find((item) => item.id === id || item.loginEmail === id);
  if (data.loading) return <DetailPageSkeleton />;
  if (!dealer) return <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Dealership not found.</section>;
  const email = dealer.loginEmail || dealer.id;
  const leads = data.leads.filter((lead) => [lead.dealerEmail, lead.dealershipEmail, lead.createdBy].includes(email));
  return (
    <section className="space-y-5">
      <PageTitle mode="dealership details" />
      <div className="grid gap-3 md:grid-cols-4">
        {[["Dealership", dealer.dealershipName], ["Brand", dealer.dealershipBrand], ["City", dealer.city], ["Finance Desk", dealer.financeDesk?.officialEmail || email], ["Salesperson Count", dealer.salespersonCount || "-"], ["Total Leads", leads.length], ["Approval Ratio", approvalRatio(leads)], ["Status", dealer.status]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-1 font-medium text-slate-900">{display(value)}</p></div>)}
      </div>
      <DataTable title="Dealership Leads" headers={["Customer", "Bank", "Amount", "Status", "Updated"]} rows={leads.slice(0, 10).map((lead) => ({ key: lead.id, cells: [display(lead.fullName || lead.customerName), display(lead.preferredBank || lead.bankPartner), `Rs. ${money.format(Number(lead.loanAmount || 0))}`, <StatusBadge key="status" status={leadStatus(lead)} />, formatDate(lead.updatedAt || lead.createdAt)] }))} loading={false} />
    </section>
  );
}

export function SuperAdminApprovalDetailPage({ type }) {
  const { id } = useParams();
  const data = useAdminEcosystem();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const navigate = useNavigate();
  const item = type === "banks"
    ? data.pendingBankApprovals.find((entry) => entry.id === id)
    : data.pendingDealershipApprovals.find((entry) => entry.id === id);
  const approve = async () => {
    setBusy(true);
    setActionError("");
    try {
      await api.post(`/admin/approvals/${type}/${id}/approve`);
      navigate(type === "banks" ? "/admin/approvals/banks" : "/admin/approvals/dealerships");
    } catch (error) {
      setActionError(error.response?.data?.message || error.message || "Unable to approve application");
    } finally {
      setBusy(false);
    }
  };
  const reject = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    setActionError("");
    try {
      await api.post(`/admin/approvals/${type}/${id}/reject`, { reason });
      navigate(type === "banks" ? "/admin/approvals/banks" : "/admin/approvals/dealerships");
    } catch (error) {
      setActionError(error.response?.data?.message || error.message || "Unable to reject application");
    } finally {
      setBusy(false);
    }
  };
  const suspend = async () => {
    const suspensionReason = reason.trim() || "Suspended by Super Admin";
    setBusy(true);
    setActionError("");
    try {
      await api.post(`/admin/approvals/${type}/${id}/suspend`, { reason: suspensionReason });
      navigate(type === "banks" ? "/admin/approvals/banks" : "/admin/approvals/dealerships");
    } catch (error) {
      setActionError(error.response?.data?.message || error.message || "Unable to suspend application");
    } finally {
      setBusy(false);
    }
  };
  if (data.loading) return <DetailPageSkeleton />;
  if (!item) return <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Application not found.</section>;
  const sections = type === "banks"
    ? [
      ["Bank Details", [["Bank Name", item.bankName || item.companyName], ["Email", item.email], ["Mobile", item.mobile]]],
      ["Branch Details", [["Bank Branch Location", item.bankBranchLocation || item.branchLocation || item.city], ["State", item.state || "Haryana"], ["IFSC", item.ifsc], ["GSTIN", item.gstin]]],
      ["Branch Manager Details", [["Manager", item.managerName || item.contactPerson], ["Email", item.email], ["Mobile", item.mobile], ["Landline", item.landline]]],
      ["Executive List", (item.executives || []).map((exec, index) => [`Executive ${index + 1}`, exec.name || exec.fullName || exec.email])],
      ["SLA Configuration", [["Approval Limit", item.approvalLimit || 100], ["SLA Score", item.slaScore || 100]]],
    ]
    : [
      ["Dealership Information", [["Dealership", item.dealershipName], ["Brand", item.dealershipBrand], ["City", item.city], ["GSTIN", item.dealership?.gstin], ["Address", item.dealership?.address]]],
      ["Owner Details", [["Name", item.owner?.fullName], ["Mobile", item.owner?.mobile], ["Email", item.owner?.email]]],
      ["GM Details", [["Name", item.generalManager?.name], ["Mobile", item.generalManager?.mobile], ["Email", item.generalManager?.email]]],
      ["Finance Desk Details", [["Head", item.financeDesk?.headName], ["Mobile", item.financeDesk?.headMobile], ["Email", item.financeDesk?.officialEmail], ["Team Size", item.financeDesk?.teamSize]]],
      ["Business Capacity", [["Monthly Sales", item.dealership?.monthlyCarSalesCapacity], ["Monthly Loan Apps", item.dealership?.expectedMonthlyLoanApplications]]],
    ];
  return (
    <section className="space-y-5">
      <PageTitle mode={type === "banks" ? "bank approval details" : "dealership approval details"} />
      <div className="grid gap-4 lg:grid-cols-2">
        {sections.map(([title, rows]) => (
          <section key={title} className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            <div className="mt-3 grid gap-2">
              {(rows.length ? rows : [["No records", "-"]]).map(([label, value]) => <div key={label} className="grid grid-cols-[150px_1fr] gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm"><span className="text-slate-500">{label}</span><span className="font-medium text-slate-900">{display(value)}</span></div>)}
            </div>
          </section>
        ))}
      </div>
      <DataTable title="Uploaded Verification Files" headers={["Document", "File", "Status", "Actions"]} rows={((item.documents || []).length ? item.documents : type === "banks" ? [
        { type: "Authorization Letter" },
        { type: "GST Certificate" },
        { type: "Branch Address Proof" },
        { type: "Manager ID" },
      ] : [
        { type: "GST Certificate" },
        { type: "Dealership License" },
        { type: "Office Exterior" },
        { type: "Office Interior" },
      ]).map((doc) => {
        const url = doc.fileUrl || doc.url;
        return { key: doc.fileName || doc.type || doc.documentType, cells: [display(doc.label || doc.type || doc.documentType), display(doc.fileName), display(doc.status || "Submitted"), url ? <a key="download" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Preview / Download</a> : "Stored in application"] };
      })} loading={false} />
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Approval Action</h2>
        {actionError ? <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{actionError}</div> : null}
        <textarea className="mt-3 min-h-24 w-full rounded-md border border-slate-200 p-3 text-sm outline-none focus:border-[#0d47a1]" placeholder="Rejection reason required only when rejecting" value={reason} onChange={(event) => setReason(event.target.value)} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button disabled={busy || !["pending", "submitted"].includes(String(item.status || item.approvalStatus || "pending").toLowerCase())} onClick={approve} className="rounded-md bg-[#0d47a1] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Approve</button>
          <button disabled={busy || !["pending", "submitted"].includes(String(item.status || item.approvalStatus || "pending").toLowerCase()) || !reason.trim()} onClick={reject} className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50">Reject</button>
          <button disabled={busy || item.status === "suspended"} onClick={suspend} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 disabled:opacity-50">Suspend</button>
        </div>
      </section>
    </section>
  );
}
