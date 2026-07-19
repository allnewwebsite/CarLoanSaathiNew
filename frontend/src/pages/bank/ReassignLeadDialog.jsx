import { useEffect, useState } from "react";
import { api } from "../../services/api.js";
import {
  branchMatch,
  branchValue,
  caseId,
  cleanText,
  currentExecutiveIdentity,
  display,
  executiveIdentity,
  leadStatusLabel,
  reassignmentExecutiveId,
  responseRows,
} from "./bankManager.helpers.js";

// CASE_REASSIGNMENT_EXECUTIVE_FILTER: this eligibility contract must remain same-branch-first.
function reassignmentDiagnostics(lead = {}, rows = []) {
  const currentIds = new Set(currentExecutiveIdentity(lead));
  const diagnostics = rows.map((executive) => {
    const status = String(executive.status || "").trim().toLowerCase();
    const active = executive.active !== false && !["inactive", "deleted", "removed", "suspended", "disabled"].includes(status);
    const current = executiveIdentity(executive).some((key) => currentIds.has(key));
    const sameBranch = branchMatch(lead, executive);
    const reasons = [];
    if (!active) reasons.push("inactive/deleted/suspended");
    if (current) reasons.push("current owner");
    if (!sameBranch) reasons.push(`branch mismatch (${branchValue(executive) || "missing branch"} / ${executive.bankIfsc || executive.ifsc || executive.ifscCode || "missing IFSC"})`);
    return {
      name: executive.name || executive.fullName || executive.email || executive.officialEmail || executive.id,
      active,
      current,
      sameBranch,
      eligibleStrict: active && !current && sameBranch,
      eligibleFallback: active && !current,
      reason: reasons.join(", ") || "eligible",
    };
  });
  return diagnostics;
}

async function performLeadReassignment(lead, reason, newExecutiveId, onDone) {
  await api.patch(`/bank/leads/${lead.id}/reassign`, { reason, newExecutiveId });
  await onDone?.();
}

export function ReassignLeadDialog({ lead, onCancel, onDone }) {
  const [reason, setReason] = useState("manager-reassignment");
  const [executives, setExecutives] = useState([]);
  const [selectedExecutiveId, setSelectedExecutiveId] = useState("");
  const [loadingExecutives, setLoadingExecutives] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setReason("manager-reassignment");
    setExecutives([]);
    setSelectedExecutiveId("");
    setError("");
    setBusy(false);
  }, [lead?.id]);

  useEffect(() => {
    if (!lead) return undefined;
    let cancelled = false;
    setLoadingExecutives(true);
    api.get("/bank/executives", { params: { limit: 100 } })
      .then((response) => {
        if (cancelled) return;
        const rows = responseRows(response);
        const diagnostics = reassignmentDiagnostics(lead, rows);
        const strictEligible = rows.filter((_executive, index) => diagnostics[index]?.eligibleStrict);
        const fallbackEligible = rows.filter((_executive, index) => diagnostics[index]?.eligibleFallback);
        const eligible = strictEligible.length ? strictEligible : fallbackEligible;
        setExecutives(eligible);
        setSelectedExecutiveId(reassignmentExecutiveId(eligible[0]) || "");
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.message || err.message || "Unable to load executives");
      })
      .finally(() => {
        if (!cancelled) setLoadingExecutives(false);
      });
    return () => { cancelled = true; };
  }, [lead]);

  if (!lead) return null;

  const submit = async (event) => {
    event.preventDefault();
    const cleanReason = cleanText(reason);
    if (!cleanReason) {
      setError("Reassignment reason is required.");
      return;
    }
    if (!selectedExecutiveId) {
      setError("Select a new executive.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await performLeadReassignment(lead, cleanReason, selectedExecutiveId, onDone);
      onCancel();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Unable to reassign lead");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <form onSubmit={submit} className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Reassign Case</h2>
            <p className="mt-1 text-sm text-slate-600">Move {caseId(lead)} to another same-branch executive.</p>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 disabled:opacity-60">Close</button>
        </div>
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <p><span className="font-semibold">Case ID:</span> {caseId(lead)}</p>
          <p className="mt-1"><span className="font-semibold">Customer:</span> {display(lead.fullName || lead.customerName)}</p>
          <p><span className="font-semibold">Current executive:</span> {display(lead.assignedExecutiveName || lead.assignedExecutiveEmail)}</p>
          {(lead.assignedExecutiveMobile || lead.executiveMobile) ? <p className="mt-1"><span className="font-semibold">Mobile:</span> {lead.assignedExecutiveMobile || lead.executiveMobile}</p> : null}
          <p className="mt-1"><span className="font-semibold">Status:</span> {leadStatusLabel(lead)}</p>
          <p className="mt-1"><span className="font-semibold">Branch:</span> {display(lead.bankBranchCity || lead.branchCity || lead.branchLocation || lead.bankBranchLocation || lead.assignedBankIfsc || lead.bankIfsc || lead.ifscCode)}</p>
        </div>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          Select New Executive
          <select
            value={selectedExecutiveId}
            disabled={loadingExecutives || busy}
            onChange={(event) => {
              setSelectedExecutiveId(event.target.value);
              setError("");
            }}
            className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-[#0d47a1] disabled:bg-slate-50 disabled:text-slate-400"
          >
            {loadingExecutives ? <option value="">Loading executives...</option> : null}
            {!loadingExecutives && !executives.length ? <option value="">No eligible executives found.</option> : null}
            {!loadingExecutives && executives.map((executive) => (
              <option key={reassignmentExecutiveId(executive)} value={reassignmentExecutiveId(executive)}>
                {executive.name || executive.fullName || executive.email || executive.officialEmail} {executive.mobile ? `- ${executive.mobile}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          Reason
          <textarea
            value={reason}
            onChange={(event) => {
              setReason(event.target.value.replace(/[<>]/g, ""));
              setError("");
            }}
            rows={3}
            className="mt-2 w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#0d47a1]"
          />
        </label>
        {error ? <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60">Cancel</button>
          <button type="submit" disabled={busy || loadingExecutives || !selectedExecutiveId} className="rounded-md bg-[#0d47a1] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? "Reassigning..." : "Reassign"}
          </button>
        </div>
      </form>
    </div>
  );
}
