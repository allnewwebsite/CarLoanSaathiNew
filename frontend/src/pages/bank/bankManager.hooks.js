import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CURRENT_WORKFLOW_STATUS_OPTIONS, LEAD_STATUSES } from "../../constants/status.js";
import { useCursorPager } from "../../hooks/useCursorPager.js";
import { mutationUrlMatches, useBackgroundRefresh, useRoleLeadRealtime } from "../../hooks/useRealtimeRefresh.js";
import { useRealtimeLeadPatch } from "../../hooks/useRealtimeEntityPatch.js";
import { api, getCachedGetData } from "../../services/api.js";
import { cachedLeadRows, scheduleLeadPrefetch } from "../../services/leadInstantData.js";
import { BANK_MANAGER_PAGE_SIZE as pageSize } from "./BankManagerPanelParts.jsx";
import { responseRows } from "./bankManager.helpers.js";

const bankExecutiveMutationFilter = (detail) => mutationUrlMatches(detail, ["/bank/executives"]);
const leadMutationFilter = (detail) => mutationUrlMatches(detail, ["/bank/leads", "/dealer/leads", "/admin/leads", "/documents"]);
const bankAnalyticsMutationFilter = (detail) => mutationUrlMatches(detail, ["/bank/leads", "/dealer/leads", "/admin/leads", "/documents", "/banks"]);

export function useBankLeads(search, status = "", archiveOverride = "") {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") || 1);
  const archiveTerminal = archiveOverride || params.get("archiveTerminal") || "";
  const cached = getCachedGetData("/bank/leads", { page, limit: pageSize, search, status, archiveTerminal });
  const fallbackRows = cached ? [] : cachedLeadRows("/bank/leads", { status, search, limit: pageSize });
  const cachedRows = cached ? responseRows({ data: cached }) : fallbackRows;
  const [rows, setRows] = useState(() => cachedRows);
  const [total, setTotal] = useState(() => cached?.total || cachedRows.length);
  const [hasMore, setHasMore] = useState(() => Boolean(cached?.hasMore || cached?.nextCursor));
  const [loading, setLoading] = useState(false);
  const { cursorParamsForPage, rememberNextCursor, requestPageForPage } = useCursorPager([search || "", status || ""]);

  const load = useCallback(async (nextPage = page, { silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const targetPage = Math.max(Number(nextPage || 1), 1);
      const requestPage = requestPageForPage(targetPage);
      const response = await api.get("/bank/leads", { params: { page: requestPage, limit: pageSize, search, globalSearch: search ? "1" : "", status, archiveTerminal, ...cursorParamsForPage(requestPage) } });
      const nextRows = responseRows(response);
      setRows(nextRows);
      setHasMore(Boolean(response.data?.hasMore || response.data?.nextCursor));
      rememberNextCursor(requestPage, response.data?.nextCursor);
      setTotal(Number.isFinite(Number(response.data?.total)) ? Number(response.data.total) : (requestPage - 1) * pageSize + nextRows.length + (response.data?.hasMore || response.data?.nextCursor ? 1 : 0));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, search, status, archiveTerminal, cursorParamsForPage, rememberNextCursor, requestPageForPage]);

  useEffect(() => { load(page, { silent: true }); }, [load, page]);
  useEffect(() => {
    return scheduleLeadPrefetch("/bank/leads", CURRENT_WORKFLOW_STATUS_OPTIONS, { limit: pageSize, search: search || "" });
  }, [search]);
  const realtimeRefresh = useCallback(() => load(page, { silent: true }), [load, page]);
  useRealtimeLeadPatch({ setRows, setTotal, statusFilter: status, pageSize });
  useRoleLeadRealtime({ onRefresh: realtimeRefresh, pageSize, mutationFilter: leadMutationFilter, refreshOnMutation: false });
  const onPage = (nextPage) => setParams((current) => ({ ...Object.fromEntries(current.entries()), page: String(nextPage) }));
  return { rows, total, hasMore, loading, page, onPage, load };
}

export function useBankAnalytics() {
  const cachedAnalytics = getCachedGetData("/bank/analytics");
  const [data, setData] = useState(() => cachedAnalytics);
  const [loading, setLoading] = useState(() => !cachedAnalytics);
  const [error, setError] = useState("");

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const response = await api.get("/bank/analytics");
      const payload = response.data || {};
      setData(payload);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Unable to load bank analytics");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load({ silent: Boolean(cachedAnalytics) }); }, [load]);
  useRoleLeadRealtime({ onRefresh: () => load({ silent: true }), pageSize, mutationFilter: bankAnalyticsMutationFilter });
  return { data, loading, error, load };
}

export function useExecutives() {
  const cached = getCachedGetData("/bank/executives");
  const [rows, setRows] = useState(() => responseRows({ data: cached }));
  const [loading, setLoading] = useState(() => !cached);
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get("/bank/executives");
      setRows(responseRows(response));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);
  useEffect(() => { load({ silent: Boolean(cached) }); }, [load]);
  useBackgroundRefresh({ onRefresh: load, refreshKey: "bank-executives", mutationFilter: bankExecutiveMutationFilter });
  return { rows, loading, load };
}

