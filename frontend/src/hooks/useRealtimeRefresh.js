import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, limit, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext.jsx";
import { db } from "../services/firebaseDb.js";
import { invalidateGetCache } from "../services/api.js";
import { subscribeRealtime } from "../services/realtimeManager.js";
import { logSseRefresh } from "../services/frontendLatency.js";

const MAX_VISIBLE_ROWS = 50;
const REFRESH_COOLDOWN_MS = 12000;
const MUTATION_DEDUPE_MS = 800;
const MUTATION_MEMO_MAX_ENTRIES = 300;
let globalRefreshTimer = 0;
let globalRefreshInFlight = false;
let globalLastRefreshAt = 0;
let globalPendingInstantRefresh = null;
const mutationRefreshMemo = new Map();

function safeLimit(value) {
  return Math.min(Math.max(Number(value || 10), 1), MAX_VISIBLE_ROWS);
}

function uniqueScopes(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function roleLeadQueries(user, rowLimit) {
  if (!user?.role) return [];
  if (user.role === "super-admin") {
    return [{
      key: `admin-lead-views:${rowLimit}`,
      factory: () => query(collection(db, "adminViews"), where("viewType", "==", "lead"), orderBy("updatedAt", "desc"), limit(rowLimit)),
    }];
  }
  if (["finance-desk", "gm"].includes(user.role)) {
    const collectionName = user.role === "gm" ? "gmViews" : "financeViews";
    return uniqueScopes([user.dealershipId, user.email, user.uid]).map((scope) => ({
      key: `${collectionName}:lead:${scope}:${rowLimit}`,
      factory: () => query(
        collection(db, collectionName),
        where("viewType", "==", "lead"),
        where("scopeId", "==", scope),
        orderBy("updatedAt", "desc"),
        limit(rowLimit),
      ),
    }));
  }
  if (user.role === "loan-executive") {
    return [
      user.uid ? {
        key: `executiveViews:lead-id:${user.uid}:${rowLimit}`,
        factory: () => query(
          collection(db, "executiveViews"),
          where("viewType", "==", "lead"),
          where("scopeId", "==", user.uid),
          orderBy("updatedAt", "desc"),
          limit(rowLimit),
        ),
      } : null,
      user.email ? {
        key: `executiveViews:lead-email:${user.email}:${rowLimit}`,
        factory: () => query(
          collection(db, "executiveViews"),
          where("viewType", "==", "lead"),
          where("scopeId", "==", user.email),
          orderBy("updatedAt", "desc"),
          limit(rowLimit),
        ),
      } : null,
    ].filter(Boolean);
  }
  if (user.role === "bank-manager") {
    return uniqueScopes([user.bankId, user.bankName, user.email, user.uid]).map((scope) => ({
      key: `bankViews:lead:${scope}:${user.branchId || "all"}:${rowLimit}`,
      factory: () => query(
        collection(db, "bankViews"),
        where("viewType", "==", "lead"),
        where("scopeId", "==", scope),
        orderBy("updatedAt", "desc"),
        limit(rowLimit),
      ),
    }));
  }
  return [];
}

function debounceCallback(callback, delay) {
  let timeout = 0;
  const debounced = () => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(callback, delay);
  };
  debounced.cancel = () => window.clearTimeout(timeout);
  return debounced;
}

function rememberMutationRefresh(key) {
  const now = Date.now();
  if (mutationRefreshMemo.size > MUTATION_MEMO_MAX_ENTRIES) {
    const cutoff = now - MUTATION_DEDUPE_MS * 4;
    for (const [memoKey, lastAt] of mutationRefreshMemo.entries()) {
      if (lastAt < cutoff || mutationRefreshMemo.size > MUTATION_MEMO_MAX_ENTRIES) mutationRefreshMemo.delete(memoKey);
    }
  }
  const lastAt = mutationRefreshMemo.get(key) || 0;
  if (now - lastAt < MUTATION_DEDUPE_MS) return false;
  mutationRefreshMemo.set(key, now);
  return true;
}

function queuePendingInstantRefresh(callback) {
  if (typeof callback === "function") {
    globalPendingInstantRefresh = callback;
  }
}

function drainPendingInstantRefresh() {
  const pending = globalPendingInstantRefresh;
  globalPendingInstantRefresh = null;
  if (typeof pending === "function") {
    window.setTimeout(() => runInstantRefresh(pending), 0);
  }
}

function runFreshRefresh(callback, { force = false } = {}) {
  if (typeof callback !== "function") return;
  const elapsed = Date.now() - globalLastRefreshAt;
  if (globalRefreshInFlight || (!force && elapsed < REFRESH_COOLDOWN_MS)) return;
  globalRefreshInFlight = true;
  globalLastRefreshAt = Date.now();
  invalidateGetCache({ prefix: "/dealer/" });
  invalidateGetCache({ prefix: "/gm/" });
  invalidateGetCache({ prefix: "/bank/" });
  invalidateGetCache({ prefix: "/admin/" });
  Promise.resolve(callback({ silent: true }))
    .finally(() => {
      globalRefreshInFlight = false;
      drainPendingInstantRefresh();
    });
}

