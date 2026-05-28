import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { LEAD_STATUSES, normalizeStatus } from "../../constants/status.js";
import { useLeadDetailRealtime, useRoleLeadRealtime } from "../../hooks/useRealtimeRefresh.js";
import { api } from "../../services/api.js";

const pageSize = 10;
const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

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

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanEmail(value) {
  return cleanText(value).toLowerCase();
}

function digits10(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 10);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(value));
}

function caseId(lead) {
  return lead.caseId || lead.id;
}

function moneyValue(value) {
  return `Rs. ${money.format(Number(value || 0))}`;
}

function dateValue(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function timeValue(value) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function dateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function leadStatusLabel(lead) {
  const status = normalizeStatus(lead.status || lead.assignmentStatus || LEAD_STATUSES.UNDER_REVIEW);
  if (status === LEAD_STATUSES.NEW) return "New Lead";
  if (status === LEAD_STATUSES.DISBURSED) return "Disbursed";
  if (status === LEAD_STATUSES.REJECTED) return lead.rejectionReason || lead.loanRejectionReason ? "Loan Rejected With Reason" : "Rejected";
  if ([LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.DOCUMENT_RECEIVED, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING].includes(status)) return "Pending Documents";
  if (status === LEAD_STATUSES.CONTACTED) return "Contacted";
  if (status === LEAD_STATUSES.ALL_DOCUMENTS_RECEIVED) return "All Documents Received";
  if (status === LEAD_STATUSES.UNDER_BANK_PROCESS) return "Under Bank Process";
  return "Bank Process";
}

function responseRows(response) {
  return Array.isArray(response?.data?.data) ? response.data.data : Array.isArray(response?.data) ? response.data : [];
}

function Table({ title, headers, rows, loading, page, total, onPage }) {
  return <OperationalTable title={title} headers={headers} rows={rows} loading={loading} page={page} total={total} onPage={onPage} pageSize={pageSize} />;
}

function DetailState({ title, message, requestId, onRetry, tone = "slate" }) {
  const tones = {
    slate: "border-slate-200 bg-white text-slate-600",
    red: "border-red-100 bg-red-50 text-red-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
  };
  return (
    <section className={`rounded-lg border p-5 text-sm ${tones[tone] || tones.slate}`}>
      <p className="font-semibold">{title}</p>
      <p className="mt-1">{message}</p>
      {requestId ? <p className="mt-2 text-xs opacity-80">Request ID: {requestId}</p> : null}
      {onRetry ? <button onClick={onRetry} className="mt-4 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700">Retry</button> : null}
    </section>
  );
}

function DetailSkeleton() {
  return (
    <section className="space-y-4">
      <div className="h-20 animate-pulse rounded-lg border border-slate-200 bg-white" />
      <div className="grid gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg border border-slate-200 bg-white" />)}
      </div>
      <div className="h-64 animate-pulse rounded-lg border border-slate-200 bg-white" />
    </section>
  );
}

