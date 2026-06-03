import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, UploadCloud, X } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { StatusBadge } from "../../components/StatusBadge.jsx";
import { DetailPageSkeleton } from "../../components/ui/Loading.jsx";
import { BANK_STATUS_OPTIONS, LEAD_STATUSES, normalizeStatus, statusLabel as leadStatusLabel } from "../../constants/status.js";
import { useLeadDetailRealtime, useRoleLeadRealtime } from "../../hooks/useRealtimeRefresh.js";
import { api } from "../../services/api.js";

const pageSize = 10;
const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const docs = ["Aadhaar", "PAN", "Salary Slip", "ITR", "Bank Statement", "Electricity Bill", "Rent Agreement", "Form 16"];
const statusOptions = BANK_STATUS_OPTIONS.map((value) => ({ label: leadStatusLabel(value), value }));

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

function executiveStatusLabel(lead) {
  const status = workflowStatus(lead.status || lead.assignmentStatus || LEAD_STATUSES.NEW);
  if (status === LEAD_STATUSES.REJECTED) return lead.rejectionReason || lead.loanRejectionReason ? `Loan Rejected: ${lead.rejectionReason || lead.loanRejectionReason}` : "Rejected";
  return leadStatusLabel(status);
}

function apiStatus(value) {
  return value === "REJECTED_REASON" ? LEAD_STATUSES.REJECTED : value;
}

function workflowStatus(value) {
  const normalized = normalizeStatus(value);
  if (normalized === LEAD_STATUSES.ASSIGNED) return LEAD_STATUSES.NEW;
  if ([LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW, LEAD_STATUSES.APPROVED].includes(normalized)) return LEAD_STATUSES.UNDER_BANK_PROCESS;
  if (normalized === LEAD_STATUSES.DOCS_PENDING) return LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS;
  return normalized;
}

function responseRows(response) {
  return Array.isArray(response?.data?.data) ? response.data.data : Array.isArray(response?.data) ? response.data : [];
}

function PageTitle({ title }) {
  return <div><p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Loan Executive</p><h1 className="mt-1 text-xl font-semibold text-slate-900">{title}</h1></div>;
}

function Table({ title, headers, rows, loading, page, total, onPage }) {
  return <OperationalTable title={title} headers={headers} rows={rows} loading={loading} page={page} total={total} onPage={onPage} pageSize={pageSize} />;
}

