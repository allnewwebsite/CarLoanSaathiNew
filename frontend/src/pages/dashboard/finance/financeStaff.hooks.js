import { useCallback, useEffect, useState } from "react";
import { mutationUrlMatches, useBackgroundRefresh } from "../../../hooks/useRealtimeRefresh.js";
import { api, getCachedGetData } from "../../../services/api.js";

const salespersonMutationFilter = (detail) => mutationUrlMatches(detail, ["/dealer/salespersons"]);
const financeManagerMutationFilter = (detail) => mutationUrlMatches(detail, ["/dealer/finance-managers"]);
const activeMemberMutationFilter = (detail) => mutationUrlMatches(detail, ["/dealer/active-members", "/dealer/salespersons", "/dealer/finance-managers", "/dealer/staff"]);

export function useSalespersons({ includeInactive = false } = {}) {
  const cachedSalespersons = getCachedGetData("/dealer/salespersons", { includeInactive }) || getCachedGetData("/dealer/salespersons");
  const [salespersons, setSalespersons] = useState(() => cachedSalespersons || []);
  const [loading, setLoading] = useState(() => !cachedSalespersons);
  const loadSalespersons = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get("/dealer/salespersons", { params: { includeInactive } });
      setSalespersons(response.data || []);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [includeInactive]);
  useEffect(() => { loadSalespersons({ silent: Boolean(cachedSalespersons) }); }, [loadSalespersons]);
  useBackgroundRefresh({ onRefresh: loadSalespersons, refreshKey: "finance-salespersons", mutationFilter: salespersonMutationFilter });
  return { salespersons, loading, loadSalespersons };
}

export function useFinanceManagers({ includeInactive = false } = {}) {
  const cachedManagers = getCachedGetData("/dealer/finance-managers", { includeInactive }) || getCachedGetData("/dealer/finance-managers");
  const [financeManagers, setFinanceManagers] = useState(() => cachedManagers || []);
  const [loading, setLoading] = useState(() => !cachedManagers);
  const loadFinanceManagers = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get("/dealer/finance-managers", { params: { includeInactive } });
      setFinanceManagers(response.data || []);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [includeInactive]);
  useEffect(() => { loadFinanceManagers({ silent: Boolean(cachedManagers) }); }, [loadFinanceManagers]);
  useBackgroundRefresh({ onRefresh: loadFinanceManagers, refreshKey: "finance-managers", mutationFilter: financeManagerMutationFilter });
  return { financeManagers, loading, loadFinanceManagers };
}

export function useActiveMembers() {
  const cachedMembers = getCachedGetData("/dealer/active-members");
  const [members, setMembers] = useState(() => cachedMembers || []);
  const [loading, setLoading] = useState(() => !cachedMembers);
  const loadMembers = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get("/dealer/active-members");
      setMembers(response.data || []);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);
  useEffect(() => { loadMembers({ silent: Boolean(cachedMembers) }); }, [loadMembers]);
  useBackgroundRefresh({ onRefresh: loadMembers, refreshKey: "finance-active-members", mutationFilter: activeMemberMutationFilter });
  return { members, loading, loadMembers };
}
