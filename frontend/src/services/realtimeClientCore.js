import { api, apiBaseUrl, invalidateGetCache } from "./api.js";
import { getStoredUser } from "./authSessionManager.js";

let source = null;
let connectPromise = null;
let active = false;
let reconnectTimer = 0;
let lastEventId = "";
let heartbeatTimer = 0;
let ackTimer = 0;
let activeIdentity = "";
let reconnectAttempts = 0;
let connectionGeneration = 0;
let leaderTimer = 0;
let realtimeEventChannel = null;
let realtimeListenersReady = false;
let isLeaderTab = false;
const pendingAckIds = new Set();
const MUTATION_KINDS = new Set(["document", "notification", "staff", "bank", "dealer", "subscription"]);

const HEARTBEAT_TIMEOUT_MS = 45_000;
const ACK_FLUSH_MS = 2_000;
const LEADER_HEARTBEAT_MS = 5_000;
const LEADER_TTL_MS = 15_000;
const REALTIME_EVENT_CHANNEL = "cls_realtime_event_v1";
const REALTIME_EVENT_STORAGE_KEY = "cls_realtime_event_v1";
const REALTIME_LEADER_PREFIX = "cls_realtime_leader_v1";
const REALTIME_OWNER_KEY = "__CLS_REALTIME_CLIENT_OWNER";
const TAB_ID = (() => {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
})();

const PHASE_ONE_EVENTS = new Set([
  "LEAD_CREATED",
  "LEAD_STATUS_UPDATED",
  "LEAD_REMARK_ADDED",
  "DOCUMENT_UPLOADED",
]);

function leadUrlForEvent(event = {}) {
  if (event.kind === "document") return "/documents";
  if (event.kind === "notification") return "/notifications";
  if (event.kind === "staff") return "/dealer/staff";
  if (event.kind === "bank") return "/banks";
  if (event.kind === "dealer") return "/dealers";
  if (event.kind === "subscription") return "/dealer/billing";
  return "/lead-mutation";
}

function realtimeStorageKey() {
  const user = getStoredUser() || {};
  const identity = user.uid || user.email || "anonymous";
  return `cls_realtime_last_event_id:${user.role || "unknown"}:${identity}`;
}

function loadLastEventId() {
  try {
    lastEventId = sessionStorage.getItem(realtimeStorageKey()) || "";
  } catch {
    lastEventId = "";
  }
}

function persistLastEventId(id = "") {
  const value = String(id || "");
  if (!value) return;
  lastEventId = value;
  try {
    sessionStorage.setItem(realtimeStorageKey(), value);
  } catch {
    // Last-event persistence is best-effort recovery metadata.
  }
}

function leaderStorageKey(identity = activeIdentity) {
  return `${REALTIME_LEADER_PREFIX}:${identity || "anonymous"}`;
}

function readLeader(identity = activeIdentity) {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage?.getItem(leaderStorageKey(identity));
    const leader = raw ? JSON.parse(raw) : null;
    if (!leader?.tabId || Number(leader.expiresAt || 0) <= Date.now()) return null;
    return leader;
  } catch {
    return null;
  }
}

function writeLeader(identity = activeIdentity) {
  if (typeof window === "undefined" || !identity) return false;
  try {
    window.localStorage?.setItem(leaderStorageKey(identity), JSON.stringify({
      tabId: TAB_ID,
      identity,
      expiresAt: Date.now() + LEADER_TTL_MS,
    }));
    return true;
  } catch {
    return false;
  }
}

function releaseLeader(identity = activeIdentity) {
  if (typeof window === "undefined" || !identity) return;
  try {
    const leader = readLeader(identity);
    if (leader?.tabId === TAB_ID) window.localStorage?.removeItem(leaderStorageKey(identity));
  } catch {
    // Leader release is best effort.
  }
}

function dispatchConnectionState(connected, detail = {}) {
  if (typeof window === "undefined") return;
  window.__CLS_REALTIME_CONNECTED = connected === true;
  window.dispatchEvent(new CustomEvent("cls:realtime-connection", { detail: { connected: connected === true, ...detail } }));
}

function hasBrowserSingletonOwner() {
  if (typeof window === "undefined") return true;
  const owner = window[REALTIME_OWNER_KEY];
  if (!owner || owner.tabId === TAB_ID || Number(owner.expiresAt || 0) <= Date.now()) {
    window[REALTIME_OWNER_KEY] = { tabId: TAB_ID, identity: activeIdentity, expiresAt: Date.now() + LEADER_TTL_MS };
    return true;
  }
  return false;
}

