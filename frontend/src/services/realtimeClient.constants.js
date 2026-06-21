export const MUTATION_KINDS = new Set(["document", "notification", "staff", "bank", "dealer", "subscription"]);

export const HEARTBEAT_TIMEOUT_MS = 45_000;
export const ACK_FLUSH_MS = 2_000;
export const LEADER_HEARTBEAT_MS = 5_000;
export const LEADER_TTL_MS = 15_000;
export const RECONNECT_DELAYS_MS = [2_000, 5_000, 10_000];
export const REALTIME_EVENT_CHANNEL = "cls_realtime_event_v1";
export const REALTIME_EVENT_STORAGE_KEY = "cls_realtime_event_v1";
export const REALTIME_LEADER_PREFIX = "cls_realtime_leader_v1";
export const REALTIME_OWNER_KEY = "__CLS_REALTIME_CLIENT_OWNER";

export const TAB_ID = (() => {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
})();

export const PHASE_ONE_EVENTS = new Set([
  "LEAD_CREATED",
  "LEAD_STATUS_UPDATED",
  "LEAD_REMARK_ADDED",
  "DOCUMENT_UPLOADED",
]);
