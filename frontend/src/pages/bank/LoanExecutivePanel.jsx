import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, UploadCloud, X } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { PendingDocumentsPanel } from "../../components/PendingDocumentsPanel.jsx";
import { StatusBadge } from "../../components/StatusBadge.jsx";
import { DetailPageSkeleton } from "../../components/ui/Loading.jsx";
import { BANK_STATUS_OPTIONS, LEAD_STATUSES, normalizeStatus, statusLabel as leadStatusLabel } from "../../constants/status.js";
import { useDebouncedValue } from "../../hooks/useDebouncedValue.js";
import { mutationUrlMatches, useLeadDetailRealtime, useRoleLeadRealtime } from "../../hooks/useRealtimeRefresh.js";
import { useRealtimeLeadDetailPatch, useRealtimeLeadPatch } from "../../hooks/useRealtimeEntityPatch.js";
import { useCursorPager } from "../../hooks/useCursorPager.js";
import { api, findCachedGetItem, getCachedGetData } from "../../services/api.js";
import { usePageLatency } from "../../services/frontendLatency.js";
import { formatPortalDateTime, loanExecutiveRemark, portalLeadStatusLabel } from "../../utils/portalDisplay.js";

const pageSize = 10;
const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const leadMutationFilter = (detail) => mutationUrlMatches(detail, ["/bank/leads", "/documents"]);
const docs = ["Aadhaar", "PAN", "Salary Slip", "ITR", "Bank Statement", "Electricity Bill", "Rent Agreement", "Form 16"];
const otherDocumentLabel = "Other";
const statusOptions = [
  LEAD_STATUSES.CONTACTED,
  LEAD_STATUSES.DOCUMENT_RECEIVED,
  LEAD_STATUSES.UNDER_BANK_PROCESS,
  LEAD_STATUSES.DISBURSED,
  LEAD_STATUSES.REJECTED,
  LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS,
].map((value) => ({ label: leadStatusLabel(value), value }));
const statusFilters = BANK_STATUS_OPTIONS.map((value) => ({ label: leadStatusLabel(value), value }));

function display(value) {
  return value || "-";
}

function caseId(lead) {
  return lead.caseId || lead.id;
}

function moneyValue(value) {
  return `Rs. ${money.format(Number(value || 0))}`;
}

function dateTime(value) {
  return formatPortalDateTime(value);
}

function generatedAt(lead) {
  return dateTime(lead.generatedAt || lead.createdAt);
}