function refreshBrowserSingletonOwner() {
  if (typeof window === "undefined" || !active || !activeIdentity) return;
  if (window[REALTIME_OWNER_KEY]?.tabId === TAB_ID) {
    window[REALTIME_OWNER_KEY] = { tabId: TAB_ID, identity: activeIdentity, expiresAt: Date.now() + LEADER_TTL_MS };
  }
}

function releaseBrowserSingletonOwner() {
  if (typeof window !== "undefined" && window[REALTIME_OWNER_KEY]?.tabId === TAB_ID) {
    delete window[REALTIME_OWNER_KEY];
  }
}

function broadcastRealtimeEvent(event = {}) {
  if (typeof window === "undefined" || !event?.id) return;
  const payload = { source: TAB_ID, identity: activeIdentity, event };
  try {
    realtimeEventChannel?.postMessage(payload);
  } catch {
    // BroadcastChannel is optional.
  }
  try {
    window.localStorage?.setItem(REALTIME_EVENT_STORAGE_KEY, JSON.stringify({ ...payload, at: Date.now() }));
  } catch {
    // Storage event broadcast is best effort.
  }
}

function handleBroadcastRealtimeEvent(payload = {}) {
  if (!payload || payload.source === TAB_ID || payload.identity !== activeIdentity || !payload.event) return;
  dispatchRealtimeEvent(payload.event, { remote: true });
}

function setupRealtimeBroadcastListeners() {
  if (typeof window === "undefined" || realtimeListenersReady) return;
  realtimeListenersReady = true;
  try {
    if ("BroadcastChannel" in window) {
      realtimeEventChannel = new BroadcastChannel(REALTIME_EVENT_CHANNEL);
      realtimeEventChannel.onmessage = (event) => handleBroadcastRealtimeEvent(event.data);
    }
  } catch {
    realtimeEventChannel = null;
  }
  window.addEventListener("storage", (event) => {
    if (event.key === REALTIME_EVENT_STORAGE_KEY && event.newValue) {
      try {
        handleBroadcastRealtimeEvent(JSON.parse(event.newValue));
      } catch {
        // Ignore malformed cross-tab realtime payloads.
      }
      return;
    }
    if (!event.key?.startsWith(`${REALTIME_LEADER_PREFIX}:`) || !active) return;
    const leader = readLeader(activeIdentity);
    if (isLeaderTab && leader?.tabId && leader.tabId !== TAB_ID) {
      isLeaderTab = false;
      closeSource();
    }
    if (!leader) connect().catch(() => {});
  });
}

function ensureLeader() {
  if (typeof window === "undefined" || !active || !activeIdentity) return true;
  const leader = readLeader(activeIdentity);
  if (!leader || leader.tabId === TAB_ID) {
    isLeaderTab = writeLeader(activeIdentity);
    return isLeaderTab;
  }
  isLeaderTab = false;
  closeSource({ notify: false });
  dispatchConnectionState(true, { shared: true, leaderTab: false });
  return false;
}

function scheduleLeaderHeartbeat() {
  if (typeof window === "undefined") return;
  window.clearInterval(leaderTimer);
  leaderTimer = window.setInterval(() => {
    if (!active || !activeIdentity) return;
    refreshBrowserSingletonOwner();
    if (isLeaderTab) {
      writeLeader(activeIdentity);
      return;
    }
    if (!readLeader(activeIdentity)) connect().catch(() => {});
  }, LEADER_HEARTBEAT_MS);
}

function mutationPayload(event = {}) {
  const url = leadUrlForEvent(event);
  const kind = MUTATION_KINDS.has(event.kind) ? event.kind : "lead";
  return {
    realtime: true,
    url,
    canonicalUrl: event.kind === "lead" || event.kind === "document" ? "/lead-mutation" : url,
    kind,
    event: event.event || event.eventType,
    eventType: event.eventType || event.event,
    leadId: event.leadId || event.lead?.leadId || "",
    caseId: event.caseId || event.lead?.caseId || "",
    status: event.status || event.lead?.status || "",
    dealershipId: event.dealershipId || event.lead?.dealershipId || "",
    bankId: event.bankId || event.lead?.bankId || "",
    executiveId: event.executiveId || event.lead?.assignedExecutiveId || "",
    financeManagerId: event.financeManagerId || event.lead?.financeManagerId || "",
    salespersonId: event.salespersonId || event.lead?.salespersonId || "",
    lead: event.lead || null,
    bankEvent: event.bankEvent || null,
    dealerEvent: event.dealerEvent || null,
    notification: event.notification || null,
    document: event.document || null,
    at: Date.now(),
    source: "sse",
  };
}

