import { useState } from "react";
import { LEAD_STATUSES } from "../../constants/status.js";
import { api } from "../../services/api.js";
import { loanExecutiveRemark } from "../../utils/portalDisplay.js";
import { Modal } from "./LoanExecutivePanelParts.jsx";
import {
  caseId,
  dateTime,
  display,
  generatedAt,
  loanExecutiveDocs as docs,
  moneyValue,
  otherDocumentLabel,
  statusOptions,
} from "./loanExecutive.helpers.js";

export function RejectModal({ lead, onClose, onSaved }) {
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

export function StatusUpdateModal({ lead, onClose, onSaved }) {
  const [status, setStatus] = useState("");
  const [remarks, setRemarks] = useState("");
  const [selected, setSelected] = useState([]);
  const [otherDocument, setOtherDocument] = useState("");
  const [sanctionFile, setSanctionFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (busy || !status) return;
    const otherSelected = selected.includes(otherDocumentLabel);
    const requestedDocuments = [
      ...selected.filter((item) => item !== otherDocumentLabel),
      ...(otherSelected && otherDocument.trim() ? [`Other: ${otherDocument.trim()}`] : []),
    ];
    if (status === LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS && !requestedDocuments.length) {
      setError("Select at least one required document.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await api.patch(`/bank/leads/${lead.id}/status`, {
        caseId: lead.caseId || lead.id,
        status,
        remarks,
        remark: remarks,
        requiredDocuments: requestedDocuments,
        updatedBy: "loan-executive",
        updatedAt: new Date().toISOString(),
        workflow: { source: "loan-executive-status-modal", requestedDocuments, remark: remarks },
        rejectionReason: status === LEAD_STATUSES.REJECTED ? remarks : undefined,
        pendingDocumentsRequested: status === LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS ? requestedDocuments : undefined,
        pendingDocumentReason: status === LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS ? remarks : undefined,
      });
      if (status === LEAD_STATUSES.DISBURSED && sanctionFile) {
        const form = new FormData();
        form.append("document", sanctionFile);
        form.append("documentType", "sanction-letter");
        await api.post(`/bank/leads/${lead.id}/documents`, form, { headers: { "Content-Type": "multipart/form-data" } });
      }
      onSaved({ message: status === LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS ? "Document request submitted successfully." : "Status updated successfully." });
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Could not update the case. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Update Lead Status" onClose={onClose}>
      <label className="text-sm font-medium text-slate-700">
        Status
        <select className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-[#0d47a1]" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Select Status</option>
          {statusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      {status === LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS ? (
        <fieldset className="mt-4 rounded-lg border border-slate-200 p-3">
          <legend className="px-1 text-sm font-semibold text-slate-800">Select required documents</legend>
          <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
            <span>Choose at least one document.</span>
            <span className="font-semibold text-[#0d47a1]">{selected.length} selected</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {docs.map((doc) => (
              <label key={doc} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2.5 text-sm ${selected.includes(doc) ? "border-amber-300 bg-amber-50 text-slate-900" : "border-slate-200 text-slate-700"}`}>
                <input type="checkbox" checked={selected.includes(doc)} onChange={() => setSelected((current) => current.includes(doc) ? current.filter((item) => item !== doc) : [...current, doc])} />
                <span className="font-medium">{doc}</span>
              </label>
            ))}
          </div>
          {selected.includes(otherDocumentLabel) ? <input className="mt-3 h-10 w-full rounded-md border border-slate-200 px-3 text-sm" placeholder="Enter other document name" value={otherDocument} onChange={(event) => setOtherDocument(event.target.value)} /> : null}
        </fieldset>
      ) : null}
      <label className="mt-3 block text-sm font-medium text-slate-700">
        Remark
        <textarea className="mt-2 min-h-24 w-full rounded-md border border-slate-200 p-3 text-sm outline-none focus:border-[#0d47a1]" placeholder={status === LEAD_STATUSES.REJECTED ? "Rejection reason" : "Executive remark"} value={remarks} onChange={(event) => setRemarks(event.target.value)} />
      </label>
      {status === LEAD_STATUSES.DISBURSED ? (
        <div className="mt-3">
          <label className="block text-sm font-medium text-slate-700">
            Sanction Letter
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(event) => setSanctionFile(event.target.files?.[0] || null)} className="mt-2 block w-full rounded-md border border-slate-200 text-sm text-slate-600 file:mr-3 file:h-10 file:border-0 file:bg-slate-50 file:px-3 file:text-sm file:font-medium file:text-slate-700" />
          </label>
        </div>
      ) : null}
      {error ? <p role="alert" className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
      <button disabled={busy || !status || (status === LEAD_STATUSES.REJECTED && !remarks.trim()) || (status === LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS && (!selected.length || (selected.includes(otherDocumentLabel) && !otherDocument.trim())))} onClick={submit} className="mt-4 rounded-md bg-[#0d47a1] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {busy ? "Saving..." : status === LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS ? "Submit Document Request" : "Save Status"}
      </button>
    </Modal>
  );
}

export function LeadDetailsModal({ lead, onClose }) {
  const details = [
    ["Customer Mobile", lead.mobile],
    ["Car On-Road Price", moneyValue(lead.onRoadPrice || lead.carOnRoadPrice)],
    ["Finance Manager", lead.financeManagerName || lead.assignedFinanceManager],
    ["Finance Manager Mobile", lead.financeManagerMobile],
    ["Generated", generatedAt(lead)],
    ["Last Updated", dateTime(lead.updatedAt || lead.statusUpdatedAt || lead.createdAt)],
    ["Executive Remark", loanExecutiveRemark(lead)],
  ];
  return (
    <Modal title={caseId(lead)} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        {details.map(([label, value]) => (
          <div key={label} className={label === "Executive Remark" ? "col-span-2 rounded-md bg-slate-50 p-3" : "rounded-md bg-slate-50 p-3"}>
            <p className="text-[11px] font-semibold uppercase text-slate-500">{label}</p>
            <p className="mt-1 break-words text-sm font-medium text-slate-900">{display(value)}</p>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function DocumentsSheet({ lead, onClose }) {
  const uploadedDocuments = Array.isArray(lead.documents) ? lead.documents : [];
  const [showUploads, setShowUploads] = useState(false);
  const firstDocumentUrl = uploadedDocuments
    .map((document) => document.url || document.fileUrl || document.downloadUrl)
    .find(Boolean);
  return (
    <Modal title={`Documents - ${caseId(lead)}`} onClose={onClose} sheet>
      <div className="grid grid-cols-2 gap-2">
        {firstDocumentUrl ? (
          <a href={firstDocumentUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-2 text-center text-xs font-semibold text-slate-700">View Docs</a>
        ) : (
          <button type="button" disabled className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-2 text-center text-xs font-semibold text-slate-400">View Docs</button>
        )}
        <button type="button" onClick={() => setShowUploads((current) => !current)} className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-2 text-center text-xs font-semibold text-slate-700">Upload Review</button>
      </div>
      <div className={`mt-4 space-y-2 ${showUploads ? "" : "hidden sm:block"}`}>
        <p className="text-xs font-semibold uppercase text-slate-500">Customer Documents</p>
        {!uploadedDocuments.length ? <p className="rounded-md bg-slate-50 px-3 py-4 text-sm text-slate-500">No documents uploaded yet.</p> : null}
        {uploadedDocuments.map((document, index) => {
          const url = document.url || document.fileUrl || document.downloadUrl;
          return (
            <div key={document.id || `${document.type || document.documentType}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{document.type || document.documentType || "Document"}</p>
                <p className="text-xs text-slate-500">{dateTime(document.createdAt || document.uploadedAt)}</p>
              </div>
              {url ? <a href={url} target="_blank" rel="noreferrer" className="shrink-0 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-[#0d47a1]">View</a> : <span className="text-xs text-slate-400">Pending</span>}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
