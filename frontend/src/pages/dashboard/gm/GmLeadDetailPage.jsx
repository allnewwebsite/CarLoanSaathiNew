import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { OperationalTable } from "../../../components/OperationalTable.jsx";
import { PendingDocumentsPanel } from "../../../components/PendingDocumentsPanel.jsx";
import { DetailPageSkeleton } from "../../../components/ui/Loading.jsx";
import { LEAD_TABLE_LABELS } from "../../../constants/leadTableLabels.js";
import { CUSTOMER_DOCUMENTS } from "../../../constants/customerDocuments.js";
import { mutationUrlMatches, useLeadDetailRealtime } from "../../../hooks/useRealtimeRefresh.js";
import { useRealtimeLeadDetailPatch } from "../../../hooks/useRealtimeEntityPatch.js";
import { api, findCachedGetItem, getCachedGetData } from "../../../services/api.js";
import { bankDocumentRows, formatPortalDateTime, loanExecutiveRemark, pendingDocumentItems, portalLeadStatusLabel } from "../../../utils/portalDisplay.js";

const docs = CUSTOMER_DOCUMENTS;
const leadMutationFilter = (detail) => mutationUrlMatches(detail, ["/gm/leads", "/dealer/leads", "/bank/leads", "/documents"]);

function display(value) {
  return value || "-";
}

function caseId(lead) {
  return lead.caseId || lead.id;
}

function statusLabel(lead) {
  return portalLeadStatusLabel(lead);
}

function SectionTitle({ title, subtitle }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">General Manager</p>
      <h1 className="mt-1 text-xl font-semibold text-slate-900">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
    </div>
  );
}

function Table({ title, headers, rows, loading }) {
  return <OperationalTable title={title} headers={headers} rows={rows} loading={loading} />;
}

export function GmLeadDetailPage() {
  const { leadId } = useParams();
  const cachedLead = getCachedGetData(`/gm/leads/${leadId}`)
    || findCachedGetItem("/gm/leads", (item) => item.id === leadId || item.caseId === leadId);
  const [lead, setLead] = useState(() => cachedLead);
  const [loading, setLoading] = useState(() => !cachedLead);

  const loadLead = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get(`/gm/leads/${leadId}`);
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
  const visibleDocumentTypes = [...new Map([...docs, ...pendingDocumentItems(lead)].map((type) => [type.toLowerCase(), type])).values()];

  return (
    <section className="space-y-4">
      <SectionTitle title="Customer Documents" subtitle={`Case ID: ${caseId(lead)}`} />
      <div className="grid gap-3 md:grid-cols-4">
        {[
          ["Customer", lead.fullName || lead.customerName],
          ["Mobile", lead.mobile],
          ["Salesperson", lead.assignedSalesperson || lead.salespersonName],
          [LEAD_TABLE_LABELS.assignedExecutive, lead.assignedExecutiveName || lead.assignedExecutiveEmail],
          [LEAD_TABLE_LABELS.executiveMobile, lead.assignedExecutiveMobile || lead.executiveMobile],
          [LEAD_TABLE_LABELS.currentStatus, statusLabel(lead)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase text-slate-500">{label}</p>
            <p className="mt-1 font-medium text-slate-900">{display(value)}</p>
          </div>
        ))}
      </div>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">Loan Executive Remark</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{loanExecutiveRemark(lead)}</p>
      </section>
      <PendingDocumentsPanel lead={lead} />
      <Table
        title="Customer Uploaded Documents"
        headers={["Document", "Preview", "Uploaded Timestamp", "Download"]}
        rows={visibleDocumentTypes.map((type) => {
          const document = (lead.documents || []).find((item) => String(item.type || item.documentType || "").toLowerCase() === type.toLowerCase());
          const url = document?.url || document?.fileUrl || document?.downloadUrl;
          return {
            key: type,
            cells: [
              type,
              url ? <a key="preview" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Preview</a> : "Not uploaded",
              formatPortalDateTime(document?.createdAt || document?.uploadedAt),
              url ? <a key="download" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Download</a> : "-",
            ],
          };
        })}
        loading={false}
      />
      <Table
        title="Bank Uploaded Documents"
        headers={["Document", "Preview", "Uploaded Timestamp", "Download"]}
        rows={bankDocumentRows(lead).map((document) => {
          const url = document?.url || document?.fileUrl || document?.downloadUrl;
          return {
            key: document.id || document.documentType || document.type,
            cells: [
              display(document.documentType || document.type),
              url ? <a key="preview" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Preview</a> : "Stored in application",
              formatPortalDateTime(document?.createdAt || document?.uploadedAt),
              url ? <a key="download" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Download</a> : "-",
            ],
          };
        })}
        loading={false}
      />
    </section>
  );
}
