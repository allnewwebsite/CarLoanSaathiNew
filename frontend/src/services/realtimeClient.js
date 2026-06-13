import { api, apiBaseUrl, invalidateGetCache } from "./api.js";
import { getStoredUser } from "./authSessionManager.js";

let source = null;
let connectPromise = null;
let active = false;
let reconnectTimer = 0;
let lastEventId = "";
let heartbeatTimer = 0;
let ackTimer = 0;
const pendingAckIds = new Set();
const MUTATION_KINDS = new Set(["document", "notification", "staff", "bank", "dealer", "subscription"]);

const HEARTBEAT_TIMEOUT_MS = 45_000;
const ACK_FLUSH_MS = 2_000;

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
    invalidateGetCache({ prefix: "/notifications", purge: true });
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
    invalidateGetCache({ prefix: "/admin/monitoring", purge: true });
    return;
  }
  if (event.kind === "dealer") {
    invalidateGetCache({ prefix: "/admin/approvals/dealerships", purge: true });
    invalidateGetCache({ prefix: "/admin/dealerships", purge: true });
    invalidateGetCache({ prefix: "/admin/monitoring", purge: true });
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
    "/bank/leads",
    "/bank/analytics",
    "/dealer/leads",
    "/gm/leads",
    "/timeline",
    "/notifications",
    "/dashboard",
  ].forEach((prefix) => invalidateGetCache({ prefix, purge: true }));
}

function dispatchRealtimeEvent(event = {}) {
  if (typeof window === "undefined") return;
  resetHeartbeatWatch();
  if (event.id) persistLastEventId(event.id);
  invalidateRealtimeCaches(event);
  if (!event.leadId && !event.caseId && PHASE_ONE_EVENTS.has(event.eventType || event.event)) {
    console.info("SSE_EVENT_IGNORED", { tag: "SSE_EVENT_IGNORED", eventType: event.eventType || event.event, reason: "missing_lead_identity" });
    return;
  }
  window.dispatchEvent(new CustomEvent("cls:realtime-event", { detail: event }));
  window.dispatchEvent(new CustomEvent("cls:data-mutated", { detail: mutationPayload(event) }));
  queueAck(event.id);
}

function closeSource() {
  if (source) {
    source.close();
    source = null;
  }
  if (typeof window !== "undefined") {
    window.__CLS_REALTIME_CONNECTED = false;
    window.dispatchEvent(new CustomEvent("cls:realtime-connection", { detail: { connected: false } }));
  }
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
    }, 500);
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
  loadLastEventId();
  connectPromise = api.post("/realtime/ticket")
    .then((response) => {
      if (!active) return null;
      const ticket = response.data?.ticket;
      if (!ticket) return null;
      const params = new URLSearchParams({ ticket });
      if (lastEventId) params.set("lastEventId", lastEventId);
      source = new EventSource(`${apiBaseUrl()}/realtime/events?${params.toString()}`);
      source.addEventListener("connected", () => {
        resetHeartbeatWatch();
        window.__CLS_REALTIME_CONNECTED = true;
        window.dispatchEvent(new CustomEvent("cls:realtime-connection", { detail: { connected: true } }));
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
      source.addEventListener("operational", (message) => {
        try {
          dispatchRealtimeEvent(JSON.parse(message.data));
        } catch {
          // Ignore malformed realtime messages.
        }
      });
      source.addEventListener("heartbeat", () => {
        resetHeartbeatWatch();
      });
      source.onerror = () => {
        closeSource();
        if (!active) return;
        window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(() => {
          connect().catch(() => {});
        }, 1500);
      };
      return source;
    })
    .finally(() => {
      connectPromise = null;
    });
  return connectPromise;
}

export function startRealtimeClient() {
  active = true;
  connect().catch(() => {});
}

export function stopRealtimeClient() {
  active = false;
  window.clearTimeout(reconnectTimer);
  window.clearTimeout(heartbeatTimer);
  window.clearTimeout(ackTimer);
  flushAcks();
  closeSource();
  connectPromise = null;
}
