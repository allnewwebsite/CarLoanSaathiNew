import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { PendingDocumentsPanel } from "../../components/PendingDocumentsPanel.jsx";
import { LEAD_TABLE_LABELS } from "../../constants/leadTableLabels.js";
import { mutationUrlMatches, useLeadDetailRealtime } from "../../hooks/useRealtimeRefresh.js";
import { useRealtimeLeadDetailPatch } from "../../hooks/useRealtimeEntityPatch.js";
import { api, findCachedGetItem, getCachedGetData } from "../../services/api.js";
import { bankDocumentRows, loanExecutiveRemark } from "../../utils/portalDisplay.js";
import { caseId, dateTime, display, leadStatusLabel } from "./bankManager.helpers.js";
import { ReassignLeadDialog } from "./ReassignLeadDialog.jsx";

const pageSize = 10;
const leadMutationFilter = (detail) => mutationUrlMatches(detail, ["/bank/leads", "/dealer/leads", "/documents"]);
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

function Table({ title, headers, rows, loading, page, total, hasMore, onPage }) {
  return <OperationalTable title={title} headers={headers} rows={rows} loading={loading} page={page} total={total} hasMore={hasMore} onPage={onPage} pageSize={pageSize} />;
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

function PageTitle({ title }) {
  return <div><p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Bank Manager</p><h1 className="mt-1 text-xl font-semibold text-slate-900">{title}</h1></div>;
}

export function BankManagerLeadDetailPage() {
  const { leadId } = useParams();
  const cachedLead = getCachedGetData(`/bank/leads/${leadId}`)
    || findCachedGetItem("/bank/leads", (item) => item.id === leadId || item.caseId === leadId)
    || findCachedGetItem("/bank/analytics", (item) => item.id === leadId || item.caseId === leadId);
  const [lead, setLead] = useState(() => cachedLead);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState("");
  const [pendingReassign, setPendingReassign] = useState(null);
  const [loading, setLoading] = useState(() => !cachedLead);

  const loadLead = useCallback(async ({ silent = false } = {}) => {
    setError(null);
    if (!silent) setLoading(true);
    try {
      const response = await api.get(`/bank/leads/${leadId}`);
      setLead(response.data);
    } catch (err) {
      setLead((current) => current || null);
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
  useRealtimeLeadDetailPatch({ leadId, setLead });
  useLeadDetailRealtime({ lead, leadId, onRefresh: loadLead, mutationFilter: leadMutationFilter });

  if (loading && !lead) return <DetailSkeleton />;
  if (!lead) {
    if (error?.status === 403) return <DetailState title="Access denied" message="This lead is outside your authorized bank or branch scope." requestId={error.requestId} onRetry={() => loadLead()} tone="amber" />;
    if (error?.status === 404) return <DetailState title="Lead not found" message="This lead may have been removed or the link is no longer valid." requestId={error.requestId} onRetry={() => loadLead()} />;
    return <DetailState title="Documents could not be loaded" message={error?.message || "Unexpected server error while loading this lead."} requestId={error?.requestId} onRetry={() => loadLead()} tone="red" />;
  }

  const documents = [...(lead.documents || [])];
  const bankDocs = bankDocumentRows(lead);
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
      {actionError ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{actionError}</p> : null}
      <ReassignLeadDialog lead={pendingReassign} onCancel={() => setPendingReassign(null)} onDone={() => loadLead({ silent: true })} />
      <div className="grid gap-3 md:grid-cols-4">
        {[["Case ID", caseId(lead)], ["Customer", lead.fullName || lead.customerName], ["Mobile", lead.mobile], ["Finance Manager", lead.financeManagerName || lead.assignedFinanceManager], ["Finance Manager Mobile", lead.financeManagerMobile], [LEAD_TABLE_LABELS.assignedExecutive, lead.assignedExecutiveName || lead.assignedExecutiveEmail], [LEAD_TABLE_LABELS.executiveMobile, lead.assignedExecutiveMobile || lead.executiveMobile], [LEAD_TABLE_LABELS.currentStatus, leadStatusLabel(lead)]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-1 font-medium text-slate-900">{display(value)}</p></div>)}
      </div>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">Loan Executive Remark</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{loanExecutiveRemark(lead)}</p>
      </section>
      <PendingDocumentsPanel lead={lead} />
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Case Assignment</p>
            <p className="mt-1 text-sm text-slate-500">Current executive: {display(lead.assignedExecutiveName || lead.assignedExecutiveEmail)}{lead.assignedExecutiveMobile || lead.executiveMobile ? ` - ${lead.assignedExecutiveMobile || lead.executiveMobile}` : ""}</p>
          </div>
          <button
            onClick={() => {
              setActionError("");
              setPendingReassign(lead);
            }}
            className="w-full rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-[#0d47a1] sm:w-auto"
          >
            {lead.assignedExecutiveId || lead.assignedExecutiveEmail ? "Reassign to Next Executive" : "Assign to Executive"}
          </button>
        </div>
      </div>
      <Table title="Customer Uploaded Documents" headers={["Document", "Preview", "Uploaded Timestamp", "Download"]} rows={rows} loading={false} />
      <Table title="Bank Uploaded Documents" headers={["Document", "Preview", "Uploaded Timestamp", "Download"]} rows={bankDocs.map((document) => {
        const url = document?.url || document?.fileUrl || document?.downloadUrl;
        return {
          key: document.id || document.documentType || document.type,
          cells: [
            display(document.documentType || document.type),
            url ? <a key="preview" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Preview</a> : "Stored in application",
            dateTime(document?.createdAt || document?.uploadedAt),
            url ? <a key="download" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Download</a> : "-",
          ],
        };
      })} loading={false} />
    </section>
  );
}
