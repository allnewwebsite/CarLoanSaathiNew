import { useCallback, useEffect, useState } from "react";
import { CURRENT_WORKFLOW_STATUS_OPTIONS } from "../../../constants/status.js";
import { useCursorPager } from "../../../hooks/useCursorPager.js";
import { useRealtimeLeadPatch } from "../../../hooks/useRealtimeEntityPatch.js";
import { mutationUrlMatches, useRoleLeadRealtime } from "../../../hooks/useRealtimeRefresh.js";
import { api, getCachedGetData } from "../../../services/api.js";
import { normalizePagedResponse } from "../../../services/apiResponse.js";
import { cachedLeadRows, scheduleLeadPrefetch } from "../../../services/leadInstantData.js";
import { FINANCE_PAGE_SIZE as pageSize } from "./FinanceDeskPanelParts.jsx";

const leadMutationFilter = (detail) => mutationUrlMatches(detail, ["/dealer/leads", "/dealer/dead-cases", "/bank/leads", "/gm/leads", "/documents"]);

export function useDealerLeads(filters = {}) {
  const initialParams = { page: 1, limit: pageSize, ...filters };
  const cached = getCachedGetData("/dealer/leads", initialParams);
  const fallbackRows = cached ? [] : cachedLeadRows("/dealer/leads", { status: filters.status, search: filters.search, limit: pageSize });
  const cachedPayload = cached
    ? normalizePagedResponse(cached, { defaultLimit: pageSize })
    : { data: fallbackRows, total: fallbackRows.length, hasMore: false, nextCursor: "" };
  const [leads, setLeads] = useState(() => cachedPayload?.data || []);
  const [total, setTotal] = useState(() => cachedPayload?.total || 0);
  const [hasMore, setHasMore] = useState(() => Boolean(cachedPayload?.hasMore || cachedPayload?.nextCursor));
  const [loading, setLoading] = useState(false);
  const { cursorParamsForPage, rememberNextCursor, requestPageForPage } = useCursorPager([filters.status || "", filters.salespersonId || "", filters.financeManagerId || "", filters.search || ""]);

  const loadLeads = useCallback(async (next = {}) => {
    const silent = next.silent === true;
    if (!silent) setLoading(true);
    try {
      const { silent: _silent, ...params } = next;
      const targetPage = Math.max(Number(params.page || 1), 1);
      const requestPage = requestPageForPage(targetPage);
      const response = await api.get("/dealer/leads", { params: { page: requestPage, limit: pageSize, ...filters, ...params, ...cursorParamsForPage(requestPage) } });
      const payload = normalizePagedResponse(response, { defaultLimit: pageSize });
      const rows = payload.data || [];
      setLeads(rows);
      setHasMore(Boolean(payload.hasMore || payload.nextCursor));
      rememberNextCursor(requestPage, payload.nextCursor);
      setTotal(Number.isFinite(Number(payload.total)) ? Number(payload.total) : (requestPage - 1) * pageSize + rows.length + (payload.hasMore || payload.nextCursor ? 1 : 0));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filters.status, filters.salespersonId, filters.financeManagerId, filters.search, filters.page, cursorParamsForPage, rememberNextCursor, requestPageForPage]);

  useEffect(() => {
    loadLeads({ silent: true });
  }, [loadLeads]);
  useEffect(() => {
    scheduleLeadPrefetch("/dealer/leads", CURRENT_WORKFLOW_STATUS_OPTIONS, { limit: pageSize, search: filters.search || "" });
  }, [filters.search]);

  useRealtimeLeadPatch({ setRows: setLeads, setTotal, statusFilter: filters.status, pageSize });
  useRoleLeadRealtime({ onRefresh: loadLeads, pageSize, mutationFilter: leadMutationFilter, refreshOnMutation: false });

  return { leads, total, hasMore, loading, loadLeads };
}
