import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, limit, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext.jsx";
import { db } from "../services/firebaseDb.js";
import { invalidateGetCache } from "../services/api.js";
import { subscribeRealtime } from "../services/realtimeManager.js";

const MAX_VISIBLE_ROWS = 50;
const AUTO_REFRESH_MS = 30000;
const REFRESH_COOLDOWN_MS = 12000;
const FORCED_REFRESH_COOLDOWN_MS = 5000;
let globalRefreshTimer = 0;
let globalRefreshInFlight = false;
let globalLastRefreshAt = 0;

function safeLimit(value) {
  return Math.min(Math.max(Number(value || 10), 1), MAX_VISIBLE_ROWS);
}

function roleLeadQueries(user, rowLimit) {
  if (!user?.role) return [];
  if (["finance-desk", "gm-sm"].includes(user.role) && user.dealershipId) {
    return [{
      key: `leads:dealership:${user.dealershipId}:${rowLimit}`,
      factory: () => query(collection(db, "leads"), where("dealershipId", "==", user.dealershipId), orderBy("createdAt", "desc"), limit(rowLimit)),
    }];
  }
  if (user.role === "loan-executive") {
    return [
      user.uid ? {
        key: `leads:executive-id:${user.uid}:${rowLimit}`,
        factory: () => query(collection(db, "leads"), where("assignedExecutiveId", "==", user.uid), orderBy("createdAt", "desc"), limit(rowLimit)),
      } : null,
      user.email ? {
        key: `leads:executive-email:${user.email}:${rowLimit}`,
        factory: () => query(collection(db, "leads"), where("assignedExecutiveEmail", "==", user.email), orderBy("createdAt", "desc"), limit(rowLimit)),
      } : null,
    ].filter(Boolean);
  }
  if (user.role === "bank-manager" && user.bankId) {
    return [{
      key: `notifications:bank:${user.bankId}:lead-signal`,
      factory: () => query(collection(db, "notifications"), where("bankId", "==", user.bankId), orderBy("createdAt", "desc"), limit(20)),
    }];
  }
  if (user.role === "super-admin") {
    return [{
      key: "operational-events:admin:lead-signal",
      factory: () => query(collection(db, "operationalEvents"), orderBy("createdAt", "desc"), limit(10)),
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

function runFreshRefresh(callback, { force = false } = {}) {
  if (typeof callback !== "function") return;
  const elapsed = Date.now() - globalLastRefreshAt;
  const cooldown = force ? FORCED_REFRESH_COOLDOWN_MS : REFRESH_COOLDOWN_MS;
  if (globalRefreshInFlight || elapsed < cooldown) return;
  globalRefreshInFlight = true;
  globalLastRefreshAt = Date.now();
  invalidateGetCache({ prefix: "/dealer/" });
  invalidateGetCache({ prefix: "/gm/" });
  invalidateGetCache({ prefix: "/bank/" });
  invalidateGetCache({ prefix: "/admin/" });
  Promise.resolve(callback({ silent: true }))
    .finally(() => {
      globalRefreshInFlight = false;
    });
}

function scheduleFreshRefresh(callback, delay = 250) {
  if (typeof callback !== "function") return;
  window.clearTimeout(globalRefreshTimer);
  globalRefreshTimer = window.setTimeout(() => runFreshRefresh(callback), delay);
}

export function useBackgroundRefresh({ onRefresh, enabled = true, intervalMs = AUTO_REFRESH_MS } = {}) {
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled || typeof onRefresh !== "function") return undefined;
    const refresh = () => {
      if (document.hidden) return;
      scheduleFreshRefresh(refreshRef.current);
    };
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    const timer = window.setInterval(() => runFreshRefresh(refreshRef.current, { force: true }), Math.max(Number(intervalMs) || AUTO_REFRESH_MS, 30000));
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, intervalMs]);
}

export function useRealtimeRefresh({ key, queryFactory, onRefresh, enabled = true, debounceMs = 700 }) {
  const [health, setHealth] = useState({ connected: false, error: "" });
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  useBackgroundRefresh({ onRefresh, enabled });

  useEffect(() => {
    if (!enabled || !queryFactory || typeof onRefresh !== "function") return undefined;
    const debouncedRefresh = debounceCallback(() => runFreshRefresh(refreshRef.current, { force: true }), debounceMs);
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

export function useRoleLeadRealtime({ onRefresh, pageSize = 10, enabled = true }) {
  const { user } = useAuth();
  const rowLimit = safeLimit(pageSize);
  const specs = useMemo(() => roleLeadQueries(user, rowLimit), [rowLimit, user?.bankId, user?.dealershipId, user?.email, user?.role, user?.uid]);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  useBackgroundRefresh({ onRefresh, enabled });

  useEffect(() => {
    if (!enabled || !specs.length || typeof onRefresh !== "function") return undefined;
    const debouncedRefresh = debounceCallback(() => runFreshRefresh(refreshRef.current, { force: true }), 700);
    const unsubscribers = specs.map((spec) => subscribeRealtime({
      key: spec.key,
      queryFactory: spec.factory,
      onChange: debouncedRefresh,
      onError: debouncedRefresh,
    }));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [enabled, specs]);
}

export function useLeadDetailRealtime({ lead, leadId, onRefresh, enabled = true }) {
  const documentLeadIds = useMemo(() => [...new Set([lead?.id, lead?.caseId, leadId].filter(Boolean))], [lead?.caseId, lead?.id, leadId]);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  useBackgroundRefresh({ onRefresh, enabled: enabled && Boolean(leadId), intervalMs: 45000 });

  useEffect(() => {
    if (!enabled || !leadId || typeof onRefresh !== "function") return undefined;
    const debouncedRefresh = debounceCallback(() => runFreshRefresh(refreshRef.current, { force: true }), 600);
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

export function useTimelineRealtime({ leadId, onRefresh, enabled = true }) {
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  useBackgroundRefresh({ onRefresh, enabled: enabled && Boolean(leadId), intervalMs: 45000 });

  useEffect(() => {
    if (!enabled || !leadId || typeof onRefresh !== "function") return undefined;
    const debouncedRefresh = debounceCallback(() => runFreshRefresh(refreshRef.current, { force: true }), 500);
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
