import { useCallback, useEffect, useState } from "react";
import { CURRENT_WORKFLOW_STATUS_OPTIONS } from "../../../constants/status.js";
import { LEAD_LIFECYCLE_STATES } from "../../../constants/status.js";
import { useCursorPager } from "../../../hooks/useCursorPager.js";
import { useRealtimeLeadPatch } from "../../../hooks/useRealtimeEntityPatch.js";
import { mutationUrlMatches, useBackgroundRefresh, useRoleLeadRealtime } from "../../../hooks/useRealtimeRefresh.js";
import { api, getCachedGetData } from "../../../services/api.js";
import { normalizePagedResponse } from "../../../services/apiResponse.js";
import { cachedLeadRows, scheduleLeadPrefetch } from "../../../services/leadInstantData.js";
import { pageSize } from "./GmTrackingParts.jsx";

const leadMutationFilter = (detail) => mutationUrlMatches(detail, ["/gm/leads", "/dealer/leads", "/bank/leads", "/documents"]);
const salespersonMutationFilter = (detail) => mutationUrlMatches(detail, ["/gm/salespersons", "/dealer/salespersons"]);

export function useGmLeads(filters = {}) {
  const initialParams = { page: 1, limit: pageSize, ...filters };
  const cached = getCachedGetData("/gm/leads", initialParams);
  const fallbackRows = cached ? [] : cachedLeadRows("/gm/leads", { status: filters.status, search: filters.search, limit: pageSize });
  const cachedPayload = cached
    ? normalizePagedResponse(cached, { defaultLimit: pageSize })
    : { data: fallbackRows, total: fallbackRows.length, hasMore: false, nextCursor: "" };
  const [leads, setLeads] = useState(() => cachedPayload.data);
  const [total, setTotal] = useState(() => cachedPayload.total);
  const [hasMore, setHasMore] = useState(() => Boolean(cachedPayload.hasMore || cachedPayload.nextCursor));
  const [loading, setLoading] = useState(false);
  const { cursorParamsForPage, rememberNextCursor, requestPageForPage } = useCursorPager([filters.search || "", filters.status || "", filters.salespersonId || ""]);

  const load = useCallback(async (next = {}) => {
    const silent = next.silent === true;
    if (!silent) setLoading(true);
    try {
      const { silent: _silent, ...params } = next;
      const targetPage = Math.max(Number(params.page || filters.page || 1), 1);
      const requestPage = requestPageForPage(targetPage);
      const response = await api.get("/gm/leads", { params: { page: requestPage, limit: pageSize, ...filters, ...params, ...cursorParamsForPage(requestPage) } });
      const payload = normalizePagedResponse(response, { defaultLimit: pageSize });
      const rows = payload.data || [];
      setLeads(rows);
      setHasMore(Boolean(payload.hasMore || payload.nextCursor));
      rememberNextCursor(requestPage, payload.nextCursor);
      setTotal(Number.isFinite(Number(payload.total)) ? Number(payload.total) : (requestPage - 1) * pageSize + rows.length + (payload.hasMore || payload.nextCursor ? 1 : 0));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filters.search, filters.status, filters.salespersonId, filters.page, cursorParamsForPage, rememberNextCursor, requestPageForPage]);

  useEffect(() => {
    load({ silent: true });
  }, [load]);
  useEffect(() => {
    return scheduleLeadPrefetch("/gm/leads", CURRENT_WORKFLOW_STATUS_OPTIONS, { limit: pageSize, search: filters.search || "" });
  }, [filters.search]);

  useRealtimeLeadPatch({ setRows: setLeads, setTotal, statusFilter: filters.status, lifecycleFilter: filters.archiveTerminal ? (filters.status === "DISBURSED" ? LEAD_LIFECYCLE_STATES.DISBURSED : LEAD_LIFECYCLE_STATES.REJECTED) : LEAD_LIFECYCLE_STATES.ACTIVE, pageSize });
  useRoleLeadRealtime({ onRefresh: load, pageSize, mutationFilter: leadMutationFilter, refreshOnMutation: false });

  return { leads, total, hasMore, loading, load };
}

export function useSalespersons() {
  const cachedSalespersons = getCachedGetData("/gm/salespersons");
  const [salespersons, setSalespersons] = useState(() => cachedSalespersons || []);
  const [loading, setLoading] = useState(() => !cachedSalespersons);
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get("/gm/salespersons");
      setSalespersons(response.data || []);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load({ silent: Boolean(cachedSalespersons) }); }, [load]);
  useBackgroundRefresh({ onRefresh: load, refreshKey: "gm-salespersons", mutationFilter: salespersonMutationFilter });

  return { salespersons, loading };
}
