import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Search, UploadCloud, X } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { PendingDocumentsPanel } from "../../components/PendingDocumentsPanel.jsx";
import { ButtonSpinner, DetailPageSkeleton } from "../../components/ui/Loading.jsx";
import { BANK_STATUS_OPTIONS, LEAD_STATUSES, normalizeStatus, statusLabel as standardStatusLabel } from "../../constants/status.js";
import { mutationUrlMatches, useBackgroundRefresh, useLeadDetailRealtime, useRoleLeadRealtime } from "../../hooks/useRealtimeRefresh.js";
import { useRealtimeLeadDetailPatch, useRealtimeLeadPatch } from "../../hooks/useRealtimeEntityPatch.js";
import { useCursorPager } from "../../hooks/useCursorPager.js";
import { api, findCachedGetItem, getCachedGetData } from "../../services/api.js";
import { usePageLatency } from "../../services/frontendLatency.js";
import { bankDocumentRows, formatPortalDate, formatPortalDateTime, loanExecutiveRemark, portalLeadStatusLabel } from "../../utils/portalDisplay.js";

const pageSize = 10;
const leadMutationFilter = (detail) => mutationUrlMatches(detail, ["/dealer/leads", "/bank/leads", "/gm/leads", "/documents"]);
const salespersonMutationFilter = (detail) => mutationUrlMatches(detail, ["/dealer/salespersons"]);
const financeManagerMutationFilter = (detail) => mutationUrlMatches(detail, ["/dealer/finance-managers"]);
const staffMutationFilter = (detail) => mutationUrlMatches(detail, ["/dealer/staff"]);
const tieUpMutationFilter = (detail) => mutationUrlMatches(detail, ["/dealer/bank-tieups"]);
const documentTypes = ["Aadhaar", "PAN", "Salary Slip", "ITR", "Bank Statement", "Electricity Bill", "Rent Agreement", "Form 16"];
const statusTabs = BANK_STATUS_OPTIONS.map((value) => ({ label: standardStatusLabel(value), value }));

const emptyLead = {
  fullName: "",
  mobile: "",
  city: "",
  carPrice: "",
  loanAmount: "",
  salespersonId: "",
  financeManagerId: "",
  branchId: "",
};

const emptySalesperson = { name: "", mobile: "", jobId: "", email: "" };
const emptyFinanceManager = { name: "", mobile: "", employeeId: "", email: "" };
const emptyStaff = { fullName: "", email: "", mobile: "", employeeId: "", role: "finance-head", branch: "", city: "" };
const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

function display(value) {
  return value || "-";
}

function mergeBranchesByKey(...groups) {
  const merged = new Map();
  groups.flat().filter(Boolean).forEach((branch) => {
    const key = bankKey(branch);
    if (!key) return;
    const existing = merged.get(key);
    merged.set(key, { ...branch, ...existing });
  });
  return [...merged.values()];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanEmail(value) {
  return cleanText(value).toLowerCase();
}

function digits10(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 10);
}

function numericAmount(value) {
  const clean = String(value || "").replace(/[^\d]/g, "");
  return clean ? String(Number(clean)) : "";
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(value));
}

function moneyValue(value) {
  return `Rs. ${money.format(Number(value || 0))}`;
}

function dateValue(value) {
  return formatPortalDate(value);
}

function dateTime(value) {
  return formatPortalDateTime(value);
}

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

function Table({ headers, rows, loading, page, total, hasMore, onPage }) {
  return <OperationalTable headers={headers} rows={rows} loading={loading} page={page} total={total} hasMore={hasMore} onPage={onPage} pageSize={pageSize} />;
}

function useSalespersons({ includeInactive = false } = {}) {
  const cachedSalespersons = getCachedGetData("/dealer/salespersons", { includeInactive }) || getCachedGetData("/dealer/salespersons");
  const [salespersons, setSalespersons] = useState(() => cachedSalespersons || []);
  const [loading, setLoading] = useState(() => !cachedSalespersons);
  const loadSalespersons = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get("/dealer/salespersons", { params: { includeInactive } });
      setSalespersons(response.data || []);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [includeInactive]);
  useEffect(() => { loadSalespersons({ silent: Boolean(cachedSalespersons) }); }, [loadSalespersons]);
  useBackgroundRefresh({ onRefresh: loadSalespersons, refreshKey: "finance-salespersons", mutationFilter: salespersonMutationFilter });
  return { salespersons, loading, loadSalespersons };
}

function useFinanceManagers({ includeInactive = false } = {}) {
  const cachedManagers = getCachedGetData("/dealer/finance-managers", { includeInactive }) || getCachedGetData("/dealer/finance-managers");
  const [financeManagers, setFinanceManagers] = useState(() => cachedManagers || []);
  const [loading, setLoading] = useState(() => !cachedManagers);
  const loadFinanceManagers = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get("/dealer/finance-managers", { params: { includeInactive } });
      setFinanceManagers(response.data || []);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [includeInactive]);
  useEffect(() => { loadFinanceManagers({ silent: Boolean(cachedManagers) }); }, [loadFinanceManagers]);
  useBackgroundRefresh({ onRefresh: loadFinanceManagers, refreshKey: "finance-managers", mutationFilter: financeManagerMutationFilter });
  return { financeManagers, loading, loadFinanceManagers };
}