function runInstantRefresh(callback) {
  if (typeof callback !== "function") return;
  if (globalRefreshInFlight) {
    queuePendingInstantRefresh(callback);
    return;
  }
  globalRefreshInFlight = true;
  globalLastRefreshAt = 0;
  invalidateGetCache();
  Promise.resolve()
    .then(() => callback({ silent: true }))
    .finally(() => {
      globalRefreshInFlight = false;
      globalLastRefreshAt = Date.now();
      drainPendingInstantRefresh();
    });
}

export function mutationUrlMatches(detail = {}, prefixes = []) {
  if (!prefixes.length) return true;
  const urls = [detail?.url, detail?.canonicalUrl, detail?.kind === "lead" ? "/lead-mutation" : ""]
    .map((url) => String(url || ""))
    .filter(Boolean);
  if (!urls.length) return true;
  return urls.some((url) => prefixes.some((prefix) => url.startsWith(prefix)));
}

function scheduleFreshRefresh(callback, delay = 250) {
  if (typeof callback !== "function") return;
  window.clearTimeout(globalRefreshTimer);
  globalRefreshTimer = window.setTimeout(() => runFreshRefresh(callback), delay);
}

function realtimeConnected() {
  return typeof window !== "undefined" && window.__CLS_REALTIME_CONNECTED === true;
}

function realtimeEventHasPatch(detail = {}) {
  if (!detail.realtime) return false;
  if (detail.kind === "lead" || detail.kind === "document") return Boolean(detail.leadId && detail.lead);
  if (detail.kind === "notification") return Boolean(detail.notification?.id);
  return false;
}

export function useBackgroundRefresh({ onRefresh, enabled = true, refreshKey = "default", mutationFilter = null } = {}) {
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled || typeof onRefresh !== "function") return undefined;
    const reconnectRefresh = () => {
      if (document.hidden) return;
      logSseRefresh({ eventType: "online", refreshTriggered: true, component: refreshKey || "background-refresh" });
      scheduleFreshRefresh(refreshRef.current);
    };
    const onMutation = (event) => {
      const detail = event?.detail || {};
      if (realtimeEventHasPatch(detail)) return;
      if (typeof mutationFilter === "function" && !mutationFilter(detail)) return;
      const key = `${refreshKey}:${detail.source || ""}:${detail.at || ""}:${detail.url || ""}`;
      if (!rememberMutationRefresh(key)) return;
      logSseRefresh({ eventType: detail.kind || "data-mutated", refreshTriggered: true, component: refreshKey || "background-refresh", url: detail.url || "", realtime: Boolean(detail.realtime) });
      runInstantRefresh(refreshRef.current);
    };
    window.addEventListener("online", reconnectRefresh);
    window.addEventListener("cls:data-mutated", onMutation);
    return () => {
      window.removeEventListener("online", reconnectRefresh);
      window.removeEventListener("cls:data-mutated", onMutation);
    };
  }, [enabled, mutationFilter, refreshKey]);
}

export function useRealtimeRefresh({ key, queryFactory, onRefresh, enabled = true, debounceMs = 700, mutationFilter = null }) {
  const [health, setHealth] = useState({ connected: false, error: "" });
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  useBackgroundRefresh({ onRefresh, enabled, refreshKey: key || "realtime", mutationFilter });

  useEffect(() => {
    if (!enabled || !queryFactory || typeof onRefresh !== "function") return undefined;
    const debouncedRefresh = debounceCallback(() => runInstantRefresh(refreshRef.current), debounceMs);
    const unsubscribe = subscribeRealtime({
      key,
      queryFactory,
      onChange: () => {
        setHealth({ connected: true, error: "" });
        logSseRefresh({ eventType: "realtime-change", refreshTriggered: true, component: key || "useRealtimeRefresh" });
        debouncedRefresh();
      },
      onError: (error) => {
        setHealth({ connected: false, error: error?.message || "Realtime listener failed" });
      },
    });
    return () => {
      debouncedRefresh.cancel();
      unsubscribe();
    };
  }, [debounceMs, enabled, key, queryFactory]);

  return health;
}