function SearchBar({ value, onChange }) {
  return (
    <div className="relative rounded-lg border border-slate-200 bg-white p-3">
      <Search className="absolute left-6 top-5 h-4 w-4 text-slate-400" />
      <input className="h-9 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-[#0d47a1]" placeholder="Search records" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function useBankLeads(search) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") || 1);

  const load = useCallback(async (nextPage = page, { silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get("/bank/leads", { params: { page: nextPage, limit: pageSize, search } });
      setRows(responseRows(response));
      setTotal(response.data?.total || responseRows(response).length);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { load(page); }, [load, page]);
  const realtimeRefresh = useCallback(() => load(page, { silent: true }), [load, page]);
  useRoleLeadRealtime({ onRefresh: realtimeRefresh, pageSize });
  const onPage = (nextPage) => setParams({ page: String(nextPage) });
  return { rows, total, loading, page, onPage, load };
}

function useExecutives() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/bank/executives");
      setRows(responseRows(response));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  return { rows, loading, load };
}

function TotalLeadsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const { rows, total, loading, page, onPage } = useBankLeads(search);
  const tableRows = rows.map((lead) => ({
    key: lead.id,
    cells: [
      caseId(lead),
      display(lead.fullName || lead.customerName),
      display(lead.mobile),
      display(lead.city || lead.dealershipCity),
      display(lead.preferredBank || lead.bankPartner),
      moneyValue(lead.onRoadPrice || lead.carOnRoadPrice),
      moneyValue(lead.loanAmount || lead.requiredLoanAmount),
      dateValue(lead.createdAt),
      timeValue(lead.createdAt),
      display(lead.assignedExecutiveName),
      display(lead.assignedExecutiveMobile || lead.executiveMobile),
      leadStatusLabel(lead),
      <button key="docs" onClick={() => navigate(`/bank-manager/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View Documents</button>,
    ],
  }));
  return (
    <section className="space-y-4">
      <PageTitle title="Total Leads" />
      <SearchBar value={search} onChange={setSearch} />
      <Table title="Assigned Bank Leads" headers={["Case ID", "Customer Name", "Mobile Number", "Customer City", "Preferred Bank", "Car On-Road Price", "Required Loan Amount", "Case Generated Date", "Case Generated Time", "Assigned Executive Name", "Assigned Executive Mobile Number", "Current Lead Status", "Documents"]} rows={tableRows} loading={loading} page={page} total={total} onPage={onPage} />
    </section>
  );
}

function ManageExecutivePage() {
  const { rows, loading, load } = useExecutives();
  const [form, setForm] = useState({ name: "", mobile: "", jobId: "", email: "" });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [credentials, setCredentials] = useState(null);
  const [busy, setBusy] = useState(false);

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

  const submit = async (event) => {
    event.preventDefault();
    setMessage("");
    setError("");
    const nextForm = { name: cleanText(form.name), mobile: digits10(form.mobile), jobId: cleanText(form.jobId), email: cleanEmail(form.email) };
    const nextErrors = validate(nextForm);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setBusy(true);
    try {
      const response = await api.post("/bank/executives", nextForm);
      setForm({ name: "", mobile: "", jobId: "", email: "" });
      setMessage("Executive added successfully.");
      setCredentials({
        name: response.data?.name || response.data?.fullName || nextForm.name,
        email: response.data?.email || nextForm.email,
        temporaryPassword: response.data?.temporaryPassword || "",
        portalLogin: response.data?.portalLogin || `${window.location.origin}/executive/login`,
      });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Unable to add executive");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (executive) => {
    const confirmed = window.confirm(`Remove ${executive.name || executive.fullName || executive.jobId}?`);
    if (!confirmed) return;
    await api.delete(`/bank/executives/${executive.id}`);
    setMessage("Executive removed successfully.");
    await load();
  };

  const lifecycle = async (executive, action) => {
    let payload = { action };
    if (action === "transfer") {
      const branch = window.prompt("Enter new branch/location", executive.branchCity || executive.bankBranchLocation || "");
      if (!branch) return;
      payload = { action, branch, city: branch };
    } else if (action !== "activate" && !window.confirm(`${action === "remove" ? "Remove" : action === "suspend" ? "Suspend" : "Disable"} ${executive.name || executive.email}?`)) return;
    try {
      await api.post(`/bank/executives/${executive.id}/lifecycle`, payload);
      setMessage(`Executive ${action} completed.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.message || `Unable to ${action} executive`);
    }
  };

  const resetPassword = async (executive) => {
    if (!window.confirm(`Reset password for ${executive.name || executive.email}? Existing sessions will be revoked.`)) return;
    try {
      const response = await api.post(`/bank/executives/${executive.id}/reset-password`);
      setCredentials({
        name: response.data?.executive?.name || executive.name || executive.fullName,
        email: executive.email || executive.officialEmail,
        temporaryPassword: response.data?.temporaryPassword || "",
        portalLogin: response.data?.portalLogin || `${window.location.origin}/executive/login`,
      });
      setMessage("Temporary password generated.");
    } catch (err) {
      setError(err.response?.data?.message || "Unable to reset password");
    }
  };

  const tableRows = rows.map((executive) => ({
    key: executive.id,
    cells: [
      display(executive.name || executive.fullName),
      display(executive.mobile),
      display(executive.email || executive.officialEmail),
      display(executive.jobId),
      display(executive.status),
      <div key="actions" className="flex flex-wrap gap-2">
        <button type="button" onClick={() => window.alert(`${executive.name || executive.fullName}\n${executive.email || executive.officialEmail}\n${executive.mobile}\n${executive.jobId}`)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700">View</button>
        <button type="button" onClick={() => lifecycle(executive, "suspend")} className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700">Suspend</button>
        <button type="button" onClick={() => lifecycle(executive, "activate")} className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700">Activate</button>
        <button type="button" onClick={() => resetPassword(executive)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700">Reset Password</button>
        <button type="button" onClick={() => lifecycle(executive, "transfer")} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700">Transfer Branch</button>
        <button type="button" disabled={executive.active === false} onClick={() => remove(executive)} className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50">Remove</button>
      </div>,
    ],
  }));

  return (
    <section className="space-y-4">
      <PageTitle title="Manage Executive" />
      {credentials ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Executive Created Successfully</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">{credentials.name}</h2>
              <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                <p><span className="font-semibold">Portal Login:</span> {credentials.portalLogin}</p>
                <p><span className="font-semibold">Email:</span> {credentials.email}</p>
                <p><span className="font-semibold">Temporary Password:</span> {credentials.temporaryPassword}</p>
              </div>
              <p className="mt-3 text-sm font-medium text-emerald-800">Please ask executive to change password after first login.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => navigator.clipboard?.writeText(`Portal Login: ${credentials.portalLogin}\nEmail: ${credentials.email}\nTemporary Password: ${credentials.temporaryPassword}`)} className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700">Copy Credentials</button>
              <button type="button" onClick={() => navigator.clipboard?.writeText(credentials.portalLogin)} className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700">Copy Portal URL</button>
              <button type="button" onClick={() => setCredentials(null)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">Close</button>
            </div>
          </div>
        </div>
      ) : null}
      <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm font-medium text-slate-700">Executive Name<input aria-invalid={Boolean(errors.name)} className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3 outline-none focus:border-[#0d47a1]" value={form.name} onBlur={() => setErrors(validate(form))} onChange={(event) => update("name", event.target.value.replace(/[<>]/g, ""))} />{errors.name ? <span className="mt-1 block text-xs font-medium text-red-600">{errors.name}</span> : null}</label>
          <label className="text-sm font-medium text-slate-700">Mobile Number<input aria-invalid={Boolean(errors.mobile)} className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3 outline-none focus:border-[#0d47a1]" value={form.mobile} maxLength={10} inputMode="numeric" onBlur={() => setErrors(validate(form))} onChange={(event) => update("mobile", digits10(event.target.value))} />{errors.mobile ? <span className="mt-1 block text-xs font-medium text-red-600">{errors.mobile}</span> : null}</label>
          <label className="text-sm font-medium text-slate-700">Job ID<input aria-invalid={Boolean(errors.jobId)} className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3 outline-none focus:border-[#0d47a1]" value={form.jobId} onBlur={() => setErrors(validate(form))} onChange={(event) => update("jobId", event.target.value.replace(/[<>]/g, ""))} />{errors.jobId ? <span className="mt-1 block text-xs font-medium text-red-600">{errors.jobId}</span> : null}</label>
          <label className="text-sm font-medium text-slate-700 md:col-span-3">Official Email<input aria-invalid={Boolean(errors.email)} type="email" className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3 outline-none focus:border-[#0d47a1]" value={form.email} onBlur={() => setErrors(validate(form))} onChange={(event) => update("email", event.target.value.trim().toLowerCase())} />{errors.email ? <span className="mt-1 block text-xs font-medium text-red-600">{errors.email}</span> : null}</label>
        </div>
        {message ? <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
        <button disabled={busy} className="mt-4 rounded-md bg-[#0d47a1] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Add Executive</button>
      </form>
      <Table title="Executive List" headers={["Executive Name", "Mobile Number", "Official Email", "Job ID", "Status", "Actions"]} rows={tableRows} loading={loading} />
    </section>
  );
}

function AllExecutivesPage() {
  const navigate = useNavigate();
  const { rows, loading } = useExecutives();
  const tableRows = rows.map((executive) => ({
    key: executive.id,
    cells: [
      display(executive.name || executive.fullName),
      display(executive.mobile),
      display(executive.email || executive.officialEmail),
      display(executive.jobId),
      executive.totalAssignedCases || 0,
      executive.currentActiveCases || 0,
      display(executive.status),
      <button key="cases" onClick={() => navigate(`/bank-manager/executives/${executive.id}/cases`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">All Cases</button>,
    ],
  }));
  return (
    <section className="space-y-4">
      <PageTitle title="All Executives" />
      <Table title="Bank Executives" headers={["Executive Name", "Mobile Number", "Official Email", "Job ID", "Total Assigned Cases", "Current Active Cases", "Status", "All Cases"]} rows={tableRows} loading={loading} />
    </section>
  );
}

function ExecutiveCasesPage() {
  const { executiveId } = useParams();
  const navigate = useNavigate();
  const [payload, setPayload] = useState({ data: [], executive: null });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    api.get(`/bank/executives/${executiveId}/cases`).then((response) => {
      if (active) setPayload({ data: responseRows(response), executive: response.data?.executive || null });
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [executiveId]);
  const rows = payload.data.map((lead) => ({
    key: lead.id,
    cells: [
      caseId(lead),
      display(lead.fullName || lead.customerName),
      display(lead.mobile),
      display(lead.city || lead.dealershipCity),
      moneyValue(lead.loanAmount || lead.requiredLoanAmount),
      display(lead.preferredBank || lead.bankPartner),
      leadStatusLabel(lead),
      dateTime(lead.assignmentTimestamp || lead.createdAt),
      dateTime(lead.updatedAt || lead.statusUpdatedAt || lead.createdAt),
      <button key="docs" onClick={() => navigate(`/bank-manager/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">Documents</button>,
    ],
  }));
  return (
    <section className="space-y-4">
      <PageTitle title={payload.executive ? `${payload.executive.name || payload.executive.fullName} Cases` : "Executive Cases"} />
      <Table title="Assigned Cases" headers={["Case ID", "Customer Name", "Customer Mobile", "Customer City", "Loan Amount", "Preferred Bank", "Current Status", "Assigned Date", "Last Updated", "Documents"]} rows={rows} loading={loading} />
    </section>
  );
}

function PageTitle({ title }) {
  return <div><p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Bank Manager</p><h1 className="mt-1 text-xl font-semibold text-slate-900">{title}</h1></div>;
}

export function BankBranchManagerPanel({ mode = "leads" }) {
  if (mode === "manage-executive") return <ManageExecutivePage />;
  if (mode === "executives") return <AllExecutivesPage />;
  if (mode === "executive-cases") return <ExecutiveCasesPage />;
  return <TotalLeadsPage />;
}

export function BankManagerLeadDetailPage() {
  const { leadId } = useParams();
  const [lead, setLead] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadLead = useCallback(async ({ silent = false } = {}) => {
    setError(null);
    if (!silent) setLoading(true);
    try {
      const response = await api.get(`/bank/leads/${leadId}`);
      setLead(response.data);
    } catch (err) {
      setLead(null);
      setError({
        status: err.response?.status || 0,
        message: err.response?.data?.message || err.message || "Unable to load this lead.",
        requestId: err.response?.data?.requestId || err.response?.headers?.["x-request-id"] || "",
      });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { loadLead(); }, [loadLead]);
  useLeadDetailRealtime({ lead, leadId, onRefresh: loadLead });

  if (loading) return <DetailSkeleton />;
  if (!lead) {
    if (error?.status === 403) return <DetailState title="Access denied" message="This lead is outside your authorized bank or branch scope." requestId={error.requestId} onRetry={() => loadLead()} tone="amber" />;
    if (error?.status === 404) return <DetailState title="Lead not found" message="This lead may have been removed or the link is no longer valid." requestId={error.requestId} onRetry={() => loadLead()} />;
    return <DetailState title="Documents could not be loaded" message={error?.message || "Unexpected server error while loading this lead."} requestId={error?.requestId} onRetry={() => loadLead()} tone="red" />;
  }

  const documents = [...(lead.documents || [])];
  const rows = customerDocumentTypes.map((type) => {
    const doc = documents.find((item) => String(item.type || item.documentType || "").toLowerCase() === type.toLowerCase());
    const url = doc?.url || doc?.fileUrl || doc?.downloadUrl;
    return {
      key: type,
      cells: [
        type,
        url ? <a key="preview" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Preview</a> : "Not uploaded",
        dateTime(doc?.createdAt || doc?.uploadedAt),
        url ? <a key="download" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Download</a> : "-",
      ],
    };
  });

  return (
    <section className="space-y-4">
      <PageTitle title="Customer Documents" />
      <div className="grid gap-3 md:grid-cols-4">
        {[["Case ID", caseId(lead)], ["Customer", lead.fullName || lead.customerName], ["Mobile", lead.mobile], ["Current Status", leadStatusLabel(lead)]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-1 font-medium text-slate-900">{display(value)}</p></div>)}
      </div>
      <Table title="Customer Uploaded Documents" headers={["Document", "Preview", "Uploaded Timestamp", "Download"]} rows={rows} loading={false} />
    </section>
  );
}