export function useExecutiveCases(executiveId) {
  const [payload, setPayload] = useState({ data: [], executive: null });
  const [loading, setLoading] = useState(true);
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get(`/bank/executives/${executiveId}/cases`);
      setPayload({ data: responseRows(response), executive: response.data?.executive || null });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [executiveId]);
  useEffect(() => { load(); }, [load]);
  useBackgroundRefresh({ onRefresh: load, refreshKey: "bank-executive-cases", mutationFilter: leadMutationFilter });
  return { payload, loading };
}

export function useBankDealerships() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") || 1);
  const cached = getCachedGetData("/bank/dealerships", { page, limit: pageSize });
  const cachedRows = responseRows({ data: cached });
  const [rows, setRows] = useState(() => cachedRows);
  const [total, setTotal] = useState(() => cached?.total || cachedRows.length);
  const [hasMore, setHasMore] = useState(() => Boolean(cached?.hasMore || cached?.nextCursor));
  const [loading, setLoading] = useState(() => !cached);
  const { cursorParamsForPage, rememberNextCursor, requestPageForPage } = useCursorPager([]);

  const load = useCallback(async (nextPage = page, { silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const targetPage = Math.max(Number(nextPage || 1), 1);
      const requestPage = requestPageForPage(targetPage);
      const response = await api.get("/bank/dealerships", { params: { page: requestPage, limit: pageSize, ...cursorParamsForPage(requestPage) } });
      const nextRows = responseRows(response);
      setRows(nextRows);
      setHasMore(Boolean(response.data?.hasMore || response.data?.nextCursor));
      rememberNextCursor(requestPage, response.data?.nextCursor);
      setTotal(Number.isFinite(Number(response.data?.total)) ? Number(response.data.total) : (requestPage - 1) * pageSize + nextRows.length + (response.data?.hasMore || response.data?.nextCursor ? 1 : 0));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, cursorParamsForPage, rememberNextCursor, requestPageForPage]);

  useEffect(() => { load(page, { silent: Boolean(cached) }); }, [load, page]);
  useRoleLeadRealtime({ onRefresh: () => load(page, { silent: true }), pageSize, mutationFilter: leadMutationFilter });
  const onPage = (nextPage) => setParams((current) => ({ ...Object.fromEntries(current.entries()), page: String(nextPage) }));
  return { rows, total, hasMore, loading, page, onPage };
}

export function useBankDealershipDisbursedCases(dealershipId, search) {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") || 1);
  const url = `/bank/dealerships/${encodeURIComponent(dealershipId)}/disbursed`;
  const cached = getCachedGetData(url, { page, limit: pageSize, search });
  const cachedRows = responseRows({ data: cached });
  const [rows, setRows] = useState(() => cachedRows);
  const [total, setTotal] = useState(() => cached?.total || cachedRows.length);
  const [hasMore, setHasMore] = useState(() => Boolean(cached?.hasMore || cached?.nextCursor));
  const [loading, setLoading] = useState(() => !cached);
  const { cursorParamsForPage, rememberNextCursor, requestPageForPage } = useCursorPager([dealershipId || "", search || ""]);

  const load = useCallback(async (nextPage = page, { silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const targetPage = Math.max(Number(nextPage || 1), 1);
      const requestPage = requestPageForPage(targetPage);
      const response = await api.get(url, { params: { page: requestPage, limit: pageSize, search, ...cursorParamsForPage(requestPage) } });
      const nextRows = responseRows(response);
      setRows(nextRows);
      setHasMore(Boolean(response.data?.hasMore || response.data?.nextCursor));
      rememberNextCursor(requestPage, response.data?.nextCursor);
      setTotal(Number.isFinite(Number(response.data?.total)) ? Number(response.data.total) : (requestPage - 1) * pageSize + nextRows.length + (response.data?.hasMore || response.data?.nextCursor ? 1 : 0));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, search, url, cursorParamsForPage, rememberNextCursor, requestPageForPage]);

  useEffect(() => { load(page, { silent: Boolean(cached) }); }, [load, page]);
  useRealtimeLeadPatch({ setRows, setTotal, statusFilter: LEAD_STATUSES.DISBURSED, pageSize });
  useRoleLeadRealtime({ onRefresh: () => load(page, { silent: true }), pageSize, mutationFilter: leadMutationFilter, refreshOnMutation: false });
  const onPage = (nextPage) => setParams((current) => ({ ...Object.fromEntries(current.entries()), page: String(nextPage) }));
  return { rows, total, hasMore, loading, page, onPage };
}
