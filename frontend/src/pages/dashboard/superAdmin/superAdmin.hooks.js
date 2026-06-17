import { useCallback, useEffect, useState } from "react";
import { mutationUrlMatches, useRoleLeadRealtime } from "../../../hooks/useRealtimeRefresh.js";
import { api, getCachedGetData } from "../../../services/api.js";

export const adminLeadMutationFilter = (detail) => mutationUrlMatches(detail, ["/admin/leads", "/bank/leads", "/dealer/leads", "/documents"]);

export function useAdminEcosystem({ includeAudit = false } = {}) {
  const cachedEcosystem = getCachedGetData("/admin/ecosystem") || {};
  const cachedAnalytics = getCachedGetData("/admin/analytics") || {};
  const cachedAuditLogs = includeAudit ? getCachedGetData("/admin/audit-logs") || [] : [];
  const cachedAdminState = {
    ...cachedEcosystem,
    auditLogs: includeAudit && cachedAuditLogs.length ? cachedAuditLogs : cachedEcosystem.auditLogs || [],
  };
  const [state, setState] = useState({
    leads: [],
    onboardingRequests: [],
    dealerships: [],
    financeDesks: [],
    dealershipManagers: [],
    bankPartners: [],
    banks: [],
    branches: [],
    branchManagers: [],
    loanExecutives: [],
    assignments: [],
    reassignmentLogs: [],
    documents: [],
    bankDocuments: [],
    pendingDealershipApprovals: [],
    pendingBankApprovals: [],
    approvalLogs: [],
    pendingGoogleAccounts: [],
    loginActivity: [],
    users: [],
    auditLogs: [],
    ...cachedAdminState,
  });
  const [analytics, setAnalytics] = useState(cachedAnalytics);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [ecosystem, analyticsResponse, auditResponse] = await Promise.all([
        api.get("/admin/ecosystem"),
        api.get("/admin/analytics"),
        includeAudit ? api.get("/admin/audit-logs") : Promise.resolve({ data: [] }),
      ]);
      setState((current) => ({ ...current, ...(ecosystem.data || {}), ...(includeAudit ? { auditLogs: auditResponse.data || [] } : {}) }));
      setAnalytics(analyticsResponse.data || {});
    } finally {
      if (!silent) setLoading(false);
    }
  }, [includeAudit]);

  useEffect(() => { load({ silent: true }); }, [load]);
  useRoleLeadRealtime({ onRefresh: load, pageSize: 10, mutationFilter: adminLeadMutationFilter });
  return { ...state, analytics, loading, load };
}
