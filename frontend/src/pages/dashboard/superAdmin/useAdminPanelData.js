import { useCallback, useEffect, useState } from "react";
import { ADMIN_STATUS_OPTIONS, BANK_STATUS_OPTIONS, LEAD_STATUSES, statusLabel } from "../../../constants/status.js";
import { useRoleLeadRealtime } from "../../../hooks/useRealtimeRefresh.js";
import { useRealtimeLeadPatch } from "../../../hooks/useRealtimeEntityPatch.js";
import { api, getCachedGetData } from "../../../services/api.js";
import { normalizeRows } from "../../../services/apiResponse.js";
import { cachedLeadRows, scheduleLeadPrefetch } from "../../../services/leadInstantData.js";
import { SUPER_ADMIN_PAGE_SIZE as pageSize } from "./superAdmin.helpers.js";
import { adminPlatformMutationFilter } from "./superAdmin.hooks.js";

export const STATUS_FILTERS = BANK_STATUS_OPTIONS.map((value) => ({ label: statusLabel(value), value }));

function responseRows(response) {
  return normalizeRows(response);
}

function adminPanelRequest(mode, search, leadFilter) {
  if (mode === "dealerships") return { url: "/admin/approvals/dealerships", params: { status: "approved", search } };
  if (mode === "approval-dealerships") return { url: "/admin/approvals/dealerships", params: { status: "pending", search } };
  if (mode === "banks") return { url: "/admin/approvals/banks", params: { status: "approved", search } };
  if (mode === "approval-banks") return { url: "/admin/approvals/banks", params: { status: "pending", search } };
  if (mode === "status") return { url: "/admin/leads", params: { status: leadFilter || LEAD_STATUSES.NEW, search } };
  return { url: "/admin/leads", params: { search } };
}

export function useAdminPanelData(mode, search, leadFilter) {
  const initialRequest = adminPanelRequest(mode, search, leadFilter);
  const cached = getCachedGetData(initialRequest.url, initialRequest.params);
  const fallbackRows = !cached && initialRequest.url === "/admin/leads"
    ? cachedLeadRows("/admin/leads", { status: mode === "status" ? leadFilter || LEAD_STATUSES.NEW : "", search, limit: pageSize })
    : [];
  const [rows, setRows] = useState(() => (cached ? responseRows({ data: cached }) : fallbackRows));
  const [loading, setLoading] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const request = adminPanelRequest(mode, search, leadFilter);
      const response = await api.get(request.url, { params: request.params });
      setRows(responseRows(response));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [leadFilter, mode, search]);

  useEffect(() => { load({ silent: true }); }, [load]);
  useEffect(() => {
    if (mode === "status" || mode === "leads") {
      scheduleLeadPrefetch("/admin/leads", ADMIN_STATUS_OPTIONS, { limit: pageSize, search: search || "" });
    }
  }, [mode, search]);

  const leadGridMode = mode === "status" || mode === "leads";
  useRealtimeLeadPatch({ setRows, statusFilter: mode === "status" ? leadFilter || LEAD_STATUSES.NEW : "", enabled: leadGridMode, pageSize });
  useRoleLeadRealtime({ onRefresh: load, pageSize, mutationFilter: adminPlatformMutationFilter, refreshOnMutation: !leadGridMode });

  return { rows, loading, load };
}
