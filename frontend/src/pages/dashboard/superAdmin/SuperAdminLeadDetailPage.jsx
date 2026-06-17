import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { PendingDocumentsPanel } from "../../../components/PendingDocumentsPanel.jsx";
import { DetailPageSkeleton } from "../../../components/ui/Loading.jsx";
import { LEAD_TABLE_LABELS } from "../../../constants/leadTableLabels.js";
import { statusLabel } from "../../../constants/status.js";
import { useRealtimeLeadDetailPatch } from "../../../hooks/useRealtimeEntityPatch.js";
import { api, getCachedGetData } from "../../../services/api.js";
import { bankDocumentRows, loanExecutiveRemark } from "../../../utils/portalDisplay.js";
import { DataTable, PageTitle } from "./SuperAdminParts.jsx";
import { useAdminEcosystem } from "./superAdmin.hooks.js";
import {
  caseId,
  customerDocumentTypes,
  display,
  formatDate,
  leadStatus,
  superAdminMoney as money,
} from "./superAdmin.helpers.js";

export function SuperAdminLeadDetailPage() {
  const { leadId } = useParams();
  const data = useAdminEcosystem({ includeAudit: true });
  const cachedLead = getCachedGetData(`/admin/leads/${leadId}`)
    || data.leads.find((item) => item.id === leadId || item.caseId === leadId);
  const [detailLead, setDetailLead] = useState(() => cachedLead || null);
  const lead = detailLead || cachedLead;

  const loadLead = useCallback(async ({ silent = false } = {}) => {
    try {
      const response = await api.get(`/admin/leads/${leadId}`);
      setDetailLead(response.data);
    } catch {
      if (!silent) setDetailLead((current) => current || null);
    }
  }, [leadId]);

  useEffect(() => {
    loadLead();
  }, [loadLead]);

  useRealtimeLeadDetailPatch({ leadId, setLead: setDetailLead });
  const customerDocuments = useMemo(() => (Array.isArray(lead?.documents) ? lead.documents : []), [lead]);
  const bankDocuments = useMemo(() => bankDocumentRows(lead), [lead]);

  if (data.loading && !lead) return <DetailPageSkeleton />;
  if (!lead) return <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Lead not found.</section>;

  return (
    <section className="space-y-5">
      <PageTitle mode="lead details" />
      <div className="grid gap-3 md:grid-cols-4">
        {[["Case ID", caseId(lead)], ["Customer", lead.fullName || lead.customerName], ["Dealership", lead.dealershipName || lead.dealerEmail], ["Branch", lead.bankBranchCity || lead.branchCity || lead.city], [LEAD_TABLE_LABELS.assignedExecutive, lead.assignedExecutiveName || lead.assignedExecutiveEmail], [LEAD_TABLE_LABELS.executiveMobile, lead.assignedExecutiveMobile || lead.executiveMobile], ["Loan Amount", `Rs. ${money.format(Number(lead.loanAmount || 0))}`], [LEAD_TABLE_LABELS.currentStatus, statusLabel(leadStatus(lead))]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-1 font-medium text-slate-900">{display(value)}</p></div>)}
      </div>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">Loan Executive Remark</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{loanExecutiveRemark(lead)}</p>
      </section>
      <PendingDocumentsPanel lead={lead} />
      <DataTable title="Customer Uploaded Documents" headers={["Document", "Preview", "Uploaded Date/Time", "Download"]} rows={(customerDocuments.length ? customerDocuments : customerDocumentTypes.map((type) => ({ id: type.toLowerCase().replace(/\s+/g, "-"), type }))).map((document) => {
        const url = document.fileUrl || document.url || document.downloadUrl;
        return { key: document.id, cells: [display(document.label || document.type || document.documentType), url ? <a key="preview" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Preview</a> : "Not uploaded", formatDate(document.createdAt || document.uploadedAt), url ? <a key="download" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Download</a> : "-"] };
      })} loading={false} />
      <DataTable title="Bank Uploaded Documents" headers={["Document", "Preview", "Uploaded Date/Time", "Download"]} rows={bankDocuments.map((document) => {
        const url = document.fileUrl || document.url || document.downloadUrl;
        return { key: document.id || document.documentType || document.type, cells: [display(document.label || document.documentType || document.type || "Bank Document"), url ? <a key="preview" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Preview</a> : "Stored in application", formatDate(document.createdAt || document.uploadedAt), url ? <a key="download" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Download</a> : "-"] };
      })} loading={false} />
      <DataTable title="Audit History" headers={["Type", "Detail", "Time"]} rows={data.auditLogs.filter((item) => item.leadId === lead.id).map((item) => ({ key: `audit-${item.id}`, cells: ["Audit", display(item.actionType), formatDate(item.createdAt || item.timestamp)] }))} loading={false} />
    </section>
  );
}