function invalidateRealtimeCaches(event = {}) {
  if (event.kind === "notification") {
    return;
  }
  if (event.kind === "staff") {
    invalidateGetCache({ prefix: "/dealer/staff", purge: true });
    invalidateGetCache({ prefix: "/dealer/salespersons", purge: true });
    invalidateGetCache({ prefix: "/dealer/finance-managers", purge: true });
    invalidateGetCache({ prefix: "/gm/salespersons", purge: true });
    return;
  }
  if (event.kind === "bank") {
    invalidateGetCache({ prefix: "/catalog/banks", purge: true });
    invalidateGetCache({ prefix: "/bank/executives", purge: true });
    invalidateGetCache({ prefix: "/bank/analytics", purge: true });
    invalidateGetCache({ prefix: "/bank/leads", purge: true });
    invalidateGetCache({ prefix: "/dealer/available-banks", purge: true });
    invalidateGetCache({ prefix: "/dealer/bank-tieups", purge: true });
    invalidateGetCache({ prefix: "/admin/approvals/banks", purge: true });
    return;
  }
  if (event.kind === "dealer") {
    invalidateGetCache({ prefix: "/admin/approvals/dealerships", purge: true });
    invalidateGetCache({ prefix: "/admin/dealerships", purge: true });
    invalidateGetCache({ prefix: "/dealer/profile", purge: true });
    invalidateGetCache({ prefix: "/dashboard", purge: true });
    invalidateGetCache({ prefix: "/bank/dealerships", purge: true });
    invalidateGetCache({ prefix: "/executive/dealerships", purge: true });
    return;
  }
  if (event.kind === "subscription") {
    invalidateGetCache({ prefix: "/dealer/billing", purge: true });
    return;
  }
  [
    "/admin/leads",
    "/admin/dead-cases",
    "/bank/leads",
    "/bank/dead-cases",
    "/bank/analytics",
    "/dealer/leads",
    "/dealer/dead-cases",
    "/gm/leads",
    "/gm/dead-cases",
    "/timeline",
    "/notifications",
    "/dashboard",
  ].forEach((prefix) => invalidateGetCache({ prefix, purge: true }));
}

function dispatchRealtimeEvent(event = {}, { remote = false } = {}) {
  if (typeof window === "undefined") return;
  if (!remote) resetHeartbeatWatch();
  if (event.id) persistLastEventId(event.id);
  if (!remote) broadcastRealtimeEvent(event);
  invalidateRealtimeCaches(event);
  if (!event.leadId && !event.caseId && PHASE_ONE_EVENTS.has(event.eventType || event.event)) {
    console.info("SSE_EVENT_IGNORED", { tag: "SSE_EVENT_IGNORED", eventType: event.eventType || event.event, reason: "missing_lead_identity" });
    return;
  }
  window.dispatchEvent(new CustomEvent("cls:realtime-event", { detail: event }));
  window.dispatchEvent(new CustomEvent("cls:data-mutated", { detail: mutationPayload(event) }));
  if (!remote) queueAck(event.id);
}

function closeSource({ notify = true, forceNotify = false } = {}) {
  const hadSource = Boolean(source);
  if (source) {
    source.close();
    source = null;
  }
  if (typeof window !== "undefined" && notify && (hadSource || forceNotify)) {
    dispatchConnectionState(false);
  }
}

function resetReconnectTimers() {
  if (typeof window === "undefined") return;
  window.clearTimeout(reconnectTimer);
  window.clearTimeout(heartbeatTimer);
  reconnectTimer = 0;
  heartbeatTimer = 0;
}

function reconnectDelay() {
  reconnectAttempts += 1;
  return Math.min(1000 * (2 ** Math.min(reconnectAttempts - 1, 4)), 15000);
}

function resetHeartbeatWatch() {
  if (typeof window === "undefined" || !active) return;
  window.clearTimeout(heartbeatTimer);
  heartbeatTimer = window.setTimeout(() => {
    closeSource();
    if (!active) return;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => {
      connect().catch(() => {});
    }, reconnectDelay());
  }, HEARTBEAT_TIMEOUT_MS);
}

function flushAcks() {
  if (!pendingAckIds.size) return;
  const eventIds = [...pendingAckIds];
  pendingAckIds.clear();
  api.post("/realtime/ack", { eventIds, lastEventId }).catch(() => {
    eventIds.slice(-25).forEach((id) => pendingAckIds.add(id));
  });
}

function queueAck(id) {
  if (!id || typeof window === "undefined") return;
  pendingAckIds.add(String(id));
  window.clearTimeout(ackTimer);
  ackTimer = window.setTimeout(flushAcks, ACK_FLUSH_MS);
  if (pendingAckIds.size >= 20) flushAcks();
}

