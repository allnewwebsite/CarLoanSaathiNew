import { useCallback, useEffect, useState } from "react";
import { api, getCachedGetData } from "../../services/api.js";

function optionsFromResponse(response) {
  const payload = response?.data ?? response ?? {};
  const rows = Array.isArray(payload) ? payload : payload.data || [];
  return rows
    .map((row) => ({
      dealershipId: String(row.dealershipId || row.id || "").trim(),
      dealershipName: String(row.dealershipName || row.name || row.dealershipId || row.id || "").trim(),
    }))
    .filter((row) => row.dealershipId)
    .sort((left, right) => left.dealershipName.localeCompare(right.dealershipName));
}

export function useBankDealershipOptions(enabled = true) {
  const cached = getCachedGetData("/bank/dealerships/options");
  const [dealerships, setDealerships] = useState(() => optionsFromResponse(cached));
  const [loading, setLoading] = useState(() => enabled && !cached);
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!enabled) return;
    if (!silent) setLoading(true);
    try {
      const response = await api.get("/bank/dealerships/options");
      setDealerships(optionsFromResponse(response));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => { load({ silent: Boolean(cached) }); }, [cached, load]);
  useEffect(() => {
    if (!enabled) return undefined;
    const refresh = (event) => {
      const type = event.detail?.eventType || event.detail?.event;
      if (["DEALERSHIP_APPROVED", "DEALERSHIP_UPDATED", "LEAD_ASSIGNED", "LEAD_REASSIGNED", "DEAD_CASE_CREATED", "LEAD_REJECTED", "LEAD_DISBURSED"].includes(type)) load({ silent: true });
    };
    window.addEventListener("cls:realtime-event", refresh);
    return () => window.removeEventListener("cls:realtime-event", refresh);
  }, [enabled, load]);

  return { dealerships, loading, reload: load };
}