function executiveStatusLabel(lead) {
  return portalLeadStatusLabel(lead);
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

function Table({ title, headers, rows, loading, page, total, hasMore, onPage }) {
  return <OperationalTable title={title} headers={headers} rows={rows} loading={loading} page={page} total={total} hasMore={hasMore} onPage={onPage} pageSize={pageSize} />;
}

function useExecutiveLeads({ search, status }) {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") || 1);
  const cached = getCachedGetData("/bank/leads", { page, limit: pageSize, search, status: status ? apiStatus(status) : "" });
  const cachedRows = responseRows({ data: cached });
  const [rows, setRows] = useState(() => cachedRows);
  const [total, setTotal] = useState(() => cached?.total || cachedRows.length);
  const [hasMore, setHasMore] = useState(() => Boolean(cached?.hasMore || cached?.nextCursor));
  const [loading, setLoading] = useState(() => !cached);
  const { cursorParamsForPage, rememberNextCursor } = useCursorPager([search || "", status || ""]);
  const load = useCallback(async (nextPage = page, options = {}) => {
    if (!options.silent) setLoading(true);
    try {
      const targetPage = Math.max(Number(nextPage || 1), 1);
      const response = await api.get("/bank/leads", { params: { page: targetPage, limit: pageSize, search, status: status ? apiStatus(status) : "", ...cursorParamsForPage(targetPage) } });
      const nextRows = responseRows(response);
      setRows(nextRows);
      setHasMore(Boolean(response.data?.hasMore || response.data?.nextCursor));
      rememberNextCursor(targetPage, response.data?.nextCursor);
      setTotal(Number.isFinite(Number(response.data?.total)) ? Number(response.data.total) : (targetPage - 1) * pageSize + nextRows.length + (response.data?.hasMore || response.data?.nextCursor ? 1 : 0));
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [page, search, status, cursorParamsForPage, rememberNextCursor]);
  useEffect(() => { load(page, { silent: Boolean(cached) }); }, [load, page]);
  const realtimeRefresh = useCallback(() => load(page, { silent: true }), [load, page]);
  useRealtimeLeadPatch({ setRows, statusFilter: status ? apiStatus(status) : "" });
  useRoleLeadRealtime({ onRefresh: realtimeRefresh, pageSize, mutationFilter: leadMutationFilter });
  const onPage = (nextPage) => setParams((current) => ({ ...Object.fromEntries(current.entries()), page: String(nextPage) }));
  return { rows, total, hasMore, loading, page, onPage, load };
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
  return <Modal title="Loan Rejected" onClose={onClose}><textarea className="min-h-28 w-full rounded-md border border-slate-200 p-3 text-sm outline-none focus:border-[#0d47a1]" placeholder="Rejection reason" value={reason} onChange={(event) => setReason(event.target.value)} /><button disabled={busy || !reason.trim()} onClick={submit} className="mt-3 rounded-md bg-[#0d47a1] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Save Rejection</button></Modal>;
}

function PendingDocsModal({ lead, status = LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, onClose, onSaved }) {
  const [selected, setSelected] = useState([]);
  const [notes, setNotes] = useState("");
  const [otherDocument, setOtherDocument] = useState("");
  const [busy, setBusy] = useState(false);
  const toggle = (doc) => setSelected((current) => current.includes(doc) ? current.filter((item) => item !== doc) : [...current, doc]);
  const otherSelected = selected.includes(otherDocumentLabel);
  const requestedDocuments = [
    ...selected.filter((item) => item !== otherDocumentLabel),
    ...(otherSelected && otherDocument.trim() ? [`Other: ${otherDocument.trim()}`] : []),
  ];
  const submit = async () => {
    if (!requestedDocuments.length) return;
    setBusy(true);
    try {
      await api.patch(`/bank/leads/${lead.id}/status`, { status, pendingDocumentsRequested: requestedDocuments, pendingDocumentReason: notes, remarks: notes });
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Pending Documents" onClose={onClose}>
      <div className="grid gap-2 sm:grid-cols-2">
        {[...docs, otherDocumentLabel].map((doc) => (
          <label key={doc} className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-slate-700 ${selected.includes(doc) ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}>
            <input type="checkbox" checked={selected.includes(doc)} onChange={() => toggle(doc)} />
            <span className="font-medium">{doc}</span>
          </label>
        ))}
      </div>
      {otherSelected ? (
        <input
          className="mt-3 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-[#0d47a1]"
          placeholder="Enter other document name"
          value={otherDocument}
          onChange={(event) => setOtherDocument(event.target.value)}
        />
      ) : null}
      <textarea className="mt-3 min-h-24 w-full rounded-md border border-slate-200 p-3 text-sm outline-none focus:border-[#0d47a1]" placeholder="Additional Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
      <button disabled={busy || !requestedDocuments.length || (otherSelected && !otherDocument.trim())} onClick={submit} className="mt-3 rounded-md bg-[#0d47a1] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Submit Request</button>
    </Modal>
  );
}

function StatusUpdateModal({ lead, onClose, onSaved }) {
  const [status, setStatus] = useState(LEAD_STATUSES.CONTACTED);
  const [remarks, setRemarks] = useState("");
  const [sanctionFile, setSanctionFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!status) return;
    setBusy(true);
    try {
      await api.patch(`/bank/leads/${lead.id}/status`, { status, remarks, rejectionReason: status === LEAD_STATUSES.REJECTED ? remarks : undefined });
      if (status === LEAD_STATUSES.DISBURSED && sanctionFile) {
        const form = new FormData();
        form.append("document", sanctionFile);
        form.append("documentType", "sanction-letter");
        await api.post(`/bank/leads/${lead.id}/documents`, form, { headers: { "Content-Type": "multipart/form-data" } });
      }
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Update Lead Status" onClose={onClose}>
      <label className="text-sm font-medium text-slate-700">
        Status
        <select className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-[#0d47a1]" value={status} onChange={(event) => setStatus(event.target.value)}>
          {statusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label className="mt-3 block text-sm font-medium text-slate-700">
        Remark
        <textarea className="mt-2 min-h-24 w-full rounded-md border border-slate-200 p-3 text-sm outline-none focus:border-[#0d47a1]" placeholder={status === LEAD_STATUSES.REJECTED ? "Rejection reason" : "Executive remark"} value={remarks} onChange={(event) => setRemarks(event.target.value)} />
      </label>
      {status === LEAD_STATUSES.DISBURSED ? (
        <label className="mt-3 block text-sm font-medium text-slate-700">
          Sanction Letter
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => setSanctionFile(event.target.files?.[0] || null)} className="mt-2 block w-full rounded-md border border-slate-200 text-sm text-slate-600 file:mr-3 file:h-10 file:border-0 file:bg-slate-50 file:px-3 file:text-sm file:font-medium file:text-slate-700" />
        </label>
      ) : null}
      <button disabled={busy || (status === LEAD_STATUSES.REJECTED && !remarks.trim())} onClick={submit} className="mt-4 rounded-md bg-[#0d47a1] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {busy ? "Saving..." : "Save Status"}
      </button>
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
  const debouncedSearch = useDebouncedValue(search, 180);
  const [modal, setModal] = useState(null);
  const [statusError, setStatusError] = useState("");
  const requestedStatus = mode === "status" ? params.get("status") || BANK_STATUS_OPTIONS[0] : "";
  const status = mode === "status" && BANK_STATUS_OPTIONS.includes(normalizeStatus(requestedStatus))
    ? normalizeStatus(requestedStatus)
    : mode === "status" ? BANK_STATUS_OPTIONS[0] : "";
  const { rows, total, hasMore, loading, page, onPage, load } = useExecutiveLeads({ search: debouncedSearch, status });

  const updateStatus = async (lead, nextStatus) => {
    setStatusError("");
    if (nextStatus === "REJECTED_REASON") return setModal({ type: "reject", lead });
    if ([LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING].includes(nextStatus)) return setModal({ type: "docs", lead, status: nextStatus });
    if (nextStatus === "STATUS_UPDATE") return setModal({ type: "status", lead });
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
        <StatusBadge key="status" lead={lead} />,
        display(lead.financeManagerName || lead.assignedFinanceManager),
        display(lead.financeManagerMobile),
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
        generatedAt(lead),
        display(lead.financeManagerName || lead.assignedFinanceManager),
        display(lead.financeManagerMobile),
        executiveStatusLabel(lead),
        <button key="status-action" onClick={() => updateStatus(lead, "STATUS_UPDATE")} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">Update</button>,
        <button key="pending" onClick={() => setModal({ type: "docs", lead, status: LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS })} className="inline-flex h-8 items-center justify-center rounded-md border border-amber-200 bg-white px-3 text-xs font-semibold text-amber-700 hover:bg-amber-50">Request Docs</button>,
        <button key="docs" onClick={() => navigate(`/loan-executive/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View Documents</button>,
      ],
  }));

  const statusHeaders = status === "REJECTED_REASON"
    ? ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Loan Amount", "Current Status", "Finance Manager", "Finance Manager Mobile", "Last Updated", "Rejection Reason", "Rejection Timestamp", "Executive Name", "Documents"]
    : ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Loan Amount", "Current Status", "Finance Manager", "Finance Manager Mobile", "Last Updated", "Documents"];

  return (
    <section className="space-y-4">
      <PageTitle title={mode === "status" ? "Status" : "Total Leads"} />
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="h-9 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-[#0d47a1]" placeholder="Search cases" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
      </div>
      {mode === "status" ? <div className="flex flex-wrap gap-2">{statusFilters.map((item) => <button key={item.value} onClick={() => setParams({ status: item.value, page: "1" })} className={`rounded-md border px-3 py-2 text-sm font-medium ${status === item.value ? "border-[#0d47a1] bg-[#0d47a1] text-white" : "border-slate-200 bg-white text-slate-700"}`}>{item.label}</button>)}</div> : null}
      {statusError ? <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{statusError}</div> : null}
      <Table title={mode === "status" ? "Filtered Cases" : "Assigned Leads"} headers={mode === "status" ? statusHeaders : ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Car On-Road Price", "Required Loan Amount", "Case Generated", "Finance Manager", "Finance Manager Mobile", "Current Status", "Update Status", "Document Request", "Documents"]} rows={tableRows} loading={loading} page={page} total={total} hasMore={hasMore} onPage={onPage} />
      {modal?.type === "reject" ? <RejectModal lead={modal.lead} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(page); }} /> : null}
      {modal?.type === "docs" ? <PendingDocsModal lead={modal.lead} status={modal.status} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(page); }} /> : null}
      {modal?.type === "status" ? <StatusUpdateModal lead={modal.lead} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(page); }} /> : null}
    </section>
  );
}

export function LoanExecutivePanel({ mode = "leads" }) {
  usePageLatency("LoanExecutive", { mode });
  return <TotalLeadsPage mode={mode} />;
}

export function LoanExecutiveLeadDetailPage() {
  const { leadId } = useParams();
  const cachedLead = getCachedGetData(`/bank/leads/${leadId}`)
    || findCachedGetItem("/bank/leads", (item) => item.id === leadId || item.caseId === leadId);
  const [lead, setLead] = useState(() => cachedLead);
  const [loading, setLoading] = useState(() => !cachedLead);
  const [sanctionFile, setSanctionFile] = useState(null);
  const [uploadingSanction, setUploadingSanction] = useState(false);
  const [message, setMessage] = useState("");

  const loadLead = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get(`/bank/leads/${leadId}`);
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
      <div className="grid gap-3 md:grid-cols-4">{[["Case ID", caseId(lead)], ["Customer", lead.fullName || lead.customerName], ["Mobile", lead.mobile], ["Finance Manager", lead.financeManagerName || lead.assignedFinanceManager], ["Finance Manager Mobile", lead.financeManagerMobile], ["Current Status", executiveStatusLabel(lead)]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-1 font-medium text-slate-900">{display(value)}</p></div>)}</div>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">Loan Executive Remark</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{loanExecutiveRemark(lead)}</p>
      </section>
      <PendingDocumentsPanel lead={lead} />
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