export function useRoleLeadRealtime({ onRefresh, pageSize = 10, enabled = true, mutationFilter = null }) {
  const { user } = useAuth();
  const rowLimit = safeLimit(pageSize);
  const specs = useMemo(() => roleLeadQueries(user, rowLimit), [rowLimit, user?.bankId, user?.bankName, user?.dealershipId, user?.email, user?.role, user?.uid]);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  useBackgroundRefresh({ onRefresh, enabled, refreshKey: `role-leads:${user?.role || "anon"}`, mutationFilter });

  useEffect(() => {
    if (!enabled || !specs.length || typeof onRefresh !== "function") return undefined;
    const debouncedRefresh = debounceCallback(() => runInstantRefresh(refreshRef.current), 300);
    const unsubscribers = specs.map((spec) => subscribeRealtime({
      key: spec.key,
      queryFactory: spec.factory,
      onChange: () => {
        if (!realtimeConnected()) {
          logSseRefresh({ eventType: "role-lead-change", refreshTriggered: true, component: spec.key });
          debouncedRefresh();
        }
      },
      onError: () => {
        if (!realtimeConnected()) {
          logSseRefresh({ eventType: "role-lead-error", refreshTriggered: true, component: spec.key });
          debouncedRefresh();
        }
      },
    }));
    return () => {
      debouncedRefresh.cancel();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [enabled, specs]);
}

export function useLeadDetailRealtime({ lead, leadId, onRefresh, enabled = true, mutationFilter = null }) {
  const documentLeadIds = useMemo(() => [...new Set([lead?.id, lead?.caseId, leadId].filter(Boolean))], [lead?.caseId, lead?.id, leadId]);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  useBackgroundRefresh({ onRefresh, enabled: enabled && Boolean(leadId), refreshKey: `lead-detail:${leadId || ""}`, mutationFilter });

  useEffect(() => {
    if (!enabled || !leadId || typeof onRefresh !== "function") return undefined;
    const debouncedRefresh = debounceCallback(() => runInstantRefresh(refreshRef.current), 250);
    const specs = [
      {
        key: `lead-detail:${leadId}`,
        factory: () => doc(db, "leads", leadId),
      },
      ...documentLeadIds.map((id) => ({
        key: `documents:${id}:latest`,
        factory: () => query(collection(db, "documents"), where("leadId", "==", id), orderBy("createdAt", "desc"), limit(10)),
      })),
    ];
    const unsubscribers = specs.map((spec) => subscribeRealtime({
      key: spec.key,
      queryFactory: spec.factory,
      onChange: () => {
        if (!realtimeConnected()) {
          logSseRefresh({ eventType: "lead-detail-change", refreshTriggered: true, component: spec.key });
          debouncedRefresh();
        }
      },
      onError: () => {
        if (!realtimeConnected()) {
          logSseRefresh({ eventType: "lead-detail-error", refreshTriggered: true, component: spec.key });
          debouncedRefresh();
        }
      },
    }));
    return () => {
      debouncedRefresh.cancel();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [documentLeadIds, enabled, leadId]);
}

export function useTimelineRealtime({ leadId, onRefresh, enabled = true, mutationFilter = null }) {
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  useBackgroundRefresh({ onRefresh, enabled: enabled && Boolean(leadId), refreshKey: `timeline:${leadId || ""}`, mutationFilter });

  useEffect(() => {
    if (!enabled || !leadId || typeof onRefresh !== "function") return undefined;
    const debouncedRefresh = debounceCallback(() => runInstantRefresh(refreshRef.current), 250);
    const unsubscribe = subscribeRealtime({
      key: `timeline:${leadId}`,
      queryFactory: () => query(collection(db, "leadTimeline"), where("leadId", "==", leadId), orderBy("createdAt", "asc"), limit(50)),
      onChange: () => {
        logSseRefresh({ eventType: "timeline-change", refreshTriggered: true, component: `timeline:${leadId}` });
        debouncedRefresh();
      },
      onError: () => {
        logSseRefresh({ eventType: "timeline-error", refreshTriggered: true, component: `timeline:${leadId}` });
        debouncedRefresh();
      },
    });
    return () => {
      debouncedRefresh.cancel();
      unsubscribe();
    };
  }, [enabled, leadId]);
}

export function notificationQueryForUser(user, unreadOnly = false) {
  if (!user?.role) return null;
  const constraints = [];
  if (user.role === "super-admin") {
    constraints.push(orderBy("createdAt", "desc"));
  } else if (["finance-desk", "gm"].includes(user.role) && user.dealershipId) {
    constraints.push(where("dealershipId", "==", user.dealershipId), orderBy("createdAt", "desc"));
  } else if (user.role === "bank-manager" && user.bankId) {
    constraints.push(where("bankId", "==", user.bankId), orderBy("createdAt", "desc"));
  } else {
    constraints.push(where("recipientId", "==", user.email), orderBy("createdAt", "desc"));
  }
  if (unreadOnly) constraints.splice(Math.max(constraints.length - 1, 0), 0, where("read", "==", false));
  constraints.push(limit(20));
  return query(collection(db, "notifications"), ...constraints);
}
