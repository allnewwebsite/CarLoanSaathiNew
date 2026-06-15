import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Building2, ClipboardCheck, CreditCard, Download, Landmark, Loader2, Search, Shield, Users } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { PendingDocumentsPanel } from "../../components/PendingDocumentsPanel.jsx";
import { DetailPageSkeleton } from "../../components/ui/Loading.jsx";
import { StatusBadge } from "../../components/StatusBadge.jsx";
import { LEAD_TABLE_LABELS } from "../../constants/leadTableLabels.js";
import { ADMIN_STATUS_OPTIONS, BANK_STATUS_OPTIONS, LEAD_STATUSES, normalizeStatus, statusLabel } from "../../constants/status.js";
import { useDebouncedValue } from "../../hooks/useDebouncedValue.js";
import { mutationUrlMatches, useRoleLeadRealtime } from "../../hooks/useRealtimeRefresh.js";
import { useRealtimeLeadDetailPatch, useRealtimeLeadPatch } from "../../hooks/useRealtimeEntityPatch.js";
import { api, getCachedGetData, invalidateGetCache } from "../../services/api.js";
import { usePageLatency } from "../../services/frontendLatency.js";
import { bankDocumentRows, formatPortalDate, formatPortalDateTime, formatPortalTime, loanExecutiveRemark, portalLeadStatusLabel } from "../../utils/portalDisplay.js";

const pageSize = 10;
const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const adminLeadMutationFilter = (detail) => mutationUrlMatches(detail, ["/admin/leads", "/bank/leads", "/dealer/leads", "/documents"]);
const customerDocumentTypes = [
  "Aadhaar",
  "PAN",
  "Salary Slip",
  "ITR",
  "Bank Statement",
  "Electricity Bill",
  "Rent Agreement",
  "Form 16",
];

function display(value) {
  return value || "-";
}

function bankCapacityDisplay(item) {
  return display(item?.monthlyLoanCapacity || item?.monthlyCapacity || item?.approvalLimit);
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
  return formatPortalDateTime(value);
}

function billingDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function AdminSubscriptionPanel({ dealershipId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [days, setDays] = useState("30");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!dealershipId) return;
    setLoading(true);
    try {
      const endpoint = `/admin/subscriptions/${encodeURIComponent(dealershipId)}`;
      invalidateGetCache({ prefix: endpoint, purge: true });
      const response = await api.get(endpoint);
      setData(response.data || null);
      setError("");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to load subscription.");
    } finally {
      setLoading(false);
    }
  }, [dealershipId]);

  useEffect(() => {
    load();
    const onMutation = (event) => {
      if (event.detail?.kind === "subscription") load();
    };
    window.addEventListener("cls:data-mutated", onMutation);
    return () => window.removeEventListener("cls:data-mutated", onMutation);
  }, [load]);

  const act = async (action) => {
    if (!reason.trim()) {
      setError("Reason is required for subscription overrides.");
      return;
    }
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const body = action === "suspend" ? { reason } : { reason, days: Number(days) };
      const response = await api.post(`/admin/subscriptions/${encodeURIComponent(dealershipId)}/${action}`, body);
      setMessage(response.data?.message || "Subscription updated.");
      setReason("");
      await load();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to update subscription.");
    } finally {
      setBusy("");
    }
  };

  if (loading && !data) return <section className="rounded-lg border border-slate-200 bg-white p-5"><Loader2 className="h-5 w-5 animate-spin text-[#0d47a1]" /></section>;
  const subscription = data?.subscription || {};
  const payments = data?.history?.payments || [];
  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-3"><CreditCard className="h-5 w-5 text-[#0d47a1]" /><div><h2 className="text-base font-semibold text-slate-900">Subscription Administration</h2><p className="text-sm text-slate-500">Manual controls and payment history</p></div></div>
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
      {message ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{message}</p> : null}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Plan", subscription.planName],
          ["Status", subscription.subscriptionStatus],
          ["Trial End", billingDate(subscription.trialEndDate)],
          ["Subscription End", billingDate(subscription.subscriptionEndDate)],
          ["Days Remaining", subscription.daysRemaining],
          ["Payment Status", subscription.paymentStatus],
          ["Last Invoice", subscription.invoiceNumber],
          ["Lead Creation", subscription.leadCreationAllowed ? "Allowed" : "Blocked"],
        ].map(([label, value]) => <div key={label} className="rounded-md bg-slate-50 px-3 py-2"><dt className="text-xs uppercase text-slate-500">{label}</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{display(value)}</dd></div>)}
      </dl>
      <div className="grid gap-3 lg:grid-cols-[140px_1fr_auto_auto_auto]">
        <input type="number" min="1" max="3650" className="field h-10" value={days} onChange={(event) => setDays(event.target.value)} aria-label="Number of days" />
        <input className="field h-10" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Required reason for admin override" />
        <button disabled={Boolean(busy)} onClick={() => act("extend")} className="h-10 rounded-md bg-[#0d47a1] px-4 text-sm font-semibold text-white disabled:opacity-50">{busy === "extend" ? "Extending..." : "Extend"}</button>
        <button disabled={Boolean(busy)} onClick={() => act("trial")} className="h-10 rounded-md border border-slate-300 px-4 text-sm font-semibold text-slate-700 disabled:opacity-50">{busy === "trial" ? "Activating..." : "Activate Trial"}</button>
        <button disabled={Boolean(busy)} onClick={() => act("suspend")} className="h-10 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-700 disabled:opacity-50">{busy === "suspend" ? "Suspending..." : "Suspend"}</button>
      </div>
      <DataTable title="Subscription Payments" headers={["Invoice", "Date", "Amount", "GST", "Status", "Payment ID"]} rows={payments.map((payment) => ({ key: payment.id, cells: [display(payment.invoiceNumber), billingDate(payment.paidAt), `Rs. ${money.format(Number(payment.finalAmount || 0))}`, `Rs. ${money.format(Number(payment.gstAmount || 0))}`, display(payment.paymentStatus || payment.status), display(payment.razorpayPaymentId)] }))} loading={false} />
    </section>
  );
}

