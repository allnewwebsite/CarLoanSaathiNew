import { api, apiBaseUrl } from "./api.js";
import {
  hasBrowserSingletonOwner,
  readLeader,
  readStoredLastEventId,
  refreshBrowserSingletonOwner,
  releaseBrowserSingletonOwner,
  releaseLeader,
  writeLeader,
  writeStoredLastEventId,
} from "./realtimeClientBrowser.js";
import {
  ACK_FLUSH_MS,
  HEARTBEAT_TIMEOUT_MS,
  LEADER_HEARTBEAT_MS,
  PHASE_ONE_EVENTS,
  REALTIME_EVENT_CHANNEL,
  REALTIME_EVENT_STORAGE_KEY,
  REALTIME_LEADER_PREFIX,
  TAB_ID,
} from "./realtimeClient.constants.js";
import { invalidateRealtimeCaches, mutationPayload } from "./realtimeClient.events.js";

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

function loadLastEventId() {
  lastEventId = readStoredLastEventId();
}

function persistLastEventId(id = "") {
  const value = writeStoredLastEventId(id);
  if (!value) return;
  lastEventId = value;
}

function dispatchConnectionState(connected, detail = {}) {
  if (typeof window === "undefined") return;
  window.__CLS_REALTIME_CONNECTED = connected === true;
  window.dispatchEvent(new CustomEvent("cls:realtime-connection", { detail: { connected: connected === true, ...detail } }));
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
    refreshBrowserSingletonOwner(activeIdentity, active);
    if (isLeaderTab) {
      writeLeader(activeIdentity);
      return;
    }
    if (!readLeader(activeIdentity)) connect().catch(() => {});
  }, LEADER_HEARTBEAT_MS);
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
  if (!hasBrowserSingletonOwner(activeIdentity)) {
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
    refreshBrowserSingletonOwner(activeIdentity, active);
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
