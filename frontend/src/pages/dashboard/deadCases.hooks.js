import { useCallback, useEffect, useState } from "react";
import { useCursorPager } from "../../hooks/useCursorPager.js";
import { api, getCachedGetData } from "../../services/api.js";
import { DEAD_CASE_ENDPOINTS, PAGE_SIZE, sameLead } from "./deadCases.helpers.js";

const DEAD_CASE_REALTIME_EVENTS = new Set([
  "DEAD_CASE_CREATED",
  "DEAD_CASE_RESTORED",
  "DEAD_CASE_UPDATED",
  "LEAD_MARKED_DEAD",
  "LEAD_RESTORED_FROM_DEAD",
]);

export function useDeadCasesPageState(audience = "finance") {
  const endpoint = DEAD_CASE_ENDPOINTS[audience] || DEAD_CASE_ENDPOINTS.finance;
  const canModify = audience === "finance";
  const initialParams = { page: 1, limit: PAGE_SIZE };
  const cachedPayload = getCachedGetData(endpoint, initialParams);
  const initialPayload = Array.isArray(cachedPayload) ? { data: cachedPayload } : cachedPayload || {};
  const [reasonFilter, setReasonFilter] = useState("");
  const [rows, setRows] = useState(() => initialPayload.data || []);
  const [loading, setLoading] = useState(() => !cachedPayload);
  const [actionId, setActionId] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(() => Boolean(initialPayload.hasMore || initialPayload.nextCursor));
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
  const { cursorParamsForPage, rememberNextCursor, requestPageForPage } = useCursorPager([endpoint, reasonFilter]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const requestPage = requestPageForPage(page);
      const cursor = cursorParamsForPage(requestPage);
      const response = await api.get(endpoint, {
        params: {
          page: requestPage,
          limit: PAGE_SIZE,
          deadCaseReason: reasonFilter || undefined,
          ...cursor,
        },
      });
      const payload = Array.isArray(response.data) ? { data: response.data } : response.data || {};
      setRows(payload.data || []);
      setHasMore(Boolean(payload.hasMore || payload.nextCursor));
      rememberNextCursor(requestPage, payload.nextCursor);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [cursorParamsForPage, endpoint, page, reasonFilter, rememberNextCursor, requestPageForPage]);

  useEffect(() => {
    load({ silent: Boolean(cachedPayload) });
  }, [load]);

  useEffect(() => {
    const refreshOnDeadCase = (event) => {
      const type = event.detail?.eventType || event.detail?.event;
      if (!DEAD_CASE_REALTIME_EVENTS.has(type)) return;
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

  const setReasonAndResetPage = useCallback((value) => {
    setReasonFilter(value);
    setPage(1);
  }, []);

  return {
    actionId,
    addError,
    addNotes,
    addOpen,
    addReason,
    addSaving,
    canModify,
    caseNumber,
    editError,
    editLead,
    editNotes,
    editReason,
    hasMore,
    loading,
    openAdd,
    openEdit,
    page,
    reasonFilter,
    restoreCase,
    rows,
    saveEdit,
    setAddNotes,
    setAddOpen,
    setAddReason,
    setCaseNumber,
    setEditLead,
    setEditNotes,
    setEditReason,
    setPage,
    setReasonFilter: setReasonAndResetPage,
    submitAdd,
  };
}
