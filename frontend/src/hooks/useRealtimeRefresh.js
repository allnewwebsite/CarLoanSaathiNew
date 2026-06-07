import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, limit, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext.jsx";
import { db } from "../services/firebaseDb.js";
import { invalidateGetCache } from "../services/api.js";
import { subscribeRealtime } from "../services/realtimeManager.js";

const MAX_VISIBLE_ROWS = 50;
const REFRESH_COOLDOWN_MS = 12000;
const MUTATION_DEDUPE_MS = 800;
let globalRefreshTimer = 0;
let globalRefreshInFlight = false;
let globalLastRefreshAt = 0;
let globalPendingInstantRefresh = null;
const mutationRefreshMemo = new Map();

function safeLimit(value) {
  return Math.min(Math.max(Number(value || 10), 1), MAX_VISIBLE_ROWS);
}

function roleLeadQueries(user, rowLimit) {
  if (!user?.role) return [];
  if (user.role === "super-admin") {
    return [{
      key: `admin-lead-views:${rowLimit}`,
      factory: () => query(collection(db, "adminViews"), where("viewType", "==", "lead"), orderBy("updatedAt", "desc"), limit(rowLimit)),
    }];
  }
  if (["finance-desk", "gm-sm"].includes(user.role) && user.dealershipId) {
    const collectionName = user.role === "gm-sm" ? "gmViews" : "financeViews";
    return [{
      key: `${collectionName}:lead:${user.dealershipId}:${rowLimit}`,
      factory: () => query(
        collection(db, collectionName),
        where("viewType", "==", "lead"),
        where("scopeId", "==", user.dealershipId),
        orderBy("updatedAt", "desc"),
        limit(rowLimit),
      ),
    }];
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
  if (user.role === "bank-manager" && user.bankId) {
    return [{
      key: `bankViews:lead:${user.bankId}:${user.branchId || "all"}:${rowLimit}`,
      factory: () => query(
        collection(db, "bankViews"),
        where("viewType", "==", "lead"),
        where("scopeId", "==", user.bankId),
        orderBy("updatedAt", "desc"),
        limit(rowLimit),
      ),
    }];
  }
  return [];
}

function debounceCallback(callback, delay) {
  let timeout = 0;
  return () => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(callback, delay);
  };
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

export function useBackgroundRefresh({ onRefresh, enabled = true, refreshKey = "default", mutationFilter = null } = {}) {
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled || typeof onRefresh !== "function") return undefined;
    const reconnectRefresh = () => {
      if (document.hidden) return;
      scheduleFreshRefresh(refreshRef.current);
    };
    const onMutation = (event) => {
      const detail = event?.detail || {};
      if (typeof mutationFilter === "function" && !mutationFilter(detail)) return;
      const key = `${refreshKey}:${detail.source || ""}:${detail.at || ""}:${detail.url || ""}`;
      const lastAt = mutationRefreshMemo.get(key) || 0;
      if (Date.now() - lastAt < MUTATION_DEDUPE_MS) return;
      mutationRefreshMemo.set(key, Date.now());
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
    return subscribeRealtime({
      key,
      queryFactory,
      onChange: () => {
        setHealth({ connected: true, error: "" });
        debouncedRefresh();
      },
      onError: (error) => {
        setHealth({ connected: false, error: error?.message || "Realtime listener failed" });
      },
    });
  }, [debounceMs, enabled, key, queryFactory]);

  return health;
}

export function useRoleLeadRealtime({ onRefresh, pageSize = 10, enabled = true, mutationFilter = null }) {
  const { user } = useAuth();
  const rowLimit = safeLimit(pageSize);
  const specs = useMemo(() => roleLeadQueries(user, rowLimit), [rowLimit, user?.bankId, user?.dealershipId, user?.email, user?.role, user?.uid]);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  useBackgroundRefresh({ onRefresh, enabled, refreshKey: `role-leads:${user?.role || "anon"}`, mutationFilter });

  useEffect(() => {
    if (!enabled || !specs.length || typeof onRefresh !== "function") return undefined;
    const debouncedRefresh = debounceCallback(() => runInstantRefresh(refreshRef.current), 300);
    const unsubscribers = specs.map((spec) => subscribeRealtime({
      key: spec.key,
      queryFactory: spec.factory,
      onChange: debouncedRefresh,
      onError: debouncedRefresh,
    }));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
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
      onChange: debouncedRefresh,
      onError: debouncedRefresh,
    }));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [documentLeadIds, enabled, leadId]);
}

export function useTimelineRealtime({ leadId, onRefresh, enabled = true, mutationFilter = null }) {
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  useBackgroundRefresh({ onRefresh, enabled: enabled && Boolean(leadId), refreshKey: `timeline:${leadId || ""}`, mutationFilter });

  useEffect(() => {
    if (!enabled || !leadId || typeof onRefresh !== "function") return undefined;
    const debouncedRefresh = debounceCallback(() => runInstantRefresh(refreshRef.current), 250);
    return subscribeRealtime({
      key: `timeline:${leadId}`,
      queryFactory: () => query(collection(db, "leadTimeline"), where("leadId", "==", leadId), orderBy("createdAt", "asc"), limit(50)),
      onChange: debouncedRefresh,
      onError: debouncedRefresh,
    });
  }, [enabled, leadId]);
}

export function notificationQueryForUser(user, unreadOnly = false) {
  if (!user?.role) return null;
  const constraints = [];
  if (user.role === "super-admin") {
    constraints.push(orderBy("createdAt", "desc"));
  } else if (["finance-desk", "gm-sm"].includes(user.role) && user.dealershipId) {
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
