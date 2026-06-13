import { useEffect, useRef, useState } from "react";
import { invalidateGetCache } from "../services/api.js";
import { logSseRefresh } from "../services/frontendLatency.js";

const REFRESH_COOLDOWN_MS = 12000;
const MUTATION_DEDUPE_MS = 800;
const MUTATION_MEMO_MAX_ENTRIES = 300;
const refreshStates = new WeakMap();
const mutationRefreshMemo = new Map();

function refreshState(callback) {
  let state = refreshStates.get(callback);
  if (!state) {
    state = { timer: 0, inFlight: false, lastRefreshAt: 0, pendingInstant: false };
    refreshStates.set(callback, state);
  }
  return state;
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

function invalidatePortalCaches() {
  invalidateGetCache({ prefix: "/dealer/" });
  invalidateGetCache({ prefix: "/gm/" });
  invalidateGetCache({ prefix: "/bank/" });
  invalidateGetCache({ prefix: "/admin/" });
  invalidateGetCache({ prefix: "/dashboard" });
  invalidateGetCache({ prefix: "/timeline" });
  invalidateGetCache({ prefix: "/notifications" });
}

function runFreshRefresh(callback, { force = false } = {}) {
  if (typeof callback !== "function") return;
  const state = refreshState(callback);
  const elapsed = Date.now() - state.lastRefreshAt;
  if (state.inFlight || (!force && elapsed < REFRESH_COOLDOWN_MS)) return;
  state.inFlight = true;
  state.lastRefreshAt = Date.now();
  invalidatePortalCaches();
  Promise.resolve()
    .then(() => callback({ silent: true }))
    .catch(() => undefined)
    .finally(() => {
      state.inFlight = false;
      if (state.pendingInstant) {
        state.pendingInstant = false;
        window.setTimeout(() => runInstantRefresh(callback), 0);
      }
    });
}

function runInstantRefresh(callback) {
  if (typeof callback !== "function") return;
  const state = refreshState(callback);
  if (state.inFlight) {
    state.pendingInstant = true;
    return;
  }
  state.inFlight = true;
  state.lastRefreshAt = 0;
  invalidateGetCache();
  Promise.resolve()
    .then(() => callback({ silent: true }))
    .catch(() => undefined)
    .finally(() => {
      state.inFlight = false;
      state.lastRefreshAt = Date.now();
      if (state.pendingInstant) {
        state.pendingInstant = false;
        window.setTimeout(() => runInstantRefresh(callback), 0);
      }
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
  const state = refreshState(callback);
  window.clearTimeout(state.timer);
  state.timer = window.setTimeout(() => runFreshRefresh(callback), delay);
}

export function useBackgroundRefresh({ onRefresh, enabled = true, refreshKey = "default", mutationFilter = null } = {}) {
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled || typeof onRefresh !== "function") return undefined;
    const reconnectRefresh = () => {
      if (document.hidden) return;
      logSseRefresh({ eventType: "online", refreshTriggered: true, component: refreshKey });
      scheduleFreshRefresh(refreshRef.current);
    };
    const onRealtimeConnection = (event) => {
      if (event?.detail?.connected !== true || document.hidden) return;
      logSseRefresh({ eventType: "sse-connected", refreshTriggered: true, component: refreshKey });
      scheduleFreshRefresh(refreshRef.current, 100);
    };
    const onMutation = (event) => {
      const detail = event?.detail || {};
      if (typeof mutationFilter === "function" && !mutationFilter(detail)) return;
      const key = `${refreshKey}:${detail.source || ""}:${detail.at || ""}:${detail.eventType || ""}:${detail.url || ""}`;
      if (!rememberMutationRefresh(key)) return;
      logSseRefresh({
        eventType: detail.eventType || detail.kind || "data-mutated",
        refreshTriggered: true,
        component: refreshKey,
        url: detail.url || "",
        realtime: Boolean(detail.realtime),
      });
      runInstantRefresh(refreshRef.current);
    };
    window.addEventListener("online", reconnectRefresh);
    window.addEventListener("cls:realtime-connection", onRealtimeConnection);
    window.addEventListener("cls:data-mutated", onMutation);
    return () => {
      window.removeEventListener("online", reconnectRefresh);
      window.removeEventListener("cls:realtime-connection", onRealtimeConnection);
      window.removeEventListener("cls:data-mutated", onMutation);
    };
  }, [enabled, mutationFilter, refreshKey]);
}

export function useRealtimeRefresh({ key, onRefresh, enabled = true, mutationFilter = null }) {
  const [health, setHealth] = useState({
    connected: typeof window !== "undefined" && window.__CLS_REALTIME_CONNECTED === true,
    error: "",
  });
  useBackgroundRefresh({ onRefresh, enabled, refreshKey: key || "realtime", mutationFilter });

  useEffect(() => {
    if (!enabled) return undefined;
    const onConnection = (event) => {
      setHealth({
        connected: event?.detail?.connected === true,
        error: event?.detail?.connected === true ? "" : "Realtime connection interrupted",
      });
    };
    window.addEventListener("cls:realtime-connection", onConnection);
    return () => window.removeEventListener("cls:realtime-connection", onConnection);
  }, [enabled]);

  return health;
}

export function useRoleLeadRealtime({ onRefresh, enabled = true, mutationFilter = null } = {}) {
  useBackgroundRefresh({ onRefresh, enabled, refreshKey: "role-leads", mutationFilter });
}

export function useLeadDetailRealtime({ leadId, onRefresh, enabled = true, mutationFilter = null }) {
  useBackgroundRefresh({
    onRefresh,
    enabled: enabled && Boolean(leadId),
    refreshKey: `lead-detail:${leadId || ""}`,
    mutationFilter,
  });
}

export function useTimelineRealtime({ leadId, onRefresh, enabled = true, mutationFilter = null }) {
  const timelineMutationFilter = (detail) => {
    const eventLeadId = String(detail?.leadId || detail?.caseId || "");
    const matchesLead = !eventLeadId || eventLeadId === String(leadId);
    return matchesLead && (typeof mutationFilter !== "function" || mutationFilter(detail));
  };
  useBackgroundRefresh({
    onRefresh,
    enabled: enabled && Boolean(leadId),
    refreshKey: `timeline:${leadId || ""}`,
    mutationFilter: timelineMutationFilter,
  });
}