function leadStatus(lead) {
  return normalizeStatus(lead.status || LEAD_STATUSES.NEW);
}

function approvalStatusOf(item) {
  return String(item?.status || item?.approvalStatus || "pending").trim().toLowerCase();
}

function finalApprovalStatus(item) {
  return ["approved", "rejected", "suspended", "deleted", "disabled", "inactive"].includes(approvalStatusOf(item));
}

function canActOnApproval(item) {
  if (!item) return false;
  if (item.accountApproved === true || item.approved === true) return false;
  return !finalApprovalStatus(item);
}

function workflowStatus(value) {
  const normalized = normalizeStatus(value);
  if (normalized === LEAD_STATUSES.ASSIGNED) return LEAD_STATUSES.NEW;
  if ([LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW, LEAD_STATUSES.APPROVED].includes(normalized)) return LEAD_STATUSES.UNDER_BANK_PROCESS;
  if (normalized === LEAD_STATUSES.DOCS_PENDING) return LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS;
  return normalized;
}

function approvalRatio(leads) {
  if (!leads.length) return "0%";
  const approved = leads.filter((lead) => [LEAD_STATUSES.APPROVED, LEAD_STATUSES.DISBURSED].includes(leadStatus(lead))).length;
  return `${Math.round((approved / leads.length) * 100)}%`;
}

function enterpriseLeadStatus(lead) {
  return portalLeadStatusLabel(lead);
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
  const cachedEcosystem = getCachedGetData("/admin/ecosystem") || {};
  const cachedAnalytics = getCachedGetData("/admin/analytics") || {};
  const cachedAuditLogs = getCachedGetData("/admin/audit-logs") || [];
  const cachedAdminState = {
    ...cachedEcosystem,
    auditLogs: cachedAuditLogs.length ? cachedAuditLogs : cachedEcosystem.auditLogs || [],
  };
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
    ...cachedAdminState,
  });
  const [analytics, setAnalytics] = useState(cachedAnalytics);
  const [loading, setLoading] = useState(() => !cachedEcosystem || !Object.keys(cachedEcosystem).length);

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

  useEffect(() => { load({ silent: Boolean(cachedEcosystem && Object.keys(cachedEcosystem).length) }); }, [load]);
  useRoleLeadRealtime({ onRefresh: load, pageSize: 10, mutationFilter: adminLeadMutationFilter });
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
  return formatPortalDate(value);
}

function generatedTime(value) {
  return formatPortalTime(value);
}

function generatedAt(value) {
  return formatPortalDateTime(value);
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
  const [rows, setRows] = useState(() => responseRows({ data: cached }));
  const [loading, setLoading] = useState(() => !cached);

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

  useEffect(() => { load({ silent: Boolean(cached) }); }, [load]);
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
  const cachedSettings = getCachedGetData("/admin/workflow/settings");
  const [settings, setSettings] = useState(() => cachedSettings || null);
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
  usePageLatency("SuperAdmin", { mode });
  if (mode === "dashboard") return <AdminListPage mode="leads" />;
  return <AdminListPage mode={mode} />;
}

