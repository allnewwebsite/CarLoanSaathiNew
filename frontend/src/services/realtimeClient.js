import { api, apiBaseUrl, invalidateGetCache } from "./api.js";

let source = null;
let connectPromise = null;
let active = false;
let reconnectTimer = 0;
let lastEventId = "";

function leadUrlForEvent(event = {}) {
  if (event.kind === "document") return "/documents";
  if (event.kind === "notification") return "/notifications";
  if (event.kind === "staff") return "/dealer/staff";
  return "/lead-mutation";
}

function mutationPayload(event = {}) {
  const url = leadUrlForEvent(event);
  return {
    realtime: true,
    url,
    canonicalUrl: event.kind === "lead" || event.kind === "document" ? "/lead-mutation" : url,
    kind: event.kind === "notification" ? "notification" : event.kind === "staff" ? "staff" : "lead",
    eventType: event.eventType,
    leadId: event.leadId || event.lead?.leadId || "",
    caseId: event.caseId || event.lead?.caseId || "",
    status: event.status || event.lead?.status || "",
    dealershipId: event.dealershipId || event.lead?.dealershipId || "",
    bankId: event.bankId || event.lead?.bankId || "",
    executiveId: event.executiveId || event.lead?.assignedExecutiveId || "",
    financeManagerId: event.financeManagerId || event.lead?.financeManagerId || "",
    salespersonId: event.salespersonId || event.lead?.salespersonId || "",
    lead: event.lead || null,
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
  window.dispatchEvent(new CustomEvent("cls:realtime-event", { detail: event }));
  window.dispatchEvent(new CustomEvent("cls:data-mutated", { detail: mutationPayload(event) }));
}

function closeSource() {
  if (source) {
    source.close();
    source = null;
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
