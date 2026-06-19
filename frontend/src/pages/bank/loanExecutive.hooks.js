import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BANK_STATUS_OPTIONS } from "../../constants/status.js";
import { useCursorPager } from "../../hooks/useCursorPager.js";
import { useRealtimeLeadPatch } from "../../hooks/useRealtimeEntityPatch.js";
import { useRoleLeadRealtime } from "../../hooks/useRealtimeRefresh.js";
import { api, getCachedGetData } from "../../services/api.js";
import { cachedLeadRows, scheduleLeadPrefetch } from "../../services/leadInstantData.js";
import { apiStatus, leadMutationFilter, LOAN_EXECUTIVE_PAGE_SIZE as pageSize, responseRows } from "./loanExecutive.helpers.js";

export function useExecutiveLeads({ search, status }) {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") || 1);
  const cached = getCachedGetData("/bank/leads", { page, limit: pageSize, search, status: status ? apiStatus(status) : "" });
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
      const response = await api.get("/bank/leads", { params: { page: requestPage, limit: pageSize, search, status: apiFilterStatus, ...cursorParamsForPage(requestPage) } });
      console.log("FULL RESPONSE", response);
      console.log("response.data", response?.data);
      console.log("response.data.data", response?.data?.data);
      console.log("response.data.leads", response?.data?.leads);
      console.log("response.data.items", response?.data?.items);
      const nextRows = responseRows(response);
      console.log("responseRows output", nextRows);
      console.log("responseRows count", Array.isArray(nextRows) ? nextRows.length : "not-array");
      console.log("LEADS BEFORE STATE", nextRows);
      console.log("SETROWS INPUT", nextRows.length, nextRows);
      setRows(nextRows);
      setHasMore(Boolean(response.data?.hasMore || response.data?.nextCursor));
      rememberNextCursor(requestPage, response.data?.nextCursor);
      setTotal(Number.isFinite(Number(response.data?.total)) ? Number(response.data.total) : (requestPage - 1) * pageSize + nextRows.length + (response.data?.hasMore || response.data?.nextCursor ? 1 : 0));
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [page, search, apiFilterStatus, cursorParamsForPage, rememberNextCursor, requestPageForPage]);
  useEffect(() => { load(page, { silent: true }); }, [load, page]);
  useEffect(() => {
    scheduleLeadPrefetch("/bank/leads", BANK_STATUS_OPTIONS.map(apiStatus), { limit: pageSize, search: search || "" });
  }, [search]);
  const realtimeRefresh = useCallback(() => load(page, { silent: true }), [load, page]);
  const setRowsWithPatchLogging = useCallback((updater) => {
    setRows((current) => {
      console.log("PATCH ROWS BEFORE", current.length, current);
      const next = typeof updater === "function" ? updater(current) : updater;
      console.log("PATCH ROWS AFTER", Array.isArray(next) ? next.length : "not-array", next);
      return next;
    });
  }, []);
  useRealtimeLeadPatch({ setRows: setRowsWithPatchLogging, statusFilter: status ? apiStatus(status) : "" });
  useRoleLeadRealtime({ onRefresh: realtimeRefresh, pageSize, mutationFilter: leadMutationFilter });
  const onPage = (nextPage) => setParams((current) => ({ ...Object.fromEntries(current.entries()), page: String(nextPage) }));
  return { rows, total, hasMore, loading, page, onPage, load };
}
