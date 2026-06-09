import { api, apiBaseUrl, invalidateGetCache } from "./api.js";

let source = null;
let connectPromise = null;
let active = false;
let reconnectTimer = 0;
let lastEventId = "";

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
  return "/lead-mutation";
}

function mutationPayload(event = {}) {
  const url = leadUrlForEvent(event);
  const kind = event.kind === "notification"
    ? "notification"
    : event.kind === "staff"
      ? "staff"
      : event.kind === "bank"
        ? "bank"
        : event.kind === "dealer"
          ? "dealer"
          : "lead";
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
  if (PHASE_ONE_EVENTS.has(event.eventType || event.event)) return;
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
  [
    "/admin/leads",
    "/bank/leads",
    "/dealer/leads",
    "/gm/leads",
    "/timeline",
    "/notifications",
    "/dashboard",
  ].forEach((prefix) => invalidateGetCache({ prefix, purge: true }));
}

function dispatchRealtimeEvent(event = {}) {
  if (typeof window === "undefined") return;
  lastEventId = String(event.id || lastEventId || "");
  invalidateRealtimeCaches(event);
  if (!event.leadId && !event.caseId && PHASE_ONE_EVENTS.has(event.eventType || event.event)) {
    console.info("SSE_EVENT_IGNORED", { tag: "SSE_EVENT_IGNORED", eventType: event.eventType || event.event, reason: "missing_lead_identity" });
    return;
  }
  window.dispatchEvent(new CustomEvent("cls:realtime-event", { detail: event }));
  if (!PHASE_ONE_EVENTS.has(event.eventType || event.event)) {
    window.dispatchEvent(new CustomEvent("cls:data-mutated", { detail: mutationPayload(event) }));
  }
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

async function connect() {
  if (typeof window === "undefined" || source || connectPromise || !active) return connectPromise;
  connectPromise = api.post("/realtime/ticket")
    .then((response) => {
      if (!active) return null;
      const ticket = response.data?.ticket;
      if (!ticket) return null;
      const params = new URLSearchParams({ ticket });
      if (lastEventId) params.set("lastEventId", lastEventId);
      source = new EventSource(`${apiBaseUrl()}/realtime/events?${params.toString()}`);
      source.addEventListener("connected", () => {
        window.__CLS_REALTIME_CONNECTED = true;
        window.dispatchEvent(new CustomEvent("cls:realtime-connection", { detail: { connected: true } }));
      });
      source.addEventListener("operational", (message) => {
        try {
          dispatchRealtimeEvent(JSON.parse(message.data));
        } catch {
          // Ignore malformed realtime messages.
        }
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
  closeSource();
  connectPromise = null;
}
