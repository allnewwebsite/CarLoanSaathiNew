import { Download, Plus, RotateCcw, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { useCursorPager } from "../../hooks/useCursorPager.js";
import { api } from "../../services/api.js";
import { AUDIENCE_LABELS, DEAD_CASE_ENDPOINTS, PAGE_SIZE, downloadCsv, sameLead } from "./deadCases.helpers.js";
import { roleColumns } from "./deadCases.columns.jsx";
import { DEAD_CASE_REASONS } from "./finance/financeLeadPage.helpers.js";

export function DeadCasesPage({ audience = "finance" }) {
  const endpoint = DEAD_CASE_ENDPOINTS[audience] || DEAD_CASE_ENDPOINTS.finance;
  const canModify = audience === "finance";
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [editLead, setEditLead] = useState(null);
  const [editReason, setEditReason] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editError, setEditError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [caseNumber, setCaseNumber] = useState("");
  const [addReason, setAddReason] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addError, setAddError] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const { cursorParamsForPage, rememberNextCursor } = useCursorPager([endpoint, debouncedSearch, reasonFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const cursor = cursorParamsForPage(page);
      const response = await api.get(endpoint, {
        params: {
          page,
          limit: PAGE_SIZE,
          search: debouncedSearch || undefined,
          deadCaseReason: reasonFilter || undefined,
          ...cursor,
        },
      });
      const payload = Array.isArray(response.data) ? { data: response.data } : response.data || {};
      setRows(payload.data || []);
      setHasMore(Boolean(payload.hasMore || payload.nextCursor));
      rememberNextCursor(page, payload.nextCursor);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [cursorParamsForPage, debouncedSearch, endpoint, page, reasonFilter, rememberNextCursor]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const refreshOnDeadCase = (event) => {
      const type = event.detail?.eventType || event.detail?.event;
      if (!["DEAD_CASE_CREATED", "DEAD_CASE_RESTORED", "DEAD_CASE_UPDATED", "LEAD_MARKED_DEAD", "LEAD_RESTORED_FROM_DEAD"].includes(type)) return;
      const patch = event.detail?.lead || event.detail;
      if (!patch?.id && !patch?.leadId && !patch?.caseId) return;
      setRows((current) => {
        if (type === "DEAD_CASE_RESTORED" || type === "LEAD_RESTORED_FROM_DEAD" || patch.isDeadCase === false) {
          return current.filter((row) => !sameLead(row, patch));
        }
        const nextPatch = { ...patch, isDeadCase: true };
        const exists = current.some((row) => sameLead(row, nextPatch));
        if (exists) return current.map((row) => sameLead(row, nextPatch) ? { ...row, ...nextPatch } : row);
        return [nextPatch, ...current].slice(0, Math.max(current.length || PAGE_SIZE, PAGE_SIZE));
      });
    };
    window.addEventListener("cls:realtime-event", refreshOnDeadCase);
    return () => window.removeEventListener("cls:realtime-event", refreshOnDeadCase);
  }, []);

  const restoreCase = useCallback(async (lead) => {
    if (!canModify || !lead?.id) return;
    setActionId(lead.id);
    try {
      await api.post(`/dealer/dead-cases/${lead.id}/restore`);
      setRows((current) => current.filter((item) => item.id !== lead.id));
      setEditLead(null);
    } finally {
      setActionId("");
      load({ silent: true });
    }
  }, [canModify, load]);

  const openEdit = useCallback((lead) => {
    if (!canModify) return;
    setEditLead(lead);
    setEditReason(lead.deadCaseReason || "");
    setEditNotes(lead.deadCaseNotes || "");
    setEditError("");
  }, [canModify]);

  const columns = useMemo(() => roleColumns(audience, canModify, openEdit), [audience, canModify, openEdit]);
  const headers = useMemo(() => columns.map((column) => column.header), [columns]);

  const openAdd = useCallback(() => {
    if (!canModify) return;
    setCaseNumber("");
    setAddReason("");
    setAddNotes("");
    setAddError("");
    setAddOpen(true);
  }, [canModify]);

  const submitAdd = useCallback(async () => {
    if (!caseNumber.trim()) {
      setAddError("Invalid Case Number");
      return;
    }
    if (!addReason || !addNotes.trim()) {
      setAddError("Select a reason and enter notes.");
      return;
    }
    setAddSaving(true);
    setAddError("");
    try {
      const response = await api.post("/dealer/dead-cases", {
        caseNumber: caseNumber.trim().toUpperCase(),
        reason: addReason,
        notes: addNotes,
      });
      const updated = response.data;
      setRows((current) => {
        const exists = current.some((row) => sameLead(row, updated));
        if (exists) return current.map((row) => sameLead(row, updated) ? updated : row);
        return [updated, ...current].slice(0, Math.max(current.length || PAGE_SIZE, PAGE_SIZE));
      });
      setAddOpen(false);
    } catch (error) {
      setAddError(error.response?.data?.message || "Could not add this case to Dead Cases.");
    } finally {
      setAddSaving(false);
    }
  }, [addNotes, addReason, caseNumber]);

  const saveEdit = useCallback(async () => {
    if (!editLead?.id) return;
    if (!editReason || !editNotes.trim()) {
      setEditError("Select a reason and enter notes.");
      return;
    }
    setActionId(editLead.id);
    setEditError("");
    try {
      const response = await api.patch(`/dealer/dead-cases/${editLead.id}`, {
        reason: editReason,
        notes: editNotes,
      });
      setRows((current) => current.map((item) => item.id === editLead.id ? response.data : item));
      setEditLead(null);
    } catch (error) {
      setEditError(error.response?.data?.message || "Could not update dead case details.");
    } finally {
      setActionId("");
      load({ silent: true });
    }
  }, [editLead?.id, editNotes, editReason, load]);

  const tableRows = useMemo(() => rows.map((lead) => ({
    key: lead.id,
    cells: columns.map((column) => column.cell(lead)),
  })), [columns, rows]);

  return (
    <section className="space-y-4">
      <div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
              {AUDIENCE_LABELS[audience] || AUDIENCE_LABELS.finance}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">Dead Cases</h1>
            <p className="mt-1 text-sm text-slate-500">Cases manually moved out of active workflow by Finance Desk.</p>
          </div>
          {canModify ? (
            <button
              type="button"
              onClick={openAdd}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#0d47a1] px-4 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" />
              Add Dead Case
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 lg:grid-cols-[1fr_220px_auto] lg:items-center">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 px-3 sm:max-w-xl">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search case ID, customer, mobile, reason, or executive"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <select
          value={reasonFilter}
          onChange={(event) => {
            setReasonFilter(event.target.value);
            setPage(1);
          }}
          className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none"
        >
          <option value="">All Reasons</option>
          {DEAD_CASE_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
        </select>
        <button
          type="button"
          onClick={() => downloadCsv(rows, audience, columns)}
          disabled={!rows.length}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-700 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      <OperationalTable
        title="Dead Cases"
        headers={headers}
        rows={tableRows}
        loading={loading}
        page={page}
        total={null}
        hasMore={hasMore}
        onPage={setPage}
        pageSize={PAGE_SIZE}
      />
      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-base font-semibold text-slate-900">Add Dead Case</h3>
              <button type="button" onClick={() => setAddOpen(false)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-4">
              <label className="block text-sm font-medium text-slate-700">
                Case Number *
                <input
                  value={caseNumber}
                  onChange={(event) => setCaseNumber(event.target.value)}
                  placeholder="CLS-0001"
                  className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm uppercase outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Dead Reason *
                <select value={addReason} onChange={(event) => setAddReason(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100">
                  <option value="">Select reason</option>
                  {DEAD_CASE_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Dead Notes *
                <textarea
                  value={addNotes}
                  onChange={(event) => setAddNotes(event.target.value)}
                  rows={4}
                  className="mt-1.5 w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100"
                  placeholder="Customer purchased vehicle from another dealer."
                />
              </label>
              {addError ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{addError}</p> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button type="button" onClick={() => setAddOpen(false)} className="h-9 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700">Cancel</button>
              <button type="button" onClick={submitAdd} disabled={addSaving} className="h-9 rounded-md bg-[#0d47a1] px-3 text-xs font-medium text-white disabled:opacity-50">
                {addSaving ? "Saving..." : "Add To Dead Cases"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {editLead ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-base font-semibold text-slate-900">Update Dead Case</h3>
              <button type="button" onClick={() => setEditLead(null)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-4">
              <label className="block text-sm font-medium text-slate-700">
                Dead Reason *
                <select value={editReason} onChange={(event) => setEditReason(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100">
                  <option value="">Select reason</option>
                  {DEAD_CASE_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Dead Notes *
                <textarea value={editNotes} onChange={(event) => setEditNotes(event.target.value)} rows={4} className="mt-1.5 w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100" />
              </label>
              {editError ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{editError}</p> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button type="button" onClick={() => setEditLead(null)} className="h-9 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700">Cancel</button>
              <button type="button" onClick={() => restoreCase(editLead)} disabled={actionId === editLead.id} className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 disabled:opacity-50">
                <RotateCcw className="h-3.5 w-3.5" />
                {actionId === editLead.id ? "Restoring..." : "Restore"}
              </button>
              <button type="button" onClick={saveEdit} disabled={actionId === editLead.id} className="h-9 rounded-md bg-[#0d47a1] px-3 text-xs font-medium text-white disabled:opacity-50">
                {actionId === editLead.id ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