function useDealerLeads(filters = {}) {
  const initialParams = { page: 1, limit: pageSize, ...filters };
  const cached = getCachedGetData("/dealer/leads", initialParams);
  const cachedPayload = Array.isArray(cached) ? { data: cached, total: cached.length } : cached;
  const [leads, setLeads] = useState(() => cachedPayload?.data || []);
  const [total, setTotal] = useState(() => cachedPayload?.total || 0);
  const [hasMore, setHasMore] = useState(() => Boolean(cachedPayload?.hasMore || cachedPayload?.nextCursor));
  const [loading, setLoading] = useState(() => !cachedPayload);
  const { cursorParamsForPage, rememberNextCursor } = useCursorPager([filters.status || "", filters.salespersonId || "", filters.financeManagerId || "", filters.search || ""]);
  const loadLeads = useCallback(async (next = {}) => {
    const silent = next.silent === true;
    if (!silent) setLoading(true);
    try {
      const { silent: _silent, ...params } = next;
      const targetPage = Math.max(Number(params.page || 1), 1);
      const response = await api.get("/dealer/leads", { params: { page: targetPage, limit: pageSize, ...filters, ...params, ...cursorParamsForPage(targetPage) } });
      const payload = Array.isArray(response.data) ? { data: response.data, total: response.data.length } : response.data;
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
    loadLeads({ silent: Boolean(cachedPayload) });
  }, [loadLeads]);
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
        display(bankDisplay(lead)),
        moneyValue(lead.loanAmount || lead.requiredLoanAmount),
        <StatusBadge key="status" lead={lead} />,
      ];
      if (normalizeStatus(lead.status) === LEAD_STATUSES.REJECTED) {
        cells.splice(6, 0, display(lead.rejectionReason));
      }
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
          display(bankDisplay(lead)),
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

function StaffManagementScreen() {
  const navigate = useNavigate();
  const cachedStaff = getCachedGetData("/dealer/staff");
  const [rows, setRows] = useState(() => cachedStaff || []);
  const [loading, setLoading] = useState(() => !cachedStaff);
  const [form, setForm] = useState(emptyStaff);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState(null);

  const loadStaff = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get("/dealer/staff");
      setRows(response.data || []);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { loadStaff({ silent: Boolean(cachedStaff) }); }, [loadStaff]);
  useBackgroundRefresh({ onRefresh: loadStaff, refreshKey: "finance-staff", mutationFilter: staffMutationFilter });

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };

  const validate = (nextForm = form) => {
    const nextErrors = {};
    if (!cleanText(nextForm.fullName)) nextErrors.fullName = "Field required";
    if (!validEmail(nextForm.email)) nextErrors.email = "Enter valid email address";
    if (!/^\d{10}$/.test(nextForm.mobile)) nextErrors.mobile = "Enter valid 10-digit mobile number";
    if (!cleanText(nextForm.employeeId)) nextErrors.employeeId = "Field required";
    if (!nextForm.role) nextErrors.role = "Field required";
    return nextErrors;
  };

  const submit = async (event) => {
    event.preventDefault();
    setMessage("");
    setError("");
    const nextForm = {
      fullName: cleanText(form.fullName),
      email: cleanEmail(form.email),
      mobile: digits10(form.mobile),
      employeeId: cleanText(form.employeeId),
      role: form.role,
      branch: cleanText(form.branch),
      city: cleanText(form.city),
    };
    const nextErrors = validate(nextForm);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setBusy(true);
    try {
      const response = await api.post("/dealer/staff", nextForm);
      setForm(emptyStaff);
      setMessage("Employee created successfully.");
      setCredentials({
        name: response.data?.fullName || nextForm.fullName,
        role: response.data?.roleLabel || (nextForm.role === "finance-head" ? "Finance Head" : "GM / SM"),
        email: response.data?.email || nextForm.email,
        temporaryPassword: response.data?.temporaryPassword || "",
        portalLogin: response.data?.portalLogin || `${window.location.origin}/dealer/login`,
      });
      await loadStaff();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Unable to create employee");
    } finally {
      setBusy(false);
    }
  };

  const removeStaff = async (staff) => {
    const confirmed = window.confirm("Are you sure you want to permanently remove this employee?");
    if (!confirmed) return;
    setMessage("");
    setError("");
    try {
      await api.delete(`/dealer/staff/${encodeURIComponent(staff.id || staff.email)}`);
      setMessage("Employee permanently removed.");
      await loadStaff();
    } catch (err) {
      setError(err.response?.data?.message || "Unable to remove employee");
    }
  };

  const tableRows = rows.map((staff) => ({
    key: staff.id,
    cells: [
      display(staff.fullName),
      display(staff.roleLabel),
      display(staff.email),
      display(staff.mobile),
      display(staff.employeeId),
      display(staff.branch || staff.city),
      display(staff.status),
      dateValue(staff.createdAt),
      <div key="actions" className="flex flex-wrap gap-2">
        <button type="button" onClick={() => navigate(`/finance/staff/${encodeURIComponent(staff.id || staff.email)}`)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700">View</button>
        {staff.protected ? null : <button type="button" onClick={() => removeStaff(staff)} className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">Remove</button>}
      </div>,
    ],
  }));

  return (
    <section className="space-y-4">
      <SectionTitle title="Add GM or SM" subtitle="Create dealership GM and SM accounts with temporary password security." />
      {credentials ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Employee Created Successfully</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">{credentials.name}</h2>
              <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                <p><span className="font-semibold">Role:</span> {credentials.role}</p>
                <p><span className="font-semibold">Portal Login:</span> {credentials.portalLogin}</p>
                <p><span className="font-semibold">Official Email:</span> {credentials.email}</p>
                <p><span className="font-semibold">Temporary Password:</span> {credentials.temporaryPassword}</p>
              </div>
              <p className="mt-3 text-sm font-medium text-emerald-800">Please ask employee to change password after first login.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => navigator.clipboard?.writeText(`Portal Login: ${credentials.portalLogin}\nRole: ${credentials.role}\nEmail: ${credentials.email}\nTemporary Password: ${credentials.temporaryPassword}`)} className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700">Copy Credentials</button>
              <button type="button" onClick={() => navigator.clipboard?.writeText(credentials.portalLogin)} className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700">Copy Portal URL</button>
              <button type="button" onClick={() => setCredentials(null)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">Close</button>
            </div>
          </div>
        </div>
      ) : null}
      <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Full Name" error={errors.fullName}><input aria-invalid={Boolean(errors.fullName)} className="field mt-1.5 h-10 rounded-md" value={form.fullName} onBlur={() => setErrors(validate(form))} onChange={(event) => update("fullName", event.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Official Email" error={errors.email}><input aria-invalid={Boolean(errors.email)} type="email" className="field mt-1.5 h-10 rounded-md" value={form.email} onBlur={() => setErrors(validate(form))} onChange={(event) => update("email", cleanEmail(event.target.value))} /></Field>
          <Field label="Mobile Number" error={errors.mobile}><input aria-invalid={Boolean(errors.mobile)} className="field mt-1.5 h-10 rounded-md" value={form.mobile} maxLength={10} inputMode="numeric" onBlur={() => setErrors(validate(form))} onChange={(event) => update("mobile", digits10(event.target.value))} /></Field>
          <Field label="Employee ID" error={errors.employeeId}><input aria-invalid={Boolean(errors.employeeId)} className="field mt-1.5 h-10 rounded-md" value={form.employeeId} onBlur={() => setErrors(validate(form))} onChange={(event) => update("employeeId", event.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Role" error={errors.role}><select aria-invalid={Boolean(errors.role)} className="field mt-1.5 h-10 rounded-md" value={form.role} onBlur={() => setErrors(validate(form))} onChange={(event) => update("role", event.target.value)}><option value="finance-head">Finance Head</option><option value="gm">GM</option><option value="sm">SM</option></select></Field>
          <Field label="Branch / Location"><input className="field mt-1.5 h-10 rounded-md" value={form.branch} onChange={(event) => update("branch", event.target.value.replace(/[<>]/g, ""))} /></Field>
        </div>
        {message ? <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
        <button disabled={busy} className="mt-4 inline-flex min-w-36 items-center justify-center rounded-md bg-[#0d47a1] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? <ButtonSpinner /> : "Create Employee"}</button>
      </form>
      <Table headers={["Employee Name", "Role", "Official Email", "Mobile Number", "Employee ID", "Branch", "Status", "Created Date", "Actions"]} rows={tableRows} loading={loading} />
    </section>
  );
}

export function FinanceStaffDetailPage() {
  const { employeeId } = useParams();
  const navigate = useNavigate();
  const cachedEmployee = getCachedGetData(`/dealer/staff/${encodeURIComponent(employeeId)}`)
    || findCachedGetItem("/dealer/staff", (item) => item.id === employeeId || item.email === employeeId || item.employeeId === employeeId);
  const [employee, setEmployee] = useState(() => cachedEmployee);
  const [loading, setLoading] = useState(() => !cachedEmployee);
  const [error, setError] = useState("");

  const loadEmployee = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get(`/dealer/staff/${encodeURIComponent(employeeId)}`);
      setEmployee(response.data || null);
    } catch (err) {
      setEmployee((current) => current || null);
      setError(err.response?.data?.message || "Unable to load employee profile");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { loadEmployee(); }, [loadEmployee]);

  const removeEmployee = async () => {
    if (!employee) return;
    const confirmed = window.confirm("Are you sure you want to permanently remove this employee?");
    if (!confirmed) return;
    try {
      await api.delete(`/dealer/staff/${encodeURIComponent(employee.id || employee.email)}`);
      navigate("/finance/manage-staff");
    } catch (err) {
      setError(err.response?.data?.message || "Unable to remove employee");
    }
  };

  if (loading && !employee) return <DetailPageSkeleton />;
  if (!employee) return <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">{error || "Employee not found."}</section>;

  const profile = [
    ["Employee Full Name", employee.fullName],
    ["Role", employee.roleLabel],
    ["Official Email", employee.email],
    ["Mobile Number", employee.mobile],
    ["Employee ID", employee.employeeId],
    ["Branch / Location", employee.branch || employee.city],
    ["Status", employee.status],
    ["Created Date", dateTime(employee.createdAt)],
    ["Created By", employee.createdBy],
    ["Last Login Date", dateTime(employee.lastLoginAt)],
    ["Assigned Dealership", employee.assignedDealership],
    ["Unique Employee ID", employee.uniqueEmployeeId],
    ["Authentication Account ID", employee.authAccountId],
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionTitle title="Employee Details" subtitle="Verified staff profile and authentication mapping." />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => navigate("/finance/manage-staff")} className="h-9 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700">Back</button>
          {employee.protected ? null : <button type="button" onClick={removeEmployee} className="h-9 rounded-md border border-red-200 bg-red-50 px-3 text-xs font-medium text-red-700">Remove</button>}
        </div>
      </div>
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-2 border-b border-slate-100 pb-4">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{display(employee.roleLabel)}</p>
          <h1 className="text-2xl font-semibold text-slate-950">{display(employee.fullName)}</h1>
          <p className="text-sm text-slate-500">{display(employee.email)}</p>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {profile.map(([label, value]) => (
            <div key={label} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-3">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-slate-500">{label}</p>
              <p className="mt-1 break-words text-sm font-medium text-slate-900">{display(value)}</p>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
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
      <Table headers={["Case ID", "Customer Name", "Mobile Number", "Customer City", "Selected Bank", "Loan Amount", "Generated Date", "Finance Manager", "Current Status", "Assigned Executive", "Executive Mobile", "Documents"]} rows={leadRows(leads)} loading={loading} page={page} total={total} hasMore={hasMore} onPage={pageTo} />
    </div>
  );
}

function bankKey(branch) {
  return branch.ifscCode || branch.id || "";
}

function branchLabel(branch) {
  return `${branch.bankName || "Bank"} - ${branch.branchName || "Branch"}${branch.ifscCode ? ` (${branch.ifscCode})` : ""}`;
}

function BranchListSkeleton({ rows = 6 }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="grid min-w-[900px] grid-cols-[44px_1.3fr_1fr_1fr_1fr_1fr_130px] gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0">
          <span className="h-4 w-4 animate-pulse rounded bg-slate-200" />
          <span className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
          <span className="h-4 w-3/4 animate-pulse rounded bg-slate-200/85" />
          <span className="h-4 w-2/3 animate-pulse rounded bg-slate-200/85" />
          <span className="h-4 w-1/2 animate-pulse rounded bg-slate-200/75" />
          <span className="h-4 w-1/2 animate-pulse rounded bg-slate-200/75" />
          <span className="h-4 w-20 animate-pulse rounded bg-slate-200/75" />
        </div>
      ))}
    </div>
  );
}

