import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useCursorPager } from "../../hooks/useCursorPager.js";
import { mutationUrlMatches, useBackgroundRefresh, useRoleLeadRealtime } from "../../hooks/useRealtimeRefresh.js";
import { api, getCachedGetData } from "../../services/api.js";
import { BANK_MANAGER_PAGE_SIZE as pageSize } from "./BankManagerPanelParts.jsx";
import { responseRows } from "./bankManager.helpers.js";

const bankExecutiveMutationFilter = (detail) => mutationUrlMatches(detail, ["/bank/executives"]);
const leadMutationFilter = (detail) => mutationUrlMatches(detail, ["/bank/leads", "/dealer/leads", "/admin/leads", "/documents"]);

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
  const { cursorParamsForPage, rememberNextCursor } = useCursorPager([]);

  const load = useCallback(async (nextPage = page, { silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const targetPage = Math.max(Number(nextPage || 1), 1);
      const response = await api.get("/bank/dealerships", { params: { page: targetPage, limit: pageSize, ...cursorParamsForPage(targetPage) } });
      const nextRows = responseRows(response);
      setRows(nextRows);
      setHasMore(Boolean(response.data?.hasMore || response.data?.nextCursor));
      rememberNextCursor(targetPage, response.data?.nextCursor);
      setTotal(Number.isFinite(Number(response.data?.total)) ? Number(response.data.total) : (targetPage - 1) * pageSize + nextRows.length + (response.data?.hasMore || response.data?.nextCursor ? 1 : 0));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, cursorParamsForPage, rememberNextCursor]);

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
  const { cursorParamsForPage, rememberNextCursor } = useCursorPager([dealershipId || "", search || ""]);

  const load = useCallback(async (nextPage = page, { silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const targetPage = Math.max(Number(nextPage || 1), 1);
      const response = await api.get(url, { params: { page: targetPage, limit: pageSize, search, ...cursorParamsForPage(targetPage) } });
      const nextRows = responseRows(response);
      setRows(nextRows);
      setHasMore(Boolean(response.data?.hasMore || response.data?.nextCursor));
      rememberNextCursor(targetPage, response.data?.nextCursor);
      setTotal(Number.isFinite(Number(response.data?.total)) ? Number(response.data.total) : (targetPage - 1) * pageSize + nextRows.length + (response.data?.hasMore || response.data?.nextCursor ? 1 : 0));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, search, url, cursorParamsForPage, rememberNextCursor]);

  useEffect(() => { load(page, { silent: Boolean(cached) }); }, [load, page]);
  useRoleLeadRealtime({ onRefresh: () => load(page, { silent: true }), pageSize, mutationFilter: leadMutationFilter });
  const onPage = (nextPage) => setParams((current) => ({ ...Object.fromEntries(current.entries()), page: String(nextPage) }));
  return { rows, total, hasMore, loading, page, onPage };
}
