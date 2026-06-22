import { useCallback, useEffect, useState } from "react";
import { useRoleLeadRealtime } from "../../../hooks/useRealtimeRefresh.js";
import { api, getCachedGetData } from "../../../services/api.js";
import { normalizeRows } from "../../../services/apiResponse.js";
import { cachedLeadRows } from "../../../services/leadInstantData.js";
import { SUPER_ADMIN_PAGE_SIZE as pageSize } from "./superAdmin.helpers.js";
import { adminPlatformMutationFilter } from "./superAdmin.hooks.js";

function responseRows(response) {
  return normalizeRows(response);
}

function adminPanelRequest(mode, search) {
  if (mode === "dealerships") return { url: "/admin/approvals/dealerships", params: { status: "approved", search } };
  if (mode === "approval-dealerships") return { url: "/admin/approvals/dealerships", params: { status: "pending", search } };
  if (mode === "banks") return { url: "/admin/approvals/banks", params: { status: "approved", search } };
  if (mode === "approval-banks") return { url: "/admin/approvals/banks", params: { status: "pending", search } };
  return { url: "/admin/leads", params: { search } };
}

export function useAdminPanelData(mode, search) {
  const initialRequest = adminPanelRequest(mode, search);
  const cached = getCachedGetData(initialRequest.url, initialRequest.params);
  const fallbackRows = !cached && initialRequest.url === "/admin/leads"
    ? cachedLeadRows("/admin/leads", { search, limit: pageSize })
    : [];
  const [rows, setRows] = useState(() => (cached ? responseRows({ data: cached }) : fallbackRows));
  const [loading, setLoading] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const request = adminPanelRequest(mode, search);
      const response = await api.get(request.url, { params: request.params });
      setRows(responseRows(response));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [mode, search]);

  useEffect(() => { load({ silent: true }); }, [load]);

  useRoleLeadRealtime({ onRefresh: load, pageSize, mutationFilter: adminPlatformMutationFilter, refreshOnMutation: true });

  return { rows, loading, load };
}