function AddLeadOnlyScreen() {
  const navigate = useNavigate();
  const { salespersons } = useSalespersons();
  const { financeManagers } = useFinanceManagers();
  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [branchesError, setBranchesError] = useState("");
  const [form, setForm] = useState(emptyLead);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const loadTieUps = async () => {
      setBranchesLoading(true);
      setBranchesError("");
      try {
        const response = await api.get("/dealer/bank-tieups");
        const currentTieUps = Array.isArray(response.data?.branchTieUps)
          ? response.data.branchTieUps
          : Array.isArray(response.data?.currentTieUps)
            ? response.data.currentTieUps
            : [];
        setBranches(currentTieUps);
      } catch (error) {
        setBranches([]);
        setBranchesError("Unable to load tied-up banks. Please try again.");
      } finally {
        setBranchesLoading(false);
      }
    };
    loadTieUps();
  }, []);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
    setMessage("");
  };

  const validate = (nextForm = form) => {
    const nextErrors = {};
    if (!cleanText(nextForm.fullName)) nextErrors.fullName = "Field required";
    if (!/^\d{10}$/.test(nextForm.mobile)) nextErrors.mobile = "Enter valid 10-digit mobile number";
    if (!cleanText(nextForm.city)) nextErrors.city = "Field required";
    if (!nextForm.branchId) nextErrors.branchId = "Select tied-up bank branch";
    if (!Number(nextForm.carPrice) || Number(nextForm.carPrice) < 0) nextErrors.carPrice = "Field required";
    if (!Number(nextForm.loanAmount) || Number(nextForm.loanAmount) < 0) nextErrors.loanAmount = "Field required";
    if (Number(nextForm.loanAmount) > Number(nextForm.carPrice)) nextErrors.loanAmount = "Required Loan Amount cannot exceed Car On-Road Price";
    if (!nextForm.salespersonId) nextErrors.salespersonId = salespersons.length ? "Field required" : "Add salesperson first";
    if (!nextForm.financeManagerId) nextErrors.financeManagerId = financeManagers.length ? "Field required" : "Add Finance Manager first";
    return nextErrors;
  };

  const validateField = (field) => {
    const nextErrors = validate(form);
    setErrors((current) => ({ ...current, [field]: nextErrors[field] || "" }));
  };

  const submit = async (event) => {
    event.preventDefault();
    const nextForm = {
      ...form,
      fullName: cleanText(form.fullName),
      city: cleanText(form.city),
      carPrice: numericAmount(form.carPrice),
      loanAmount: numericAmount(form.loanAmount),
    };
    const nextErrors = validate(nextForm);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return setMessage("Fix highlighted fields.");
    setSubmitting(true);
    try {
      const response = await api.post("/dealer/leads", {
        ...nextForm,
        status: LEAD_STATUSES.NEW,
        carPrice: Number(nextForm.carPrice),
        loanAmount: Number(nextForm.loanAmount),
        branchId: nextForm.branchId,
        bankBranchId: nextForm.branchId,
        ifscCode: nextForm.branchId,
      });
      navigate(`/finance/leads/${response.data.leadId}/documents`, { state: { created: true } });
    } catch (error) {
      setMessage(error.response?.data?.message || "Failed to create lead");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle title="Add Lead" subtitle="Create a dealership case and route it to one tied-up bank branch." />
      <form onSubmit={submit} className="card p-5">
        {message ? <p className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</p> : null}
        {branchesError ? <p className="mb-4 rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">{branchesError}</p> : null}
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Customer Name *" error={errors.fullName}><input required aria-invalid={Boolean(errors.fullName)} className="field mt-1.5" value={form.fullName} onBlur={() => validateField("fullName")} onChange={(e) => update("fullName", e.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Mobile Number *" error={errors.mobile}><input required aria-invalid={Boolean(errors.mobile)} className="field mt-1.5" inputMode="numeric" maxLength="10" value={form.mobile} onBlur={() => validateField("mobile")} onChange={(e) => update("mobile", digits10(e.target.value))} /></Field>
          <Field label="Customer City *" error={errors.city}><input required aria-invalid={Boolean(errors.city)} className="field mt-1.5" value={form.city} onBlur={() => validateField("city")} onChange={(e) => update("city", e.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Tied-up Bank Branch *" error={errors.branchId}>
            <select required aria-invalid={Boolean(errors.branchId)} disabled={branchesLoading} className="field mt-1.5" value={form.branchId} onBlur={() => validateField("branchId")} onChange={(e) => update("branchId", e.target.value)}>
              <option value="">Select branch</option>
              {branches.map((branch) => <option key={bankKey(branch)} value={bankKey(branch)}>{branchLabel(branch)}</option>)}
            </select>
            {!branchesLoading && branches.length === 0 ? <p className="mt-2 text-sm text-rose-600">No tied-up bank branches found. Open Bank Tie-Ups from the sidebar first.</p> : null}
          </Field>
          <Field label="Car On-Road Price *" error={errors.carPrice}><input required aria-invalid={Boolean(errors.carPrice)} className="field mt-1.5" inputMode="numeric" value={form.carPrice} onBlur={() => validateField("carPrice")} onChange={(e) => update("carPrice", numericAmount(e.target.value))} /></Field>
          <Field label="Required Loan Amount *" error={errors.loanAmount}><input required aria-invalid={Boolean(errors.loanAmount)} className="field mt-1.5" inputMode="numeric" value={form.loanAmount} onBlur={() => validateField("loanAmount")} onChange={(e) => update("loanAmount", numericAmount(e.target.value))} /></Field>
          <Field label="Select Salesperson *" error={errors.salespersonId}><select required aria-invalid={Boolean(errors.salespersonId)} className="field mt-1.5" value={form.salespersonId} onBlur={() => validateField("salespersonId")} onChange={(e) => update("salespersonId", e.target.value)}><option value="">{salespersons.length ? "Select salesperson" : "No salesperson found"}</option>{salespersons.map((person) => <option key={person.id} value={person.id}>{person.name} - {person.jobId}</option>)}</select></Field>
          <Field label="Finance Manager *" error={errors.financeManagerId}>
            <select required aria-invalid={Boolean(errors.financeManagerId)} className="field mt-1.5" value={form.financeManagerId} onBlur={() => validateField("financeManagerId")} onChange={(e) => update("financeManagerId", e.target.value)}>
              <option value="">{financeManagers.length ? "Select Finance Manager" : "No Finance Manager found"}</option>
              {financeManagers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name} - {manager.employeeId}</option>)}
            </select>
            {!financeManagers.length ? (
              <p className="mt-2 text-sm text-red-600">No Finance Manager found. Please add one first.</p>
            ) : null}
          </Field>
          <div className="flex items-end">
            <button disabled={submitting} className="inline-flex h-10 min-w-32 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white disabled:opacity-60">{submitting ? <ButtonSpinner /> : "Submit Lead"}</button>
          </div>
        </div>
        <p className="mt-4 text-sm text-slate-500">Documents are optional and can be uploaded on the next screen.</p>
      </form>
    </div>
  );
}

