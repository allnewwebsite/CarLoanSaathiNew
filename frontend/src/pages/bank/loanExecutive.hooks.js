import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CURRENT_WORKFLOW_STATUS_OPTIONS } from "../../constants/status.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useCursorPager } from "../../hooks/useCursorPager.js";
import { useRealtimeLeadPatch } from "../../hooks/useRealtimeEntityPatch.js";
import { useRoleLeadRealtime } from "../../hooks/useRealtimeRefresh.js";
import { api, getCachedGetData, invalidateGetCache } from "../../services/api.js";
import { cachedLeadRows, scheduleLeadPrefetch } from "../../services/leadInstantData.js";
import { apiStatus, leadMutationFilter, LOAN_EXECUTIVE_PAGE_SIZE as pageSize, responseRows } from "./loanExecutive.helpers.js";

export function useExecutiveLeads({ search, status, archiveTerminal: archiveOverride = "" }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") || 1);
  const archiveTerminal = archiveOverride || params.get("archiveTerminal") || "";
  const cached = getCachedGetData("/bank/leads", { page, limit: pageSize, search, status: status ? apiStatus(status) : "", archiveTerminal });
  const apiFilterStatus = status ? apiStatus(status) : "";
  const fallbackRows = cached ? [] : cachedLeadRows("/bank/leads", { status: apiFilterStatus, search, limit: pageSize });
  const cachedRows = cached ? responseRows({ data: cached }) : fallbackRows;
  const [rows, setRows] = useState(() => cachedRows);
  const [total, setTotal] = useState(() => cached?.total || cachedRows.length);
  const [hasMore, setHasMore] = useState(() => Boolean(cached?.hasMore || cached?.nextCursor));
  const [loading, setLoading] = useState(false);
  const freshRequestRef = useRef(null);
  const { cursorParamsForPage, rememberNextCursor, requestPageForPage } = useCursorPager([search || "", status || ""]);
  const load = useCallback(async (nextPage = page, options = {}) => {
    if (!options.silent) setLoading(true);
    try {
      const targetPage = Math.max(Number(nextPage || 1), 1);
      const requestPage = requestPageForPage(targetPage);
      invalidateGetCache({ prefix: "/bank/leads", purge: true });
      const response = await api.get("/bank/leads", {
        skipCache: true,
        params: { page: requestPage, limit: pageSize, search, globalSearch: search ? "1" : "", status: apiFilterStatus, archiveTerminal, ...cursorParamsForPage(requestPage) },
      });
      const nextRows = responseRows(response);
      setRows(nextRows);
      setHasMore(Boolean(response.data?.hasMore || response.data?.nextCursor));
      rememberNextCursor(requestPage, response.data?.nextCursor);
      setTotal(Number.isFinite(Number(response.data?.total)) ? Number(response.data.total) : (requestPage - 1) * pageSize + nextRows.length + (response.data?.hasMore || response.data?.nextCursor ? 1 : 0));
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [page, search, apiFilterStatus, archiveTerminal, cursorParamsForPage, rememberNextCursor, requestPageForPage]);
  const refreshLatest = useCallback((nextPage = page, options = { silent: true }) => {
    if (freshRequestRef.current) return freshRequestRef.current;
    const request = load(nextPage, options).finally(() => {
      if (freshRequestRef.current === request) freshRequestRef.current = null;
    });
    freshRequestRef.current = request;
    return request;
  }, [load, page]);
  useEffect(() => { refreshLatest(page, { silent: true }); }, [page, refreshLatest]);
  useEffect(() => {
    const refreshVisiblePage = () => {
      if (document.visibilityState && document.visibilityState !== "visible") return;
      refreshLatest(page, { silent: true });
    };
    window.addEventListener("focus", refreshVisiblePage);
    document.addEventListener("visibilitychange", refreshVisiblePage);
    return () => {
      window.removeEventListener("focus", refreshVisiblePage);
      document.removeEventListener("visibilitychange", refreshVisiblePage);
    };
  }, [page, refreshLatest]);
  useEffect(() => {
    const reconcileOwnership = (event) => {
      const eventType = String(event?.detail?.eventType || event?.detail?.event || "");
      if (!["LEAD_ASSIGNED", "EXECUTIVE_ASSIGNED", "LEAD_REASSIGNED", "EXECUTIVE_REASSIGNED", "LEAD_ACCEPTED", "LEAD_STATUS_UPDATED", "STATUS_UPDATED", "DEAD_CASE_CREATED", "LEAD_MARKED_DEAD", "LEAD_DISBURSED", "LEAD_REJECTED"].includes(eventType)) return;
      refreshLatest(page, { silent: true });
    };
    window.addEventListener("cls:realtime-event", reconcileOwnership);
    return () => window.removeEventListener("cls:realtime-event", reconcileOwnership);
  }, [page, refreshLatest]);
  useEffect(() => {
    return scheduleLeadPrefetch("/bank/leads", CURRENT_WORKFLOW_STATUS_OPTIONS.map(apiStatus), { limit: pageSize, search: search || "" });
  }, [search]);
  const realtimeRefresh = useCallback(() => refreshLatest(page, { silent: true }), [page, refreshLatest]);
  useRealtimeLeadPatch({ setRows, setTotal, statusFilter: status ? apiStatus(status) : "", pageSize, user });
  useRoleLeadRealtime({ onRefresh: realtimeRefresh, pageSize, mutationFilter: leadMutationFilter, refreshOnMutation: false });
  const applyLeadPatch = useCallback((lead = {}) => {
    const identity = String(lead.id || lead.leadId || lead.caseId || "");
    if (!identity) return;
    setRows((current) => current.map((row) => {
      const rowIdentity = String(row.id || row.leadId || row.caseId || "");
      return rowIdentity === identity ? { ...row, ...lead } : row;
    }));
  }, []);
  const onPage = (nextPage) => setParams((current) => ({ ...Object.fromEntries(current.entries()), page: String(nextPage) }));
  return { rows, total, hasMore, loading, page, onPage, load, refreshLatest, applyLeadPatch };
}
