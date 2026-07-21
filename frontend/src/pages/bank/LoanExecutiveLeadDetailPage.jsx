import { useCallback, useEffect, useState } from "react";
import { UploadCloud } from "lucide-react";
import { useParams } from "react-router-dom";
import { PendingDocumentsPanel } from "../../components/PendingDocumentsPanel.jsx";
import { DetailPageSkeleton } from "../../components/ui/Loading.jsx";
import { LEAD_TABLE_LABELS } from "../../constants/leadTableLabels.js";
import { LEAD_STATUSES, normalizeStatus } from "../../constants/status.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useRealtimeLeadDetailPatch } from "../../hooks/useRealtimeEntityPatch.js";
import { useLeadDetailRealtime } from "../../hooks/useRealtimeRefresh.js";
import { api, findCachedGetItem, getCachedGetData } from "../../services/api.js";
import { loanExecutiveRemark, pendingDocumentItems } from "../../utils/portalDisplay.js";
import { PageTitle, Table } from "./LoanExecutivePanelParts.jsx";
import { caseId, dateTime, display, executiveStatusLabel, leadMutationFilter, loanExecutiveDocs as docs } from "./loanExecutive.helpers.js";

export function LoanExecutiveLeadDetailPage() {
  const { user } = useAuth();
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
  useRealtimeLeadDetailPatch({ leadId, setLead, user });
  useLeadDetailRealtime({ lead, leadId, onRefresh: loadLead, mutationFilter: leadMutationFilter });

  if (loading && !lead) return <DetailPageSkeleton />;
  if (!lead) return <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Lead not found.</section>;
  const documents = lead.documents || [];
  const visibleDocumentTypes = [...new Map([...docs, ...pendingDocumentItems(lead)].map((type) => [type.toLowerCase(), type])).values()];
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
  const rows = visibleDocumentTypes.map((type) => {
    const doc = documents.find((item) => String(item.type || item.documentType || "").toLowerCase() === type.toLowerCase());
    const url = doc?.url || doc?.fileUrl || doc?.downloadUrl;
    return { key: type, cells: [type, url ? <a key="preview" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Preview</a> : "Not uploaded", url ? <a key="zoom" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Zoom</a> : "-", url ? <a key="download" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Download</a> : "-", dateTime(doc?.createdAt || doc?.uploadedAt)] };
  });
  const mobileDocuments = visibleDocumentTypes.map((type) => {
    const document = documents.find((item) => String(item.type || item.documentType || "").toLowerCase() === type.toLowerCase());
    return {
      type,
      url: document?.url || document?.fileUrl || document?.downloadUrl,
      uploadedAt: document?.createdAt || document?.uploadedAt,
    };
  });
  return (
    <section className="space-y-3 lg:space-y-4">
      <div className="hidden lg:block"><PageTitle title="Customer Documents" /></div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{[["Case ID", caseId(lead)], ["Customer", lead.fullName || lead.customerName], ["Mobile", lead.mobile], ["Finance Manager", lead.financeManagerName || lead.assignedFinanceManager], ["Finance Manager Mobile", lead.financeManagerMobile], [LEAD_TABLE_LABELS.currentStatus, executiveStatusLabel(lead)], ...(lead.rejectionReason || lead.loanRejectionReason ? [["Rejection Reason", lead.rejectionReason || lead.loanRejectionReason]] : []), ...(lead.disbursementRemarks ? [["Disbursement Remarks", lead.disbursementRemarks]] : [])].map(([label, value]) => <div key={label} className="min-w-0 rounded-lg border border-slate-200 bg-white p-3 lg:p-4"><p className="text-[10px] font-semibold uppercase text-slate-500 lg:text-xs">{label}</p><p className="mt-1 truncate text-sm font-medium text-slate-900 lg:text-base">{display(value)}</p></div>)}</div>
      <section className="rounded-lg border border-slate-200 bg-white p-3 lg:p-4">
        <p className="text-sm font-semibold text-slate-900">Loan Executive Remark</p>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-5 text-slate-700 lg:leading-6">{loanExecutiveRemark(lead)}</p>
      </section>
      <PendingDocumentsPanel lead={lead} />
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white lg:hidden">
        <h2 className="border-b border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-950">Customer Documents</h2>
        <div className="divide-y divide-slate-100">
          {mobileDocuments.map((document) => (
            <div key={document.type} className="flex min-h-12 items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{document.type}</p>
                <p className="text-[11px] text-slate-500">{document.url ? dateTime(document.uploadedAt) : "Not uploaded"}</p>
              </div>
              {document.url ? <a href={document.url} target="_blank" rel="noreferrer" className="shrink-0 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-[#0d47a1]">View</a> : <span className="text-xs text-slate-400">Pending</span>}
            </div>
          ))}
        </div>
      </section>
      <div className="hidden lg:block">
        <Table title="Customer Uploaded Documents" headers={["Document", "Preview", "Zoom", "Download", "Uploaded Timestamp"]} rows={rows} loading={false} />
      </div>
      {canShowSanction ? (
        <section className="rounded-lg border border-slate-200 bg-white p-3 lg:p-4">
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