function BankTieUpsScreen() {
  const cachedTieUps = getCachedGetData("/dealer/bank-tieups");
  const cachedBranches = Array.isArray(cachedTieUps?.availableBranches)
    ? cachedTieUps.availableBranches
    : Array.isArray(cachedTieUps?.availableBanks)
      ? cachedTieUps.availableBanks
      : [];
  const cachedCurrentTieUps = Array.isArray(cachedTieUps?.branchTieUps)
    ? cachedTieUps.branchTieUps
    : Array.isArray(cachedTieUps?.currentTieUps)
      ? cachedTieUps.currentTieUps
      : [];
  const [availableBranches, setAvailableBranches] = useState(() => mergeBranchesByKey(cachedBranches, cachedCurrentTieUps).filter((branch) => branch.active !== false && branch.approved !== false));
  const [selectedBranchIds, setSelectedBranchIds] = useState(() => cachedCurrentTieUps.map((branch) => bankKey(branch)).filter(Boolean));
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(() => !cachedTieUps);
  const [saving, setSaving] = useState(false);

  const loadTieUps = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const response = await api.get("/dealer/bank-tieups");
      const allBranches = Array.isArray(response.data?.availableBranches)
        ? response.data.availableBranches
        : Array.isArray(response.data?.availableBanks)
          ? response.data.availableBanks
          : [];
      const currentTieUps = Array.isArray(response.data?.branchTieUps)
        ? response.data.branchTieUps
        : Array.isArray(response.data?.currentTieUps)
          ? response.data.currentTieUps
          : [];
      setAvailableBranches(mergeBranchesByKey(allBranches, currentTieUps).filter((branch) => branch.active !== false && branch.approved !== false));
      setSelectedBranchIds(currentTieUps.map((branch) => bankKey(branch)).filter(Boolean));
    } catch (requestError) {
      setAvailableBranches((current) => current.length ? current : []);
      setSelectedBranchIds((current) => current.length ? current : []);
      setError("Unable to load banks. Please try again.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { loadTieUps({ silent: Boolean(cachedTieUps) }); }, [loadTieUps]);
  useBackgroundRefresh({ onRefresh: loadTieUps, refreshKey: "finance-bank-tieups", mutationFilter: tieUpMutationFilter });

  const cities = useMemo(() => [...new Set(availableBranches.map((branch) => branch.city).filter(Boolean))].sort(), [availableBranches]);
  const states = useMemo(() => [...new Set(availableBranches.map((branch) => branch.state).filter(Boolean))].sort(), [availableBranches]);
  const filteredBranches = useMemo(() => {
    const needle = cleanText(search).toLowerCase();
    return availableBranches.filter((branch) => {
      const text = [branch.bankName, branch.ifscCode, branch.branchName, branch.city, branch.state].filter(Boolean).join(" ").toLowerCase();
      return (!needle || text.includes(needle)) && (!city || branch.city === city) && (!state || branch.state === state);
    });
  }, [availableBranches, city, search, state]);

  const toggleBranch = (branchId) => {
    setMessage("");
    setError("");
    setSelectedBranchIds((current) => current.includes(branchId) ? current.filter((id) => id !== branchId) : [...current, branchId]);
  };

  const saveTieUps = async () => {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await api.patch("/dealer/bank-tieups", { bankTieUps: selectedBranchIds });
      await loadTieUps();
      setMessage("Bank tie-ups saved successfully.");
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to save bank tie-ups. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <SectionTitle title="Bank Tie-Ups" subtitle="Select approved bank branches available for this dealership's lead routing." />
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid flex-1 gap-3 md:grid-cols-[1fr_180px_180px]">
            <div className="field flex h-10 items-center gap-2 rounded-md bg-white px-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search bank, IFSC, city, state" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
            </div>
            <select value={city} onChange={(event) => setCity(event.target.value)} className="field h-10 rounded-md bg-white">
              <option value="">All cities</option>
              {cities.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <select value={state} onChange={(event) => setState(event.target.value)} className="field h-10 rounded-md bg-white">
              <option value="">All states</option>
              {states.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <button type="button" disabled={saving || loading} onClick={saveTieUps} className="inline-flex h-10 min-w-32 items-center justify-center rounded-md bg-[#0d47a1] px-4 text-sm font-medium text-white disabled:opacity-60">
            {saving ? <ButtonSpinner /> : "Save Tie-Ups"}
          </button>
        </div>
        {error ? <p className="mt-3 rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        {message ? <p className="mt-3 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}
        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
          <div className="grid min-w-[900px] grid-cols-[44px_1.3fr_1fr_1fr_1fr_1fr_130px] gap-3 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium uppercase text-slate-500">
            <span />
            <span>Bank Name</span>
            <span>IFSC Code</span>
            <span>Branch Name</span>
            <span>City</span>
            <span>State</span>
            <span>Approval Status</span>
          </div>
          <div className="overflow-x-auto">
            {loading && !availableBranches.length ? (
              <BranchListSkeleton />
            ) : !availableBranches.length ? (
              <p className="px-3 py-6 text-sm text-slate-500">No approved banks are currently available.</p>
            ) : !filteredBranches.length ? (
              <p className="px-3 py-6 text-sm text-slate-500">No approved bank branches match this search.</p>
            ) : (
              filteredBranches.map((branch) => {
                const id = bankKey(branch);
                const checked = selectedBranchIds.includes(id);
                return (
                  <label key={id} className="grid min-w-[900px] cursor-pointer grid-cols-[44px_1.3fr_1fr_1fr_1fr_1fr_130px] gap-3 border-b border-slate-100 px-3 py-3 text-sm text-slate-700 last:border-b-0 hover:bg-slate-50">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#0d47a1] focus:ring-[#0d47a1]" checked={checked} onChange={() => toggleBranch(id)} />
                    <span className="font-medium text-slate-900">{display(branch.bankName)}</span>
                    <span>{display(branch.ifscCode)}</span>
                    <span>{display(branch.branchName)}</span>
                    <span>{display(branch.city)}</span>
                    <span>{display(branch.state)}</span>
                    <span className={branch.catalogMissing ? "text-amber-700" : "text-emerald-700"}>{branch.catalogMissing ? "tie-up saved" : branch.approvalStatus || "approved"}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function AddLeadScreen() {
  const navigate = useNavigate();
  const { salespersons } = useSalespersons();
  const [branches, setBranches] = useState([]);
  const [availableBranches, setAvailableBranches] = useState([]);
  const [selectedBranchIds, setSelectedBranchIds] = useState([]);
  const [tieUpSearch, setTieUpSearch] = useState("");
  const [tieUpCity, setTieUpCity] = useState("");
  const [tieUpState, setTieUpState] = useState("");
  const [tieUpMessage, setTieUpMessage] = useState("");
  const [tieUpError, setTieUpError] = useState("");
  const [tieUpLoading, setTieUpLoading] = useState(true);
  const [tieUpSaving, setTieUpSaving] = useState(false);
  const [form, setForm] = useState(emptyLead);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const loadBankData = async () => {
      setTieUpLoading(true);
      try {
        const dealerBranchesResponse = await api.get("/dealer/bank-tieups");
        const allBranches = Array.isArray(dealerBranchesResponse.data?.availableBranches)
          ? dealerBranchesResponse.data.availableBranches
          : Array.isArray(dealerBranchesResponse.data?.availableBanks)
            ? dealerBranchesResponse.data.availableBanks
            : [];
        setAvailableBranches(allBranches.filter((branch) => branch.active !== false));
        const currentTieUps = Array.isArray(dealerBranchesResponse.data?.branchTieUps)
          ? dealerBranchesResponse.data.branchTieUps
          : Array.isArray(dealerBranchesResponse.data?.currentTieUps)
            ? dealerBranchesResponse.data.currentTieUps
            : [];
        setBranches(currentTieUps);
        setSelectedBranchIds(currentTieUps.map((branch) => branch.ifscCode || branch.id).filter(Boolean));
      } catch (error) {
        setAvailableBranches([]);
        setBranches([]);
        setTieUpError("Unable to load available branches");
      } finally {
        setTieUpLoading(false);
      }
    };
    loadBankData();
  }, []);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
    setMessage("");
  };
  const validate = (nextForm = form) => {
    const nextErrors = {};
    if (!cleanText(nextForm.fullName)) nextErrors.fullName = "Field required";
    if (!/^\d{10}$/.test(nextForm.mobile)) nextErrors.mobile = "Enter valid 10-digit mobile number";
    if (!cleanText(nextForm.city)) nextErrors.city = "Field required";
    if (!nextForm.branchId) nextErrors.branchId = "Select tied-up bank branch";
    if (!Number(nextForm.carPrice) || Number(nextForm.carPrice) < 0) nextErrors.carPrice = "Field required";
    if (!Number(nextForm.loanAmount) || Number(nextForm.loanAmount) < 0) nextErrors.loanAmount = "Field required";
    if (Number(nextForm.loanAmount) > Number(nextForm.carPrice)) nextErrors.loanAmount = "Required Loan Amount cannot exceed Car On-Road Price";
    if (!nextForm.salespersonId) nextErrors.salespersonId = "Field required";
    return nextErrors;
  };
  const validateField = (field) => {
    const nextErrors = validate(form);
    setErrors((current) => ({ ...current, [field]: nextErrors[field] || "" }));
  };
  const submit = async (event) => {
    event.preventDefault();
    const nextForm = {
      ...form,
      fullName: cleanText(form.fullName),
      city: cleanText(form.city),
      carPrice: numericAmount(form.carPrice),
      loanAmount: numericAmount(form.loanAmount),
    };
    const nextErrors = validate(nextForm);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return setMessage("Fix highlighted fields.");
    setSubmitting(true);
    try {
      const response = await api.post("/dealer/leads", {
        ...nextForm,
        status: LEAD_STATUSES.NEW,
        carPrice: Number(nextForm.carPrice),
        loanAmount: Number(nextForm.loanAmount),
        branchId: nextForm.branchId,
        bankBranchId: nextForm.branchId,
        ifscCode: nextForm.branchId,
      });
      navigate(`/finance/leads/${response.data.leadId}/documents`, { state: { created: true } });
    } catch (error) {
      setMessage(error.response?.data?.message || "Failed to create lead");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleBranch = (branchId) => {
    setTieUpMessage("");
    setTieUpError("");
    setSelectedBranchIds((current) => {
      if (current.includes(branchId)) {
        return current.filter((id) => id !== branchId);
      }
      return [...current, branchId];
    });
  };

  const saveTieUps = async () => {
    setTieUpMessage("");
    setTieUpError("");
    setTieUpSaving(true);
    try {
      await api.patch("/dealer/bank-tieups", { bankTieUps: selectedBranchIds });
      const response = await api.get("/dealer/bank-tieups");
      const updatedBranches = Array.isArray(response.data?.branchTieUps)
        ? response.data.branchTieUps
        : Array.isArray(response.data?.currentTieUps)
          ? response.data.currentTieUps
          : [];
      setBranches(updatedBranches);
      setSelectedBranchIds(updatedBranches.map((branch) => branch.ifscCode || branch.id).filter(Boolean));
      setTieUpMessage("Bank branch tie-ups updated successfully.");
    } catch (error) {
      setTieUpError(error.response?.data?.message || "Unable to save bank tie-ups");
    } finally {
      setTieUpSaving(false);
    }
  };

  const tieUpCities = useMemo(() => [...new Set(availableBranches.map((branch) => branch.city).filter(Boolean))].sort(), [availableBranches]);
  const tieUpStates = useMemo(() => [...new Set(availableBranches.map((branch) => branch.state).filter(Boolean))].sort(), [availableBranches]);
  const filteredBranches = useMemo(() => {
    const search = cleanText(tieUpSearch).toLowerCase();
    return availableBranches.filter((branch) => {
      const matchesSearch = !search || [
        branch.bankName,
        branch.branchName,
        branch.ifscCode,
        branch.city,
        branch.state,
      ].some((value) => String(value || "").toLowerCase().includes(search));
      const matchesCity = !tieUpCity || branch.city === tieUpCity;
      const matchesState = !tieUpState || branch.state === tieUpState;
      return matchesSearch && matchesCity && matchesState;
    });
  }, [availableBranches, tieUpCity, tieUpSearch, tieUpState]);

  return (
    <div className="space-y-4">
      <SectionTitle title="Add Lead" subtitle="Create a dealership case and select a tied-up bank branch for manual lender routing." />
      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Manage Bank Branch Tie-ups</h2>
            <p className="mt-2 text-sm text-slate-600">Select only approved bank branches that this dealership is tied up with. The selected branches are available when creating new leads.</p>
          </div>
          <button type="button" disabled={tieUpSaving || tieUpLoading} onClick={saveTieUps} className="inline-flex h-11 min-w-32 items-center justify-center rounded-md bg-[#0d47a1] px-4 text-sm font-medium text-white disabled:opacity-60">
            {tieUpSaving ? <ButtonSpinner /> : "Save Tie-ups"}
          </button>
        </div>
        {tieUpError ? <p className="mt-3 rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-sm text-rose-700">{tieUpError}</p> : null}
        {tieUpMessage ? <p className="mt-3 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{tieUpMessage}</p> : null}
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_180px_180px]">
          <div className="field flex h-10 items-center gap-2 rounded-md bg-white px-3">
            <Search className="h-4 w-4 text-slate-400" />
            <input value={tieUpSearch} onChange={(event) => setTieUpSearch(event.target.value)} placeholder="Search bank, branch, IFSC" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </div>
          <select value={tieUpCity} onChange={(event) => setTieUpCity(event.target.value)} className="field h-10 rounded-md bg-white">
            <option value="">All cities</option>
            {tieUpCities.map((city) => <option key={city} value={city}>{city}</option>)}
          </select>
          <select value={tieUpState} onChange={(event) => setTieUpState(event.target.value)} className="field h-10 rounded-md bg-white">
            <option value="">All states</option>
            {tieUpStates.map((state) => <option key={state} value={state}>{state}</option>)}
          </select>
        </div>
        <div className="mt-4 grid gap-3">
          {tieUpLoading ? (
            <div className="space-y-3" aria-hidden="true">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="h-11 animate-pulse rounded-lg border border-slate-200 bg-white" />)}</div>
          ) : filteredBranches.length ? (
            filteredBranches.map((branch) => {
              const branchKey = branch.ifscCode || branch.id;
              return (
              <label key={branchKey} className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 transition hover:border-[#0d47a1]">
                <input type="checkbox" checked={selectedBranchIds.includes(branchKey)} onChange={() => toggleBranch(branchKey)} className="h-4 w-4 rounded border-slate-300 text-[#0d47a1] focus:ring-[#0d47a1]" />
                <span>{branch.bankName} — {branch.branchName}{branch.ifscCode ? ` (${branch.ifscCode})` : ""}</span>
              </label>
              );
            })
          ) : (
            <p className="text-sm text-slate-500">No approved bank branches match this search.</p>
          )}
        </div>
      </section>
      <form onSubmit={submit} className="card p-5">
        {message ? <p className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</p> : null}
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Customer Name" error={errors.fullName}><input aria-invalid={Boolean(errors.fullName)} className="field mt-1.5" value={form.fullName} onBlur={() => validateField("fullName")} onChange={(e) => update("fullName", e.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Mobile Number" error={errors.mobile}><input aria-invalid={Boolean(errors.mobile)} className="field mt-1.5" inputMode="numeric" maxLength="10" value={form.mobile} onBlur={() => validateField("mobile")} onChange={(e) => update("mobile", digits10(e.target.value))} /></Field>
          <Field label="Customer City" error={errors.city}><input aria-invalid={Boolean(errors.city)} className="field mt-1.5" value={form.city} onBlur={() => validateField("city")} onChange={(e) => update("city", e.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Tied-up Bank Branch" error={errors.branchId}>
            <select aria-invalid={Boolean(errors.branchId)} className="field mt-1.5" value={form.branchId} onBlur={() => validateField("branchId")} onChange={(e) => update("branchId", e.target.value)}>
              <option value="">Select branch</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.bankName} — {branch.branchName}{branch.ifscCode ? ` (${branch.ifscCode})` : ""}</option>
              ))}
            </select>
            {branches.length === 0 ? <p className="mt-2 text-sm text-rose-600">No tied-up bank branches found. Configure bank tie-ups in dealer profile first.</p> : null}
          </Field>
          <Field label="Car On-Road Price" error={errors.carPrice}><input aria-invalid={Boolean(errors.carPrice)} className="field mt-1.5" inputMode="numeric" value={form.carPrice} onBlur={() => validateField("carPrice")} onChange={(e) => update("carPrice", numericAmount(e.target.value))} /></Field>
          <Field label="Required Loan Amount" error={errors.loanAmount}><input aria-invalid={Boolean(errors.loanAmount)} className="field mt-1.5" inputMode="numeric" value={form.loanAmount} onBlur={() => validateField("loanAmount")} onChange={(e) => update("loanAmount", numericAmount(e.target.value))} /></Field>
          <Field label="Select Salesperson" error={errors.salespersonId}><select aria-invalid={Boolean(errors.salespersonId)} className="field mt-1.5" value={form.salespersonId} onBlur={() => validateField("salespersonId")} onChange={(e) => update("salespersonId", e.target.value)}><option value="">Select salesperson</option>{salespersons.map((person) => <option key={person.id} value={person.id}>{person.name} - {person.jobId}</option>)}</select></Field>
          <div className="flex items-end">
            <button disabled={submitting} className="inline-flex h-10 min-w-32 items-center justify-center rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white disabled:opacity-60">{submitting ? <ButtonSpinner /> : "Submit Lead"}</button>
          </div>
        </div>
        <p className="mt-4 text-sm text-slate-500">Documents are optional and can be uploaded on the next screen.</p>
      </form>
    </div>
  );
}

function SalespersonManagementScreen() {
  const { salespersons, loading, loadSalespersons } = useSalespersons({ includeInactive: true });
  const [form, setForm] = useState(emptySalesperson);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };
  const validate = (nextForm = form) => {
    const nextErrors = {};
    if (!cleanText(nextForm.name)) nextErrors.name = "Field required";
    if (!/^\d{10}$/.test(nextForm.mobile)) nextErrors.mobile = "Enter valid 10-digit mobile number";
    if (!cleanText(nextForm.jobId)) nextErrors.jobId = "Field required";
    if (!validEmail(nextForm.email)) nextErrors.email = "Enter valid email address";
    return nextErrors;
  };
  const add = async (event) => {
    event.preventDefault();
    setMessage("");
    const nextForm = { name: cleanText(form.name), mobile: digits10(form.mobile), jobId: cleanText(form.jobId), email: cleanEmail(form.email) };
    const nextErrors = validate(nextForm);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    try {
      await api.post("/dealer/salespersons", nextForm);
      setForm(emptySalesperson);
      await loadSalespersons();
      setMessage("Salesperson added");
    } catch (error) {
      setMessage(error.response?.data?.message || "Failed to add salesperson");
    } finally {
      setSaving(false);
    }
  };
  const remove = async (person) => {
    await api.delete(`/dealer/salespersons/${person.id}`);
    await loadSalespersons();
  };
  const rows = salespersons.map((person) => ({
    key: person.id,
    cells: [
      person.name,
      person.mobile,
      person.jobId,
      person.email,
      person.active ? "Active" : "Inactive",
      person.active ? <button key="remove" onClick={() => remove(person)} className="rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700">Remove</button> : "-",
    ],
  }));
  return (
    <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <form onSubmit={add} className="card p-5">
        <h2 className="text-lg font-semibold text-slate-900">Add Salesperson</h2>
        {message ? <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</p> : null}
        <div className="mt-4 grid gap-3">
          <Field label="Salesperson Name" error={errors.name}><input aria-invalid={Boolean(errors.name)} className="field mt-1.5" value={form.name} onBlur={() => setErrors(validate(form))} onChange={(e) => update("name", e.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Mobile Number" error={errors.mobile}><input aria-invalid={Boolean(errors.mobile)} className="field mt-1.5" inputMode="numeric" maxLength="10" value={form.mobile} onBlur={() => setErrors(validate(form))} onChange={(e) => update("mobile", digits10(e.target.value))} /></Field>
          <Field label="Job ID" error={errors.jobId}><input aria-invalid={Boolean(errors.jobId)} className="field mt-1.5" value={form.jobId} onBlur={() => setErrors(validate(form))} onChange={(e) => update("jobId", e.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Mail ID" error={errors.email}><input aria-invalid={Boolean(errors.email)} className="field mt-1.5" type="email" value={form.email} onBlur={() => setErrors(validate(form))} onChange={(e) => update("email", e.target.value.trim().toLowerCase())} /></Field>
          <button disabled={saving} className="inline-flex h-10 min-w-36 items-center justify-center rounded-md bg-[#0d47a1] px-4 text-sm font-medium text-white disabled:opacity-60">{saving ? <ButtonSpinner /> : "Add Salesperson"}</button>
        </div>
      </form>
      <div className="space-y-4">
        <SectionTitle title="Add / Remove Salesperson" subtitle="Soft remove keeps existing case history intact." />
        <Table headers={["Salesperson Name", "Mobile Number", "Job ID", "Mail ID", "Status", "Action"]} rows={rows} loading={loading} />
      </div>
    </div>
  );
}

function FinanceManagerManagementScreen() {
  const { financeManagers, loading, loadFinanceManagers } = useFinanceManagers({ includeInactive: true });
  const [form, setForm] = useState(emptyFinanceManager);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };
  const validate = (nextForm = form) => {
    const nextErrors = {};
    if (!cleanText(nextForm.name)) nextErrors.name = "Field required";
    if (!/^\d{10}$/.test(nextForm.mobile)) nextErrors.mobile = "Enter valid 10-digit mobile number";
    if (!cleanText(nextForm.employeeId)) nextErrors.employeeId = "Field required";
    if (!validEmail(nextForm.email)) nextErrors.email = "Enter valid email address";
    return nextErrors;
  };
  const add = async (event) => {
    event.preventDefault();
    setMessage("");
    const nextForm = { name: cleanText(form.name), mobile: digits10(form.mobile), employeeId: cleanText(form.employeeId), email: cleanEmail(form.email) };
    const nextErrors = validate(nextForm);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setSaving(true);
    try {
      await api.post("/dealer/finance-managers", nextForm);
      setForm(emptyFinanceManager);
      await loadFinanceManagers();
      setMessage("Finance Manager added");
    } catch (error) {
      setMessage(error.response?.data?.message || "Failed to add Finance Manager");
    } finally {
      setSaving(false);
    }
  };
  const toggleStatus = async (manager) => {
    await api.patch(`/dealer/finance-managers/${manager.id}`, { active: !manager.active });
    await loadFinanceManagers();
  };
  const rows = financeManagers.map((manager) => ({
    key: manager.id,
    cells: [
      manager.name,
      manager.mobile,
      manager.employeeId,
      manager.email,
      manager.active ? "Active" : "Inactive",
      <button key="toggle" onClick={() => toggleStatus(manager)} className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${manager.active ? "border-amber-200 text-amber-700" : "border-emerald-200 text-emerald-700"}`}>{manager.active ? "Mark Inactive" : "Mark Active"}</button>,
    ],
  }));
  return (
    <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <form onSubmit={add} className="card p-5">
        <h2 className="text-lg font-semibold text-slate-900">Add Finance Manager</h2>
        {message ? <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</p> : null}
        <div className="mt-4 grid gap-3">
          <Field label="Finance Manager Name" error={errors.name}><input aria-invalid={Boolean(errors.name)} className="field mt-1.5" value={form.name} onBlur={() => setErrors(validate(form))} onChange={(e) => update("name", e.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Mobile Number" error={errors.mobile}><input aria-invalid={Boolean(errors.mobile)} className="field mt-1.5" inputMode="numeric" maxLength="10" value={form.mobile} onBlur={() => setErrors(validate(form))} onChange={(e) => update("mobile", digits10(e.target.value))} /></Field>
          <Field label="Employee ID" error={errors.employeeId}><input aria-invalid={Boolean(errors.employeeId)} className="field mt-1.5" value={form.employeeId} onBlur={() => setErrors(validate(form))} onChange={(e) => update("employeeId", e.target.value.replace(/[<>]/g, ""))} /></Field>
          <Field label="Email ID" error={errors.email}><input aria-invalid={Boolean(errors.email)} className="field mt-1.5" type="email" value={form.email} onBlur={() => setErrors(validate(form))} onChange={(e) => update("email", e.target.value.trim().toLowerCase())} /></Field>
          <button disabled={saving} className="inline-flex h-10 min-w-36 items-center justify-center rounded-md bg-[#0d47a1] px-4 text-sm font-medium text-white disabled:opacity-60">{saving ? <ButtonSpinner /> : "Add Finance Manager"}</button>
        </div>
      </form>
      <div className="space-y-4">
        <SectionTitle title="Finance Managers" subtitle="Dealership-scoped ownership master for loan processing responsibility." />
        <Table headers={["Finance Manager Name", "Mobile Number", "Employee ID", "Email ID", "Status", "Action"]} rows={rows} loading={loading} />
      </div>
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
      <Table headers={["Case ID", "Customer Name", "Mobile Number", "Customer City", "Selected Bank", "Car On-Road Price", "Required Loan Amount", "Assigned Bank", "Finance Manager", "Assigned Executive", "Executive Mobile", "Current Status", "Status Updated Date", "Documents"]} rows={leadRows(leads, "cases")} loading={loading} page={page} total={total} hasMore={hasMore} onPage={pageTo} />
    </div>
  );
}

function StatusScreen() {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(Number(params.get("page") || 1));
  const status = params.get("status") || LEAD_STATUSES.NEW;
  const financeManagerId = params.get("financeManagerId") || "";
  const { financeManagers } = useFinanceManagers();
  const { leads, total, hasMore, loading, loadLeads } = useDealerLeads({ status, financeManagerId });
  const choose = (value) => {
    setPage(1);
    const next = { status: value, financeManagerId, page: "1" };
    Object.keys(next).forEach((key) => !next[key] && delete next[key]);
    setParams(next);
    loadLeads({ ...next, page: 1 });
  };
  const chooseManager = (value) => {
    setPage(1);
    const next = { status, financeManagerId: value, page: "1" };
    Object.keys(next).forEach((key) => !next[key] && delete next[key]);
    setParams(next);
    loadLeads({ ...next, page: 1 });
  };
  const pageTo = (nextPage) => {
    setPage(nextPage);
    loadLeads({ page: nextPage, status, financeManagerId });
  };
  const rejected = normalizeStatus(status) === LEAD_STATUSES.REJECTED;
  return (
    <div className="space-y-4">
      <SectionTitle title="Status" subtitle="Status lists update from Loan Executive changes." />
      <div className="flex flex-wrap gap-2">
        {statusTabs.map((item) => <button key={item.value} onClick={() => choose(item.value)} className={`rounded-md border px-3 py-2 text-sm font-medium ${status === item.value ? "border-[#0d47a1] bg-[#0d47a1] text-white" : "border-slate-200 bg-white text-slate-700"}`}>{item.label}</button>)}
      </div>
      <div className="max-w-xs">
        <select className="field h-10" value={financeManagerId} onChange={(e) => chooseManager(e.target.value)}>
          <option value="">All Finance Managers</option>
          {financeManagers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name} - {manager.employeeId}</option>)}
        </select>
      </div>
      <Table headers={rejected ? ["Case ID", "Customer Name", "Mobile Number", "Selected Bank", "Loan Amount", "Current Status", "Rejection Reason", "Finance Manager", "Executive Name", "Executive Mobile", "Last Updated", "Documents"] : ["Case ID", "Customer Name", "Mobile Number", "Selected Bank", "Loan Amount", "Current Status", "Finance Manager", "Executive Name", "Executive Mobile", "Last Updated", "Documents"]} rows={leadRows(leads, "status")} loading={loading} page={page} total={total} hasMore={hasMore} onPage={pageTo} />
    </div>
  );
}

function SectionTitle({ title, subtitle }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function Field({ label, children, error }) {
  return <label className="text-sm font-medium text-slate-700">{label}{children}{error ? <span className="mt-1 block text-xs font-medium text-red-600">{error}</span> : null}</label>;
}

export function FinanceLeadDetailPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const cachedLead = getCachedGetData(`/dealer/leads/${leadId}`)
    || findCachedGetItem("/dealer/leads", (item) => item.id === leadId || item.caseId === leadId);
  const [lead, setLead] = useState(() => cachedLead);
  const [loading, setLoading] = useState(() => !cachedLead);

  const loadLead = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get(`/dealer/leads/${leadId}`);
      setLead(response.data);
    } catch {
      setLead((current) => current || null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    loadLead();
  }, [loadLead]);
  useRealtimeLeadDetailPatch({ leadId, setLead });
  useLeadDetailRealtime({ lead, leadId, onRefresh: loadLead, mutationFilter: leadMutationFilter });

  if (loading && !lead) return <DetailPageSkeleton />;
  if (!lead) return <section className="card p-5 text-sm text-slate-500">Lead not found.</section>;

  return (
    <section className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{lead.fullName || "Lead Details"}</h2>
            <p className="mt-1 text-sm text-slate-500">{caseId(lead)} · {lead.mobile || "-"}</p>
          </div>
          <button onClick={() => navigate(`/finance/leads/${lead.id}/documents`)} className="h-9 rounded-md bg-[#0d47a1] px-3 text-xs font-medium text-white">View Documents</button>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {[["Case ID", caseId(lead)], ["Customer", lead.fullName], ["City", lead.city], ["Selected Bank", bankDisplay(lead)], ["Loan Amount", moneyValue(lead.loanAmount)], ["Salesperson", lead.assignedSalesperson], ["Finance Manager", lead.financeManagerName || lead.assignedFinanceManager], ["Executive", lead.assignedExecutiveName], ["Executive Mobile", lead.assignedExecutiveMobile || lead.executiveMobile], ["Status", financeStatus(lead)]].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase text-slate-500">{label}</p>
              <p className="mt-1 font-medium text-slate-900">{value || "-"}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinanceLeadDocumentsPage() {
  const { leadId } = useParams();
  const [lead, setLead] = useState(null);
  const [docs, setDocs] = useState([]);
  const [files, setFiles] = useState({});
  const [progress, setProgress] = useState({});
  const [message, setMessage] = useState("");

  const loadDocs = useCallback(() => {
    api.get(`/documents/lead/${leadId}`).then((response) => setDocs(response.data || [])).catch(() => setDocs([]));
  }, [leadId]);

  const loadLead = useCallback(() => {
    return api.get(`/dealer/leads/${leadId}`).then((response) => setLead(response.data)).catch(() => {});
  }, [leadId]);

  useEffect(() => { loadDocs(); }, [loadDocs]);
  useEffect(() => {
    let active = true;
    api.get(`/dealer/leads/${leadId}`).then((response) => { if (active) setLead(response.data); }).catch(() => {});
    return () => { active = false; };
  }, [leadId]);
  useRealtimeLeadDetailPatch({ leadId, setLead });
  useLeadDetailRealtime({
    lead,
    leadId,
    onRefresh: () => {
      loadDocs();
      loadLead();
    },
    mutationFilter: leadMutationFilter,
  });

  const upload = async (type) => {
    const file = files[type];
    if (!file) return;
    const form = new FormData();
    form.append("document", file);
    form.append("leadId", leadId);
    form.append("type", type);
    setProgress((current) => ({ ...current, [type]: 1 }));
    try {
      await api.post("/documents/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (event) => {
          const percent = event.total ? Math.round((event.loaded * 100) / event.total) : 50;
          setProgress((current) => ({ ...current, [type]: percent }));
        },
      });
      setMessage(`${type} uploaded`);
      setFiles((current) => ({ ...current, [type]: null }));
      setProgress((current) => ({ ...current, [type]: 100 }));
      loadDocs();
    } catch {
      setProgress((current) => ({ ...current, [type]: -1 }));
      setMessage(`${type} upload failed. Retry upload.`);
    }
  };

  const uploaded = (type) => docs.find((doc) => String(doc.type || "").toLowerCase() === type.toLowerCase());
  const bankDocs = bankDocumentRows(lead);
  return (
    <section className="space-y-5">
      <div className="card p-5">
        <h2 className="text-lg font-semibold text-slate-900">Customer Documents</h2>
        <p className="mt-1 text-sm text-slate-500">Case ID: {caseId(lead || { id: leadId })}</p>
        {message ? <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-[#0d47a1]">{message}</p> : null}
      </div>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">Loan Executive Remark</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{loanExecutiveRemark(lead)}</p>
      </section>
      <PendingDocumentsPanel lead={lead} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {documentTypes.map((type) => {
          const doc = uploaded(type);
          const file = files[type];
          const percent = progress[type] || 0;
          return (
            <div key={type} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="font-medium text-slate-900">{type}</h3><p className="mt-1 text-xs text-slate-500">{doc ? "Uploaded" : "Optional"}</p></div>
                <FileText className="h-5 w-5 text-slate-400" />
              </div>
              <label className="mt-4 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-center text-sm text-slate-500">
                <UploadCloud className="mb-2 h-5 w-5" />
                {file?.name || doc?.file || "Choose file"}
                <input type="file" className="hidden" accept=".pdf,image/png,image/jpeg" onChange={(e) => setFiles((current) => ({ ...current, [type]: e.target.files?.[0] || null }))} />
              </label>
              {percent > 0 ? <div className="mt-3 h-1.5 rounded-full bg-slate-100"><div className={`h-1.5 rounded-full ${percent < 0 ? "bg-red-500" : "bg-[#0d47a1]"}`} style={{ width: `${Math.max(percent, 8)}%` }} /></div> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => upload(type)} disabled={!file} className="h-9 rounded-md bg-[#0d47a1] px-3 text-xs font-medium text-white disabled:opacity-50">{doc ? "Replace" : percent < 0 ? "Retry Upload" : "Upload"}</button>
                {doc?.url ? <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-md border border-slate-200 px-3 text-xs">Preview</a> : null}
                <button onClick={() => setFiles((current) => ({ ...current, [type]: null }))} className="h-9 rounded-md border border-slate-200 px-3 text-xs">Remove File</button>
              </div>
            </div>
          );
        })}
      </div>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-base font-semibold text-slate-900">Bank Uploaded Documents</h2>
        {bankDocs.length ? (
          <div className="mt-3 grid gap-2">
            {bankDocs.map((doc) => {
              const url = doc.url || doc.fileUrl || doc.downloadUrl;
              return (
                <div key={doc.id || doc.documentType || doc.type} className="flex flex-col gap-2 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-slate-900">{doc.documentType || doc.type || "Bank Document"}</p>
                    <p className="text-xs text-slate-500">{dateTime(doc.uploadedAt || doc.createdAt)} by {display(doc.uploadedBy)}</p>
                  </div>
                  {url ? <a href={url} target="_blank" rel="noreferrer" className="text-xs font-medium text-[#0d47a1]">Preview / Download</a> : <span className="text-xs text-slate-500">Stored in application</span>}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">No records found.</p>
        )}
      </section>
    </section>
  );
}