async function connect() {
  if (typeof window === "undefined" || source || connectPromise || !active) return connectPromise;
  if (!hasBrowserSingletonOwner()) {
    dispatchConnectionState(true, { shared: true, ownerTab: false });
    return null;
  }
  if (!ensureLeader()) return null;
  const expectedGeneration = connectionGeneration;
  const expectedIdentity = activeIdentity;
  loadLastEventId();
  connectPromise = api.post("/realtime/ticket")
    .then((response) => {
      if (!active || expectedGeneration !== connectionGeneration || expectedIdentity !== activeIdentity) return null;
      const ticket = response.data?.ticket;
      if (!ticket) return null;
      const params = new URLSearchParams({ ticket });
      if (lastEventId) params.set("lastEventId", lastEventId);
      const nextSource = new EventSource(`${apiBaseUrl()}/realtime/events?${params.toString()}`);
      source = nextSource;
      nextSource.addEventListener("connected", () => {
        if (!active || expectedGeneration !== connectionGeneration || expectedIdentity !== activeIdentity) {
          nextSource.close();
          if (source === nextSource) source = null;
          return;
        }
        reconnectAttempts = 0;
        resetHeartbeatWatch();
        dispatchConnectionState(true, { leaderTab: true });
        if (lastEventId) {
          window.dispatchEvent(new CustomEvent("cls:data-mutated", {
            detail: {
              realtime: true,
              kind: "lead",
              url: "/lead-mutation",
              canonicalUrl: "/lead-mutation",
              event: "SSE_RECONNECTED",
              eventType: "SSE_RECONNECTED",
              at: Date.now(),
              source: "sse-reconnect",
            },
          }));
        }
      });
      nextSource.addEventListener("operational", (message) => {
        if (!active || expectedGeneration !== connectionGeneration || expectedIdentity !== activeIdentity) return;
        try {
          dispatchRealtimeEvent(JSON.parse(message.data));
        } catch {
          // Ignore malformed realtime messages.
        }
      });
      nextSource.addEventListener("heartbeat", () => {
        if (!active || expectedGeneration !== connectionGeneration || expectedIdentity !== activeIdentity) return;
        resetHeartbeatWatch();
      });
      nextSource.addEventListener("replaced", () => {
        if (source === nextSource) closeSource();
      });
      nextSource.onerror = () => {
        if (source === nextSource) closeSource();
        if (!active) return;
        if (expectedGeneration !== connectionGeneration || expectedIdentity !== activeIdentity) return;
        resetReconnectTimers();
        reconnectTimer = window.setTimeout(() => {
          connect().catch(() => {});
        }, reconnectDelay());
      };
      return nextSource;
    })
    .finally(() => {
      if (expectedGeneration === connectionGeneration) connectPromise = null;
    });
  return connectPromise;
}

export function startRealtimeClient(identity = "") {
  const nextIdentity = String(identity || "").trim();
  if (active && activeIdentity && nextIdentity && activeIdentity === nextIdentity) {
    refreshBrowserSingletonOwner();
    if (source || connectPromise) return;
  }
  if (active && activeIdentity && nextIdentity && activeIdentity !== nextIdentity) {
    releaseLeader(activeIdentity);
    releaseBrowserSingletonOwner();
    isLeaderTab = false;
    connectionGeneration += 1;
    resetReconnectTimers();
    closeSource();
    connectPromise = null;
  }
  activeIdentity = nextIdentity || activeIdentity;
  active = true;
  setupRealtimeBroadcastListeners();
  scheduleLeaderHeartbeat();
  if (!source && !connectPromise) connectionGeneration += 1;
  connect().catch(() => {});
}

export function stopRealtimeClient(identity = "") {
  const nextIdentity = String(identity || "").trim();
  if (nextIdentity && activeIdentity && nextIdentity !== activeIdentity) return;
  releaseLeader(activeIdentity);
  releaseBrowserSingletonOwner();
  isLeaderTab = false;
  active = false;
  activeIdentity = "";
  reconnectAttempts = 0;
  connectionGeneration += 1;
  resetReconnectTimers();
  window.clearInterval(leaderTimer);
  window.clearTimeout(ackTimer);
  flushAcks();
  closeSource({ forceNotify: true });
  connectPromise = null;
}

export function realtimeDebugState() {
  return {
    active,
    activeIdentity,
    hasSource: Boolean(source),
    hasConnectPromise: Boolean(connectPromise),
    isLeaderTab,
    tabId: TAB_ID,
    pendingAckCount: pendingAckIds.size,
  };
}