export function SuperAdminLeadDetailPage() {
  const { leadId } = useParams();
  const data = useAdminEcosystem();
  const cachedLead = getCachedGetData(`/admin/leads/${leadId}`)
    || data.leads.find((item) => item.id === leadId || item.caseId === leadId);
  const [detailLead, setDetailLead] = useState(() => cachedLead || null);
  const lead = detailLead || cachedLead;
  const loadLead = useCallback(async ({ silent = false } = {}) => {
    try {
      const response = await api.get(`/admin/leads/${leadId}`);
      setDetailLead(response.data);
    } catch {
      if (!silent) setDetailLead((current) => current || null);
    }
  }, [leadId]);
  useEffect(() => {
    loadLead();
  }, [loadLead]);
  useRealtimeLeadDetailPatch({ leadId, setLead: setDetailLead });
  const customerDocuments = useMemo(() => (Array.isArray(lead?.documents) ? lead.documents : []), [lead]);
  const bankDocuments = useMemo(() => bankDocumentRows(lead), [lead]);
  if (data.loading && !lead) return <DetailPageSkeleton />;
  if (!lead) return <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Lead not found.</section>;
  return (
    <section className="space-y-5">
      <PageTitle mode="lead details" />
      <div className="grid gap-3 md:grid-cols-4">
        {[["Case ID", caseId(lead)], ["Customer", lead.fullName || lead.customerName], ["Dealership", lead.dealershipName || lead.dealerEmail], ["Branch", lead.bankBranchCity || lead.branchCity || lead.city], [LEAD_TABLE_LABELS.assignedExecutive, lead.assignedExecutiveName || lead.assignedExecutiveEmail], [LEAD_TABLE_LABELS.executiveMobile, lead.assignedExecutiveMobile || lead.executiveMobile], ["Loan Amount", `Rs. ${money.format(Number(lead.loanAmount || 0))}`], [LEAD_TABLE_LABELS.currentStatus, statusLabel(leadStatus(lead))]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-1 font-medium text-slate-900">{display(value)}</p></div>)}
      </div>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">Loan Executive Remark</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{loanExecutiveRemark(lead)}</p>
      </section>
      <PendingDocumentsPanel lead={lead} />
      <DataTable title="Customer Uploaded Documents" headers={["Document", "Preview", "Uploaded Date/Time", "Download"]} rows={(customerDocuments.length ? customerDocuments : customerDocumentTypes.map((type) => ({ id: type.toLowerCase().replace(/\s+/g, "-"), type }))).map((document) => {
        const url = document.fileUrl || document.url || document.downloadUrl;
        return { key: document.id, cells: [display(document.label || document.type || document.documentType), url ? <a key="preview" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Preview</a> : "Not uploaded", formatDate(document.createdAt || document.uploadedAt), url ? <a key="download" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Download</a> : "-"] };
      })} loading={false} />
      <DataTable title="Bank Uploaded Documents" headers={["Document", "Preview", "Uploaded Date/Time", "Download"]} rows={bankDocuments.map((document) => {
        const url = document.fileUrl || document.url || document.downloadUrl;
        return { key: document.id || document.documentType || document.type, cells: [display(document.label || document.documentType || document.type || "Bank Document"), url ? <a key="preview" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Preview</a> : "Stored in application", formatDate(document.createdAt || document.uploadedAt), url ? <a key="download" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Download</a> : "-"] };
      })} loading={false} />
      <DataTable title="Audit History" headers={["Type", "Detail", "Time"]} rows={data.auditLogs.filter((item) => item.leadId === lead.id).map((item) => ({ key: `audit-${item.id}`, cells: ["Audit", display(item.actionType), formatDate(item.createdAt || item.timestamp)] }))} loading={false} />
    </section>
  );
}

export function SuperAdminDealershipDetailPage() {
  const { id } = useParams();
  const data = useAdminEcosystem();
  const dealer = data.pendingDealershipApprovals.find((item) => item.id === id)
    || data.onboardingRequests.find((item) => item.id === id)
    || data.dealerships.find((item) => item.id === id || item.loginEmail === id);
  if (data.loading && !dealer) return <DetailPageSkeleton />;
  if (!dealer) return <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Dealership not found.</section>;
  const email = dealer.loginEmail || dealer.id;
  const leads = data.leads.filter((lead) => [lead.dealerEmail, lead.dealershipEmail, lead.createdBy].includes(email));
  return (
    <section className="space-y-5">
      <PageTitle mode="dealership details" />
      <div className="grid gap-3 md:grid-cols-4">
        {[["Dealership", dealer.dealershipName], ["Brand", dealer.dealershipBrand], ["City", dealer.city], ["Login Email", dealer.loginEmail || dealer.email || email], ["Salesperson Count", dealer.salespersonCount || "-"], ["Total Leads", leads.length], ["Approval Ratio", approvalRatio(leads)], ["Status", dealer.status]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-1 font-medium text-slate-900">{display(value)}</p></div>)}
      </div>
      <AdminSubscriptionPanel dealershipId={dealer.loginEmail || dealer.email || email} />
      <DataTable title="Dealership Leads" headers={["Customer", "Bank", "Amount", LEAD_TABLE_LABELS.currentStatus, "Updated"]} rows={leads.slice(0, 10).map((lead) => ({ key: lead.id, cells: [display(lead.fullName || lead.customerName), display(lead.assignedBankName || lead.bankPartner || lead.assignedPartnerId), `Rs. ${money.format(Number(lead.loanAmount || 0))}`, <StatusBadge key="status" lead={lead} />, formatDate(lead.updatedAt || lead.createdAt)] }))} loading={false} />
    </section>
  );
}

export function SuperAdminApprovalDetailPage({ type }) {
  const { id } = useParams();
  const data = useAdminEcosystem();
  const [directItem, setDirectItem] = useState(null);
  const [directLoading, setDirectLoading] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const navigate = useNavigate();
  const item = type === "banks"
    ? directItem || data.pendingBankApprovals.find((entry) => entry.id === id)
    : directItem || data.pendingDealershipApprovals.find((entry) => entry.id === id);
  useEffect(() => {
    let active = true;
    const loadDirectItem = async () => {
      setDirectLoading(true);
      try {
        const endpoint = type === "banks" ? "/admin/approvals/banks" : "/admin/approvals/dealerships";
        const [pendingResponse, approvedResponse] = await Promise.all([
          api.get(endpoint, { params: { status: "pending", search: id, limit: 25 } }),
          api.get(endpoint, { params: { status: "approved", search: id, limit: 25 } }),
        ]);
        const rows = [...responseRows(pendingResponse), ...responseRows(approvedResponse)];
        const match = rows.find((entry) => entry.id === id || entry.ifsc === id || entry.ifscCode === id || entry.loginEmail === id);
        if (active) setDirectItem(match || null);
      } catch {
        if (active) setDirectItem(null);
      } finally {
        if (active) setDirectLoading(false);
      }
    };
    if (!item) loadDirectItem();
    else setDirectLoading(false);
    return () => { active = false; };
  }, [id, item, type]);
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
  if ((data.loading || directLoading) && !item) return <DetailPageSkeleton />;
  if (!item) return <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Application not found.</section>;
  const canAct = canActOnApproval(item);
  const sections = type === "banks"
    ? [
      ["Bank Details", [["Bank Name", item.bankName || item.companyName], ["Email", item.email], ["Mobile", item.mobile]]],
      ["Branch Details", [["Bank Branch Location", item.bankBranchLocation || item.branchLocation || item.city], ["State", item.state || "Haryana"], ["IFSC", item.ifsc], ["GSTIN", item.gstin]]],
      ["Branch Manager Details", [["Manager", item.managerName || item.contactPerson], ["Email", item.officialEmail || item.email], ["Mobile", item.mobile]]],
      ["Executive List", (item.executives || []).map((exec, index) => [`Executive ${index + 1}`, exec.name || exec.fullName || exec.email])],
      ["Branch Capacity", [["Monthly Loan Capacity", bankCapacityDisplay(item)], ["Number Of Executives", item.executiveCount]]],
    ]
    : [
      ["Dealership Information", [["Dealership", item.dealershipName], ["Brand", item.dealershipBrand], ["City", item.city], ["Selected Plan", item.selectedPlan || item.dealership?.selectedPlan || "TRIAL"], ["Address", item.dealership?.address]]],
      ["Business Capacity", [["Monthly Sales", item.dealership?.monthlyCarSalesCapacity]]],
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
          <button disabled={busy || !canAct} onClick={approve} className="rounded-md bg-[#0d47a1] px-3 py-2 text-sm font-medium text-white disabled:opacity-50">Approve</button>
          <button disabled={busy || !canAct || !reason.trim()} onClick={reject} className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50">Reject</button>
          <button disabled={busy || finalApprovalStatus(item)} onClick={suspend} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 disabled:opacity-50">Suspend</button>
        </div>
      </section>
    </section>
  );
}
