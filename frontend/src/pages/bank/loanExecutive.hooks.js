import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CURRENT_WORKFLOW_STATUS_OPTIONS } from "../../constants/status.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { useCursorPager } from "../../hooks/useCursorPager.js";
import { useRealtimeLeadPatch } from "../../hooks/useRealtimeEntityPatch.js";
import { useRoleLeadRealtime } from "../../hooks/useRealtimeRefresh.js";
import { api, getCachedGetData } from "../../services/api.js";
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
  const { cursorParamsForPage, rememberNextCursor, requestPageForPage } = useCursorPager([search || "", status || ""]);
  const load = useCallback(async (nextPage = page, options = {}) => {
    if (!options.silent) setLoading(true);
    try {
      const targetPage = Math.max(Number(nextPage || 1), 1);
      const requestPage = requestPageForPage(targetPage);
      const response = await api.get("/bank/leads", { params: { page: requestPage, limit: pageSize, search, globalSearch: search ? "1" : "", status: apiFilterStatus, archiveTerminal, ...cursorParamsForPage(requestPage) } });
      const nextRows = responseRows(response);
      setRows(nextRows);
      setHasMore(Boolean(response.data?.hasMore || response.data?.nextCursor));
      rememberNextCursor(requestPage, response.data?.nextCursor);
      setTotal(Number.isFinite(Number(response.data?.total)) ? Number(response.data.total) : (requestPage - 1) * pageSize + nextRows.length + (response.data?.hasMore || response.data?.nextCursor ? 1 : 0));
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [page, search, apiFilterStatus, archiveTerminal, cursorParamsForPage, rememberNextCursor, requestPageForPage]);
  useEffect(() => { load(page, { silent: true }); }, [load, page]);
  useEffect(() => {
    scheduleLeadPrefetch("/bank/leads", CURRENT_WORKFLOW_STATUS_OPTIONS.map(apiStatus), { limit: pageSize, search: search || "" });
  }, [search]);
  const realtimeRefresh = useCallback(() => load(page, { silent: true }), [load, page]);
  useRealtimeLeadPatch({ setRows, setTotal, statusFilter: status ? apiStatus(status) : "", pageSize, user });
  useRoleLeadRealtime({ onRefresh: realtimeRefresh, pageSize, mutationFilter: leadMutationFilter, refreshOnMutation: false });
  const onPage = (nextPage) => setParams((current) => ({ ...Object.fromEntries(current.entries()), page: String(nextPage) }));
  return { rows, total, hasMore, loading, page, onPage, load };
}
