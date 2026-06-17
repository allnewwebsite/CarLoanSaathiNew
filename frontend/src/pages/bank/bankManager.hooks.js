import { useCallback, useEffect, useState } from "react";
import { mutationUrlMatches, useBackgroundRefresh } from "../../hooks/useRealtimeRefresh.js";
import { api, getCachedGetData } from "../../services/api.js";
import { responseRows } from "./bankManager.helpers.js";

const bankExecutiveMutationFilter = (detail) => mutationUrlMatches(detail, ["/bank/executives"]);

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
