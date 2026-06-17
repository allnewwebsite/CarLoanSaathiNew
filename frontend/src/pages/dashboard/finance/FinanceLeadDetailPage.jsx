import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { DetailPageSkeleton } from "../../../components/ui/Loading.jsx";
import { LEAD_TABLE_LABELS } from "../../../constants/leadTableLabels.js";
import { useLeadDetailRealtime } from "../../../hooks/useRealtimeRefresh.js";
import { useRealtimeLeadDetailPatch } from "../../../hooks/useRealtimeEntityPatch.js";
import { api, findCachedGetItem, getCachedGetData } from "../../../services/api.js";
import { dateTime, display, moneyValue } from "../financeDesk.helpers.js";
import { bankDisplay, caseId, DEAD_CASE_REASONS, financeStatus, leadMutationFilter } from "./financeLeadPage.helpers.js";

export function FinanceLeadDetailPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const cachedLead = getCachedGetData(`/dealer/leads/${leadId}`)
    || findCachedGetItem("/dealer/leads", (item) => item.id === leadId || item.caseId === leadId);
  const [lead, setLead] = useState(() => cachedLead);
  const [loading, setLoading] = useState(() => !cachedLead);
  const [deadModalOpen, setDeadModalOpen] = useState(false);
  const [deadReason, setDeadReason] = useState("");
  const [deadNotes, setDeadNotes] = useState("");
  const [deadError, setDeadError] = useState("");
  const [deadSaving, setDeadSaving] = useState(false);

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

  const openDeadCaseModal = useCallback(() => {
    setDeadReason(lead?.deadCaseReason || "");
    setDeadNotes(lead?.deadCaseNotes || "");
    setDeadError("");
    setDeadModalOpen(true);
  }, [lead]);

  const submitDeadCase = useCallback(async () => {
    if (!deadReason || !deadNotes.trim()) {
      setDeadError("Select a reason and write notes before moving this case.");
      return;
    }
    setDeadSaving(true);
    setDeadError("");
    try {
      const response = await api.post(`/dealer/leads/${lead.id}/dead-case`, {
        reason: deadReason,
        notes: deadNotes,
      });
      setLead(response.data);
      setDeadModalOpen(false);
    } catch (error) {
      setDeadError(error.response?.data?.message || "Could not move this case. Please try again.");
    } finally {
      setDeadSaving(false);
    }
  }, [deadNotes, deadReason, lead?.id]);

  const restoreDeadCase = useCallback(async () => {
    if (!lead?.id) return;
    setDeadSaving(true);
    try {
      const response = await api.post(`/dealer/dead-cases/${lead.id}/restore`);
      setLead(response.data);
    } finally {
      setDeadSaving(false);
    }
  }, [lead?.id]);

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
            {lead.isDeadCase ? (
              <button onClick={restoreDeadCase} disabled={deadSaving} className="h-9 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 disabled:opacity-50">
                {deadSaving ? "Restoring..." : "Restore Case"}
              </button>
            ) : (
              <button onClick={openDeadCaseModal} className="h-9 rounded-md border border-red-200 bg-red-50 px-3 text-xs font-medium text-red-700">Move To Dead Case</button>
            )}
            <button onClick={() => navigate(`/finance/leads/${lead.id}/documents`)} className="h-9 rounded-md bg-[#0d47a1] px-3 text-xs font-medium text-white">View Documents</button>
          </div>
        </div>
        {lead.isDeadCase ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Dead case: {lead.deadCaseReason || "No reason recorded"}{lead.deadCaseDate ? ` on ${dateTime(lead.deadCaseDate)}` : ""}
          </div>
        ) : null}
        <div className="mt-5 grid gap-3 md:grid-cols-4">
          {[["Case ID", caseId(lead)], ["Customer", lead.fullName], ["City", lead.city], ["Assigned Bank", bankDisplay(lead)], ["Loan Amount", moneyValue(lead.loanAmount)], ["Salesperson", lead.assignedSalesperson], ["Finance Manager", lead.financeManagerName || lead.assignedFinanceManager], [LEAD_TABLE_LABELS.assignedExecutive, lead.assignedExecutiveName], [LEAD_TABLE_LABELS.executiveMobile, lead.assignedExecutiveMobile || lead.executiveMobile], [LEAD_TABLE_LABELS.currentStatus, financeStatus(lead)]].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs uppercase text-slate-500">{label}</p>
              <p className="mt-1 font-medium text-slate-900">{value || "-"}</p>
            </div>
          ))}
        </div>
      </div>
      {deadModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-base font-semibold text-slate-900">Move To Dead Case</h3>
              <button type="button" onClick={() => setDeadModalOpen(false)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-4">
              <label className="block text-sm font-medium text-slate-700">
                Dead Reason *
                <select value={deadReason} onChange={(event) => setDeadReason(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100">
                  <option value="">Select reason</option>
                  {DEAD_CASE_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Dead Notes *
                <textarea value={deadNotes} onChange={(event) => setDeadNotes(event.target.value)} rows={4} className="mt-1.5 w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100" placeholder="Write why this case should leave the active workflow." />
              </label>
              {deadError ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{deadError}</p> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button type="button" onClick={() => setDeadModalOpen(false)} className="h-9 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700">Cancel</button>
              <button type="button" onClick={submitDeadCase} disabled={deadSaving} className="h-9 rounded-md bg-[#0d47a1] px-3 text-xs font-medium text-white disabled:opacity-50">
                {deadSaving ? "Saving..." : "Move Case"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
