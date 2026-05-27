import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Search, UploadCloud, X } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { LEAD_STATUSES, normalizeStatus } from "../../constants/status.js";
import { api } from "../../services/api.js";

const pageSize = 10;
const documentTypes = ["Aadhaar", "PAN", "Salary Slip", "ITR", "Bank Statement", "Electricity Bill", "Rent Agreement", "Form 16"];
const statusTabs = [
  { label: "Disbursed", value: "Disbursed" },
  { label: "Rejected With Reason", value: "Rejected" },
  { label: "Pending Documents", value: "Pending Documents" },
  { label: "Bank Process", value: "Bank Processing" },
];

const emptyLead = {
  fullName: "",
  mobile: "",
  city: "",
  preferredBank: "",
  carPrice: "",
  loanAmount: "",
  salespersonId: "",
};

const emptySalesperson = { name: "", mobile: "", jobId: "", email: "" };
const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

function display(value) {
  return value || "-";
}

function moneyValue(value) {
  return `Rs. ${money.format(Number(value || 0))}`;
}

function dateValue(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function dateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function caseId(lead) {
  return lead.caseId || lead.id;
}

function financeStatus(lead) {
  const status = normalizeStatus(lead?.status);
  if (status === LEAD_STATUSES.DISBURSED) return "Disbursed";
  if (status === LEAD_STATUSES.REJECTED) return lead?.rejectionReason ? "Rejected With Reason" : "Rejected";
  if (status === LEAD_STATUSES.DOCS_PENDING) return "Pending Documents";
  return "Bank Process";
}

function StatusBadge({ lead }) {
  const label = financeStatus(lead);
  const tone = {
    Disbursed: "bg-slate-800 text-white",
    "Rejected With Reason": "bg-rose-50 text-rose-700",
    Rejected: "bg-rose-50 text-rose-700",
    "Pending Documents": "bg-amber-50 text-amber-700",
    "Bank Process": "bg-blue-50 text-[#0d47a1]",
  }[label] || "bg-slate-100 text-slate-700";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>{label}</span>;
}

function Table({ headers, rows, loading, page, total, onPage }) {
  return <OperationalTable headers={headers} rows={rows} loading={loading} page={page} total={total} onPage={onPage} pageSize={pageSize} />;
}

function useSalespersons({ includeInactive = false } = {}) {
  const [salespersons, setSalespersons] = useState([]);
  const [loading, setLoading] = useState(true);
  const loadSalespersons = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/dealer/salespersons", { params: { includeInactive } });
      setSalespersons(response.data || []);
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);
  useEffect(() => { loadSalespersons(); }, [loadSalespersons]);
  return { salespersons, loading, loadSalespersons };
}

function useDealerLeads(filters = {}) {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const loadLeads = useCallback(async (next = {}) => {
    setLoading(true);
    try {
      const response = await api.get("/dealer/leads", { params: { page: 1, limit: pageSize, ...filters, ...next } });
      const payload = Array.isArray(response.data) ? { data: response.data, total: response.data.length } : response.data;
      setLeads(payload.data || []);
      setTotal(payload.total || 0);
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.salespersonId, filters.search]);

  useEffect(() => {
    loadLeads();
    const interval = window.setInterval(() => loadLeads(), 8000);
    const onFocus = () => loadLeads();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadLeads]);
  return { leads, total, loading, loadLeads };
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
        display(lead.preferredBank || lead.bankPartner),
        moneyValue(lead.loanAmount || lead.requiredLoanAmount),
        <StatusBadge key="status" lead={lead} />,
        dateTime(lead.statusUpdatedAt || lead.updatedAt || lead.createdAt),
      ];
      if (normalizeStatus(lead.status) === LEAD_STATUSES.REJECTED) {
        cells.splice(6, 0, display(lead.rejectionReason), display(lead.updatedByExecutiveName || lead.rejectedBy || lead.assignedExecutiveName));
      }
      cells.push(<DocumentsButton key="docs" lead={lead} />);
      return { key: lead.id, cells };
    }
    if (mode === "cases") {
      return {
        key: lead.id,
        cells: [
          ...base,
          display(lead.preferredBank),
          moneyValue(lead.carPrice || lead.carOnRoadPrice),
          moneyValue(lead.loanAmount || lead.requiredLoanAmount),
          display(lead.bankPartner || lead.assignedBankName),
          display(lead.assignedExecutiveName),
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
        display(lead.preferredBank || lead.bankPartner),
        moneyValue(lead.loanAmount || lead.requiredLoanAmount),
        dateValue(lead.generatedAt || lead.createdAt),
        <StatusBadge key="status" lead={lead} />,
        display(lead.assignedExecutiveName),
        <DocumentsButton key="docs" lead={lead} />,
      ],
    };
  });
}

