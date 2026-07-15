import { useCallback, useEffect, useState } from "react";
import { Download, Eye, X } from "lucide-react";
import { useParams } from "react-router-dom";
import { PendingDocumentsPanel } from "../../../components/PendingDocumentsPanel.jsx";
import { useLeadDetailRealtime } from "../../../hooks/useRealtimeRefresh.js";
import { useRealtimeLeadDetailPatch } from "../../../hooks/useRealtimeEntityPatch.js";
import { api } from "../../../services/api.js";
import { bankDocumentRows, loanExecutiveRemark, pendingDocumentItems } from "../../../utils/portalDisplay.js";
import { dateTime, display } from "../financeDesk.helpers.js";
import { caseId, documentTypes, leadMutationFilter } from "./financeLeadPage.helpers.js";

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
  useEffect(() => { loadLead(); }, [loadLead]);
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
  const requestedTypes = pendingDocumentItems(lead);
  const uploadTypes = [...new Map([...documentTypes, ...requestedTypes].map((type) => [String(type).toLowerCase(), String(type)])).values()];
  const openDocument = async (document, download = false) => {
    try {
      const response = await api.get(`/documents/${document.id}/view`);
      if (!response.data?.url) return setMessage("Document preview is unavailable.");
      const anchor = window.document.createElement("a");
      anchor.href = response.data.url;
      anchor.target = download ? "_self" : "_blank";
      anchor.rel = "noreferrer";
      if (download) anchor.download = document.file || document.type || "document";
      anchor.click();
    } catch {
      setMessage("Document could not be opened. Please retry.");
    }
  };
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
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col gap-1 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-base font-semibold text-slate-900">Customer Uploaded Documents</h2><p className="mt-1 text-xs text-slate-500">Upload requested customer documents from the same standard list visible to the Loan Executive.</p></div>
          <span className="text-xs font-semibold text-slate-500">{uploadTypes.length} documents</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{["Document", "Status", "Choose File", "Upload", "Preview", "Download", "Uploaded Timestamp"].map((heading) => <th key={heading} className="whitespace-nowrap px-4 py-3 font-semibold">{heading}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {uploadTypes.map((type) => {
                const document = uploaded(type);
                const file = files[type];
                const percent = progress[type] || 0;
                const isRequested = requestedTypes.some((item) => item.toLowerCase() === type.toLowerCase());
                return (
                  <tr key={type} className={isRequested ? "bg-amber-50/40" : "bg-white"}>
                    <td className="min-w-40 px-4 py-3"><p className="font-medium text-slate-900">{type}</p>{isRequested ? <span className="mt-1 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Requested</span> : null}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{document ? document.status || "Uploaded" : "Not uploaded"}{percent < 0 ? <p className="text-xs text-red-600">Upload failed</p> : null}</td>
                    <td className="min-w-56 px-4 py-3"><label className="flex h-9 cursor-pointer items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-600"><span className="max-w-36 truncate">{file?.name || "Choose file"}</span>{file ? <button type="button" onClick={(event) => { event.preventDefault(); setFiles((current) => ({ ...current, [type]: null })); }} className="text-slate-400 hover:text-slate-700" aria-label={`Remove ${type} file`}><X className="h-3.5 w-3.5" /></button> : null}<input type="file" className="hidden" accept=".pdf,image/png,image/jpeg" onChange={(event) => setFiles((current) => ({ ...current, [type]: event.target.files?.[0] || null }))} /></label>{percent > 0 ? <div className="mt-2 h-1 rounded-full bg-slate-100"><div className={`h-1 rounded-full ${percent < 0 ? "bg-red-500" : "bg-[#0d47a1]"}`} style={{ width: `${Math.max(percent, 8)}%` }} /></div> : null}</td>
                    <td className="px-4 py-3"><button type="button" onClick={() => upload(type)} disabled={!file} className="h-9 whitespace-nowrap rounded-md bg-[#0d47a1] px-3 text-xs font-semibold text-white disabled:opacity-40">{document ? "Replace" : percent < 0 ? "Retry" : "Upload"}</button></td>
                    <td className="px-4 py-3">{document ? <button type="button" onClick={() => openDocument(document)} className="inline-flex items-center gap-1 text-xs font-semibold text-[#0d47a1]"><Eye className="h-3.5 w-3.5" /> Preview</button> : <span className="text-slate-400">-</span>}</td>
                    <td className="px-4 py-3">{document ? <button type="button" onClick={() => openDocument(document, true)} className="inline-flex items-center gap-1 text-xs font-semibold text-[#0d47a1]"><Download className="h-3.5 w-3.5" /> Download</button> : <span className="text-slate-400">-</span>}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{document ? dateTime(document.uploadedAt || document.createdAt) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
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
