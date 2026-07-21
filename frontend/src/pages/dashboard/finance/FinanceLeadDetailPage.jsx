import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { DetailPageSkeleton } from "../../../components/ui/Loading.jsx";
import { LEAD_TABLE_LABELS } from "../../../constants/leadTableLabels.js";
import { useLeadDetailRealtime } from "../../../hooks/useRealtimeRefresh.js";
import { useRealtimeLeadDetailPatch } from "../../../hooks/useRealtimeEntityPatch.js";
import { api, findCachedGetItem, getCachedGetData } from "../../../services/api.js";
import { dateTime, display, moneyValue } from "../financeDesk.helpers.js";
import { bankDisplay, caseId, financeStatus, leadMutationFilter } from "./financeLeadPage.helpers.js";

export function FinanceLeadDetailPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const cachedLead = getCachedGetData(`/dealer/leads/${leadId}`)
    || findCachedGetItem("/dealer/leads", (item) => item.id === leadId || item.caseId === leadId);
  const [lead, setLead] = useState(() => cachedLead);
  const [loading, setLoading] = useState(() => !cachedLead);

  const loadLead = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get(`/dealer/leads/${leadId}`);
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
  if (!lead) return <section className="card p-5 text-sm text-slate-500">Lead not found.</section>;

  return (
    <section className="space-y-5">
      <div className="card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{lead.fullName || "Lead Details"}</h2>
            <p className="mt-1 text-sm text-slate-500">{caseId(lead)} - {lead.mobile || "-"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => navigate(`/finance/leads/${lead.id}/documents`)} className="h-9 rounded-md bg-[#0d47a1] px-3 text-xs font-medium text-white">View Documents</button>
          </div>
        </div>
        {lead.isDeadCase ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Dead case: {lead.deadCaseReason || "No reason recorded"}{lead.deadCaseDate ? ` on ${dateTime(lead.deadCaseDate)}` : ""}
          </div>
        ) : null}
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {[["Case ID", caseId(lead)], ["Customer", lead.fullName], ["City", lead.city], ["Assigned Bank", bankDisplay(lead)], ["Loan Amount", moneyValue(lead.loanAmount)], ["Salesperson", lead.assignedSalesperson], ["Finance Manager", lead.financeManagerName || lead.assignedFinanceManager], [LEAD_TABLE_LABELS.assignedExecutive, lead.assignedExecutiveName], [LEAD_TABLE_LABELS.executiveMobile, lead.assignedExecutiveMobile || lead.executiveMobile], [LEAD_TABLE_LABELS.currentStatus, financeStatus(lead)], ...(lead.rejectionReason || lead.loanRejectionReason ? [["Rejection Reason", lead.rejectionReason || lead.loanRejectionReason]] : []), ...(lead.disbursementRemarks ? [["Disbursement Remarks", lead.disbursementRemarks]] : [])].map(([label, value]) => (
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