export function FinanceDeskPanel({ mode = "total" }) {
  if (mode === "add") return <AddLeadScreen />;
  if (mode === "salespersons") return <SalespersonManagementScreen />;
  if (mode === "active-salespersons") return <ActiveSalespersonsScreen />;
  if (mode === "cases") return <AllCasesScreen />;
  if (mode === "status") return <StatusScreen />;
  return <TotalLeadsScreen />;
}

function TotalLeadsScreen() {
  const [page, setPage] = useState(1);
  const { leads, total, loading, loadLeads } = useDealerLeads();
  const pageTo = (nextPage) => {
    setPage(nextPage);
    loadLeads({ page: nextPage });
  };
  return (
    <div className="space-y-4">
      <SectionTitle title="Total Leads" subtitle="All cases submitted by this dealership finance desk." />
      <Table headers={["Case ID", "Customer Name", "Mobile Number", "Customer City", "Preferred Bank", "Loan Amount", "Generated Date", "Current Status", "Assigned Executive", "Documents"]} rows={leadRows(leads)} loading={loading} page={page} total={total} onPage={pageTo} />
    </div>
  );
}

function AddLeadScreen() {
  const navigate = useNavigate();
  const { salespersons } = useSalespersons();
  const [banks, setBanks] = useState([]);
  const [form, setForm] = useState(emptyLead);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get("/banks").then((response) => setBanks(response.data || [])).catch(() => setBanks([]));
  }, []);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setMessage("");
  };
  const validate = () => {
    if (!form.fullName.trim()) return "Customer Name is required";
    if (!/^[6-9]\d{9}$/.test(form.mobile)) return "Enter a valid 10-digit mobile number";
    if (!form.city.trim()) return "Customer City is required";
    if (!form.preferredBank) return "Preferred Bank is required";
    if (!Number(form.carPrice)) return "Car On-Road Price is required";
    if (!Number(form.loanAmount)) return "Required Loan Amount is required";
    if (Number(form.loanAmount) > Number(form.carPrice)) return "Required Loan Amount cannot exceed Car On-Road Price";
    if (!form.salespersonId) return "Select Salesperson is required";
    return "";
  };
  const submit = async (event) => {
    event.preventDefault();
    const error = validate();
    if (error) return setMessage(error);
    setSubmitting(true);
    try {
      const response = await api.post("/dealer/leads", {
        ...form,
        carPrice: Number(form.carPrice),
        loanAmount: Number(form.loanAmount),
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
      <SectionTitle title="Add Lead" subtitle="Create a dealership case and trigger the bank assignment workflow." />
      <form onSubmit={submit} className="card p-5">
        {message ? <p className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</p> : null}
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Customer Name"><input className="field mt-1.5" value={form.fullName} onChange={(e) => update("fullName", e.target.value)} /></Field>
          <Field label="Mobile Number"><input className="field mt-1.5" inputMode="numeric" maxLength="10" value={form.mobile} onChange={(e) => update("mobile", e.target.value.replace(/\D/g, "").slice(0, 10))} /></Field>
          <Field label="Customer City"><input className="field mt-1.5" value={form.city} onChange={(e) => update("city", e.target.value)} /></Field>
          <Field label="Preferred Bank"><select className="field mt-1.5" value={form.preferredBank} onChange={(e) => update("preferredBank", e.target.value)}><option value="">Select bank</option>{banks.map((bank) => <option key={bank.name}>{bank.name}</option>)}</select></Field>
          <Field label="Car On-Road Price"><input className="field mt-1.5" type="number" value={form.carPrice} onChange={(e) => update("carPrice", e.target.value)} /></Field>
          <Field label="Required Loan Amount"><input className="field mt-1.5" type="number" value={form.loanAmount} onChange={(e) => update("loanAmount", e.target.value)} /></Field>
          <Field label="Select Salesperson"><select className="field mt-1.5" value={form.salespersonId} onChange={(e) => update("salespersonId", e.target.value)}><option value="">Select salesperson</option>{salespersons.map((person) => <option key={person.id} value={person.id}>{person.name} - {person.jobId}</option>)}</select></Field>
          <div className="flex items-end">
            <button disabled={submitting} className="h-10 rounded-md bg-[#0d47a1] px-5 text-sm font-medium text-white disabled:opacity-60">{submitting ? "Creating..." : "Submit Lead"}</button>
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
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const add = async (event) => {
    event.preventDefault();
    setMessage("");
    setSaving(true);
    try {
      await api.post("/dealer/salespersons", form);
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
          <Field label="Salesperson Name"><input className="field mt-1.5" value={form.name} onChange={(e) => update("name", e.target.value)} /></Field>
          <Field label="Mobile Number"><input className="field mt-1.5" inputMode="numeric" maxLength="10" value={form.mobile} onChange={(e) => update("mobile", e.target.value.replace(/\D/g, "").slice(0, 10))} /></Field>
          <Field label="Job ID"><input className="field mt-1.5" value={form.jobId} onChange={(e) => update("jobId", e.target.value)} /></Field>
          <Field label="Mail ID"><input className="field mt-1.5" type="email" value={form.email} onChange={(e) => update("email", e.target.value)} /></Field>
          <button disabled={saving} className="h-10 rounded-md bg-[#0d47a1] px-4 text-sm font-medium text-white disabled:opacity-60">{saving ? "Saving..." : "Add Salesperson"}</button>
        </div>
      </form>
      <div className="space-y-4">
        <SectionTitle title="Add / Remove Salesperson" subtitle="Soft remove keeps existing case history intact." />
        <Table headers={["Salesperson Name", "Mobile Number", "Job ID", "Mail ID", "Status", "Action"]} rows={rows} loading={loading} />
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
  const search = params.get("search") || "";
  const { salespersons } = useSalespersons();
  const filters = useMemo(() => ({ salespersonId, search }), [salespersonId, search]);
  const { leads, total, loading, loadLeads } = useDealerLeads(filters);
  const updateFilter = (next) => {
    const merged = { salespersonId, search, page: "1", ...next };
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
      <SectionTitle title="All Cases" subtitle="Main dealership monitoring page with server-side salesperson filtering." />
      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-[1fr_240px]">
        <div className="flex items-center gap-2"><Search className="h-4 w-4 text-slate-400" /><input className="h-9 flex-1 outline-none" placeholder="Search customer or mobile" defaultValue={search} onChange={(e) => updateFilter({ search: e.target.value })} /></div>
        <select className="field" value={salespersonId} onChange={(e) => updateFilter({ salespersonId: e.target.value })}>
          <option value="">Filter By Salesperson</option>
          {salespersons.map((person) => <option key={person.id} value={person.id}>{person.name} - {person.jobId}</option>)}
        </select>
      </div>
      <Table headers={["Case ID", "Customer Name", "Mobile Number", "Customer City", "Preferred Bank", "Car On-Road Price", "Required Loan Amount", "Assigned Bank", "Assigned Executive", "Current Status", "Status Updated Date", "Documents"]} rows={leadRows(leads, "cases")} loading={loading} page={page} total={total} onPage={pageTo} />
    </div>
  );
}

function StatusScreen() {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(Number(params.get("page") || 1));
  const status = params.get("status") || "Bank Processing";
  const { leads, total, loading, loadLeads } = useDealerLeads({ status });
  const choose = (value) => {
    setPage(1);
    setParams({ status: value, page: "1" });
    loadLeads({ status: value, page: 1 });
  };
  const pageTo = (nextPage) => {
    setPage(nextPage);
    loadLeads({ page: nextPage, status });
  };
  const rejected = status === "Rejected";
  return (
    <div className="space-y-4">
      <SectionTitle title="Status" subtitle="Status lists update from Loan Executive changes." />
      <div className="flex flex-wrap gap-2">
        {statusTabs.map((item) => <button key={item.value} onClick={() => choose(item.value)} className={`rounded-md border px-3 py-2 text-sm font-medium ${status === item.value ? "border-[#0d47a1] bg-[#0d47a1] text-white" : "border-slate-200 bg-white text-slate-700"}`}>{item.label}</button>)}
      </div>
      <Table headers={rejected ? ["Case ID", "Customer Name", "Mobile Number", "Preferred Bank", "Loan Amount", "Current Status", "Rejection Reason", "Executive Name", "Last Updated", "Documents"] : ["Case ID", "Customer Name", "Mobile Number", "Preferred Bank", "Loan Amount", "Current Status", "Last Updated", "Documents"]} rows={leadRows(leads, "status")} loading={loading} page={page} total={total} onPage={pageTo} />
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

function Field({ label, children }) {
  return <label className="text-sm font-medium text-slate-700">{label}{children}</label>;
}

export function FinanceLeadDetailPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.get(`/dealer/leads/${leadId}`)
      .then((response) => { if (active) setLead(response.data); })
      .catch(() => { if (active) setLead(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [leadId]);

  if (loading) return <section className="card p-5 text-sm text-slate-500">Loading lead...</section>;
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
          {[["Case ID", caseId(lead)], ["Customer", lead.fullName], ["City", lead.city], ["Preferred Bank", lead.preferredBank], ["Loan Amount", moneyValue(lead.loanAmount)], ["Salesperson", lead.assignedSalesperson], ["Executive", lead.assignedExecutiveName], ["Status", financeStatus(lead)]].map(([label, value]) => (
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

  useEffect(() => { loadDocs(); }, [loadDocs]);
  useEffect(() => {
    let active = true;
    api.get(`/dealer/leads/${leadId}`).then((response) => { if (active) setLead(response.data); }).catch(() => {});
    return () => { active = false; };
  }, [leadId]);

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
  return (
    <section className="space-y-5">
      <div className="card p-5">
        <h2 className="text-lg font-semibold text-slate-900">Customer Documents</h2>
        <p className="mt-1 text-sm text-slate-500">Case ID: {caseId(lead || { id: leadId })}</p>
        {message ? <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-[#0d47a1]">{message}</p> : null}
      </div>
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
    </section>
  );
}
