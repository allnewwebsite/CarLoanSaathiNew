import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { LEAD_STATUSES, normalizeStatus } from "../../constants/status.js";
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
  if (status === LEAD_STATUSES.DISBURSED) return "Disbursed";
  if (status === LEAD_STATUSES.REJECTED) return lead.rejectionReason || lead.loanRejectionReason ? "Loan Rejected With Reason" : "Rejected";
  if (status === LEAD_STATUSES.DOCS_PENDING) return "Pending Documents";
  return "Bank Process";
}

function responseRows(response) {
  return Array.isArray(response?.data?.data) ? response.data.data : Array.isArray(response?.data) ? response.data : [];
}

function Table({ title, headers, rows, loading, page, total, onPage }) {
  return <OperationalTable title={title} headers={headers} rows={rows} loading={loading} page={page} total={total} onPage={onPage} pageSize={pageSize} />;
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

  const load = useCallback(async (nextPage = page) => {
    setLoading(true);
    try {
      const response = await api.get("/bank/leads", { params: { page: nextPage, limit: pageSize, search } });
      setRows(responseRows(response));
      setTotal(response.data?.total || responseRows(response).length);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { load(page); }, [load, page]);
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
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setMessage("");
    setError("");
    setBusy(true);
    try {
      await api.post("/bank/executives", form);
      setForm({ name: "", mobile: "", jobId: "", email: "" });
      setMessage("Executive added successfully.");
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

  const tableRows = rows.map((executive) => ({
    key: executive.id,
    cells: [
      display(executive.name || executive.fullName),
      display(executive.mobile),
      display(executive.email || executive.officialEmail),
      display(executive.jobId),
      display(executive.status),
      <button key="remove" disabled={executive.active === false} onClick={() => remove(executive)} className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50">Remove</button>,
    ],
  }));

  return (
    <section className="space-y-4">
      <PageTitle title="Manage Executive" />
      <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm font-medium text-slate-700">Executive Name<input required className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3 outline-none focus:border-[#0d47a1]" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label className="text-sm font-medium text-slate-700">Mobile Number<input required className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3 outline-none focus:border-[#0d47a1]" value={form.mobile} maxLength={10} onChange={(event) => setForm((current) => ({ ...current, mobile: event.target.value.replace(/\D/g, "") }))} /></label>
          <label className="text-sm font-medium text-slate-700">Job ID<input required className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3 outline-none focus:border-[#0d47a1]" value={form.jobId} onChange={(event) => setForm((current) => ({ ...current, jobId: event.target.value }))} /></label>
          <label className="text-sm font-medium text-slate-700 md:col-span-3">Official Email<input required type="email" className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3 outline-none focus:border-[#0d47a1]" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value.toLowerCase() }))} /></label>
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
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    api.get(`/bank/leads/${leadId}`).then((response) => { if (active) setLead(response.data); }).catch(() => { if (active) setLead(null); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [leadId]);
  if (loading) return <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading documents...</section>;
  if (!lead) return <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Lead not found.</section>;

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