function useExecutiveLeads({ search, status }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") || 1);
  const load = useCallback(async (nextPage = page, options = {}) => {
    if (!options.silent) setLoading(true);
    try {
      const response = await api.get("/bank/leads", { params: { page: nextPage, limit: pageSize, search, status: status ? apiStatus(status) : "" } });
      setRows(responseRows(response));
      setTotal(response.data?.total || responseRows(response).length);
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [page, search, status]);
  useEffect(() => { load(page); }, [load, page]);
  const realtimeRefresh = useCallback(() => load(page, { silent: true }), [load, page]);
  useRoleLeadRealtime({ onRefresh: realtimeRefresh, pageSize });
  const onPage = (nextPage) => setParams((current) => ({ ...Object.fromEntries(current.entries()), page: String(nextPage) }));
  return { rows, total, loading, page, onPage, load };
}

function RejectModal({ lead, onClose, onSaved }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    await api.patch(`/bank/leads/${lead.id}/status`, { status: LEAD_STATUSES.REJECTED, rejectionReason: reason, remarks: reason });
    setBusy(false);
    onSaved();
  };
  return <Modal title="Loan Rejected With Reason" onClose={onClose}><textarea className="min-h-28 w-full rounded-md border border-slate-200 p-3 text-sm outline-none focus:border-[#0d47a1]" placeholder="Rejection reason" value={reason} onChange={(event) => setReason(event.target.value)} /><button disabled={busy || !reason.trim()} onClick={submit} className="mt-3 rounded-md bg-[#0d47a1] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Save Rejection</button></Modal>;
}

function PendingDocsModal({ lead, status = LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, onClose, onSaved }) {
  const [selected, setSelected] = useState([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (doc) => setSelected((current) => current.includes(doc) ? current.filter((item) => item !== doc) : [...current, doc]);
  const submit = async () => {
    if (!selected.length) return;
    setBusy(true);
    try {
      await api.patch(`/bank/leads/${lead.id}/status`, { status, pendingDocumentsRequested: selected, pendingDocumentReason: notes, remarks: notes });
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={status === LEAD_STATUSES.REQUEST_DOCUMENT ? "Request Documents" : "Request Pending Documents"} onClose={onClose}>
      <div className="grid gap-2 sm:grid-cols-2">{docs.map((doc) => <label key={doc} className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700"><input type="checkbox" checked={selected.includes(doc)} onChange={() => toggle(doc)} />{doc}</label>)}</div>
      <textarea className="mt-3 min-h-24 w-full rounded-md border border-slate-200 p-3 text-sm outline-none focus:border-[#0d47a1]" placeholder="Additional Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
      <button disabled={busy || !selected.length} onClick={submit} className="mt-3 rounded-md bg-[#0d47a1] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Submit Request</button>
    </Modal>
  );
}

function Modal({ title, children, onClose }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"><section className="w-full max-w-xl rounded-lg bg-white p-5 shadow-lg"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold text-slate-900">{title}</h2><button onClick={onClose}><X className="h-5 w-5" /></button></div><div className="mt-4">{children}</div></section></div>;
}

function TotalLeadsPage({ mode }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") || "");
  const [modal, setModal] = useState(null);
  const [statusError, setStatusError] = useState("");
  const status = mode === "status" ? params.get("status") || LEAD_STATUSES.NEW : "";
  const { rows, total, loading, page, onPage, load } = useExecutiveLeads({ search, status });

  const updateStatus = async (lead, nextStatus) => {
    setStatusError("");
    if (nextStatus === "REJECTED_REASON") return setModal({ type: "reject", lead });
    if ([LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING].includes(nextStatus)) return setModal({ type: "docs", lead, status: nextStatus });
    try {
      await api.patch(`/bank/leads/${lead.id}/status`, { status: nextStatus });
      load(page);
    } catch (error) {
      setStatusError(error.response?.data?.message || error.message || "Status update failed. Please retry.");
    }
  };

  const tableRows = rows.map((lead) => ({
    key: lead.id,
    cells: mode === "status"
      ? [
        caseId(lead),
        display(lead.fullName || lead.customerName),
        display(lead.mobile),
        display(lead.city || lead.dealershipCity),
        moneyValue(lead.loanAmount || lead.requiredLoanAmount),
        <StatusBadge key="status" status={workflowStatus(lead.status)} />,
        dateTime(lead.updatedAt || lead.statusUpdatedAt || lead.createdAt),
        ...(status === "REJECTED_REASON" ? [display(lead.rejectionReason || lead.loanRejectionReason), dateTime(lead.rejectedAt || lead.updatedAt), display(lead.updatedByExecutiveName || lead.rejectedBy)] : []),
        <button key="docs" onClick={() => navigate(`/loan-executive/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">Documents</button>,
      ]
      : [
        caseId(lead),
        display(lead.fullName || lead.customerName),
        display(lead.mobile),
        display(lead.city || lead.dealershipCity),
        moneyValue(lead.onRoadPrice || lead.carOnRoadPrice),
        moneyValue(lead.loanAmount || lead.requiredLoanAmount),
        dateValue(lead.createdAt),
        timeValue(lead.createdAt),
        <select key="status" className="h-9 rounded-md border border-slate-200 px-2 text-xs outline-none focus:border-[#0d47a1]" value={workflowStatus(lead.status)} onChange={(event) => updateStatus(lead, event.target.value)}>{statusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>,
        <button key="pending" onClick={() => setModal({ type: "docs", lead, status: LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS })} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700">Request Pending Docs</button>,
        <button key="docs" onClick={() => navigate(`/loan-executive/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View Documents</button>,
      ],
  }));

  const statusHeaders = status === "REJECTED_REASON"
    ? ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Loan Amount", "Current Status", "Last Updated", "Rejection Reason", "Rejection Timestamp", "Executive Name", "Documents"]
    : ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Loan Amount", "Current Status", "Last Updated", "Documents"];

  return (
    <section className="space-y-4">
      <PageTitle title={mode === "status" ? "Status" : "Total Leads"} />
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="h-9 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-[#0d47a1]" placeholder="Search cases" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
      </div>
      {mode === "status" ? <div className="flex flex-wrap gap-2">{statusOptions.map((item) => <button key={item.value} onClick={() => setParams({ status: item.value, page: "1" })} className={`rounded-md border px-3 py-2 text-sm font-medium ${status === item.value ? "border-[#0d47a1] bg-[#0d47a1] text-white" : "border-slate-200 bg-white text-slate-700"}`}>{item.label}</button>)}</div> : null}
      {statusError ? <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{statusError}</div> : null}
      <Table title={mode === "status" ? "Filtered Cases" : "Assigned Leads"} headers={mode === "status" ? statusHeaders : ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Car On-Road Price", "Required Loan Amount", "Case Generated Date", "Case Generated Time", "Current Lead Status", "Request Document", "Documents"]} rows={tableRows} loading={loading} page={page} total={total} onPage={onPage} />
      {modal?.type === "reject" ? <RejectModal lead={modal.lead} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(page); }} /> : null}
      {modal?.type === "docs" ? <PendingDocsModal lead={modal.lead} status={modal.status} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(page); }} /> : null}
    </section>
  );
}

export function LoanExecutivePanel({ mode = "leads" }) {
  return <TotalLeadsPage mode={mode} />;
}

export function LoanExecutiveLeadDetailPage() {
  const { leadId } = useParams();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sanctionFile, setSanctionFile] = useState(null);
  const [uploadingSanction, setUploadingSanction] = useState(false);
  const [message, setMessage] = useState("");

  const loadLead = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get(`/bank/leads/${leadId}`);
      setLead(response.data);
    } catch {
      setLead(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    loadLead();
  }, [loadLead]);
  useLeadDetailRealtime({ lead, leadId, onRefresh: loadLead });

  if (loading) return <DetailPageSkeleton />;
  if (!lead) return <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Lead not found.</section>;
  const documents = lead.documents || [];
  const bankDocuments = lead.bankDocuments || [];
  const sanctionDocument = bankDocuments.find((item) => String(item.documentType || item.type || "").toLowerCase().includes("sanction"));
  const sanctionUrl = sanctionDocument?.url || sanctionDocument?.fileUrl || lead.sanctionLetterUrl;
  const canShowSanction = normalizeStatus(lead.status) === LEAD_STATUSES.DISBURSED;
  const uploadSanction = async () => {
    if (!sanctionFile) return;
    setUploadingSanction(true);
    setMessage("");
    try {
      const form = new FormData();
      form.append("document", sanctionFile);
      form.append("documentType", "sanction-letter");
      await api.post(`/bank/leads/${lead.id}/documents`, form, { headers: { "Content-Type": "multipart/form-data" } });
      setSanctionFile(null);
      setMessage("Sanction letter uploaded.");
      await loadLead({ silent: true });
    } catch {
      setMessage("Sanction letter upload failed. Please retry.");
    } finally {
      setUploadingSanction(false);
    }
  };
  const rows = docs.map((type) => {
    const doc = documents.find((item) => String(item.type || item.documentType || "").toLowerCase() === type.toLowerCase());
    const url = doc?.url || doc?.fileUrl || doc?.downloadUrl;
    return { key: type, cells: [type, url ? <a key="preview" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Preview</a> : "Not uploaded", url ? <a key="zoom" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Zoom</a> : "-", url ? <a key="download" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Download</a> : "-", dateTime(doc?.createdAt || doc?.uploadedAt)] };
  });
  return (
    <section className="space-y-4">
      <PageTitle title="Customer Documents" />
      <div className="grid gap-3 md:grid-cols-4">{[["Case ID", caseId(lead)], ["Customer", lead.fullName || lead.customerName], ["Mobile", lead.mobile], ["Current Status", executiveStatusLabel(lead)]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-1 font-medium text-slate-900">{display(value)}</p></div>)}</div>
      <Table title="Customer Uploaded Documents" headers={["Document", "Preview", "Zoom", "Download", "Uploaded Timestamp"]} rows={rows} loading={false} />
      {canShowSanction ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Sanction Letter</h2>
              <p className="mt-1 text-sm text-slate-500">Upload the final bank sanction or disbursement letter for this case.</p>
            </div>
            {sanctionUrl ? (
              <div className="flex flex-wrap gap-2">
                <a href={sanctionUrl} target="_blank" rel="noreferrer" className="rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700">View Sanction Letter</a>
                <a href={sanctionUrl} download className="rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700">Download</a>
              </div>
            ) : null}
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => setSanctionFile(event.target.files?.[0] || null)} className="block w-full rounded-md border border-slate-200 text-sm text-slate-600 file:mr-3 file:h-10 file:border-0 file:bg-slate-50 file:px-3 file:text-sm file:font-medium file:text-slate-700 sm:max-w-md" />
            <button onClick={uploadSanction} disabled={!sanctionFile || uploadingSanction} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#0d47a1] px-4 text-sm font-medium text-white disabled:opacity-50">
              <UploadCloud className="h-4 w-4" />
              {sanctionUrl ? "Replace File" : "Upload Sanction Letter"}
            </button>
          </div>
          {message ? <p className="mt-3 text-sm text-slate-600">{message}</p> : null}
          {sanctionDocument?.uploadedAt || lead.sanctionLetterUploadedAt ? <p className="mt-2 text-xs text-slate-500">Uploaded: {dateTime(sanctionDocument?.uploadedAt || lead.sanctionLetterUploadedAt)} by {display(sanctionDocument?.uploadedBy || lead.sanctionLetterUploadedBy)}</p> : null}
        </section>
      ) : null}
    </section>
  );
}
