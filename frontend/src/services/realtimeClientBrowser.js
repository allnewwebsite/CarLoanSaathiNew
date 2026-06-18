import { getStoredUser } from "./authSessionManager.js";
import {
  LEADER_TTL_MS,
  REALTIME_LEADER_PREFIX,
  REALTIME_OWNER_KEY,
  TAB_ID,
} from "./realtimeClient.constants.js";

function realtimeStorageKey() {
  const user = getStoredUser() || {};
  const identity = user.uid || user.email || "anonymous";
  return `cls_realtime_last_event_id:${user.role || "unknown"}:${identity}`;
}

export function readStoredLastEventId() {
  try {
    return sessionStorage.getItem(realtimeStorageKey()) || "";
  } catch {
    return "";
  }
}

export function writeStoredLastEventId(id = "") {
  const value = String(id || "");
  if (!value) return "";
  try {
    sessionStorage.setItem(realtimeStorageKey(), value);
  } catch {
    // Last-event persistence is best-effort recovery metadata.
  }
  return value;
}

function leaderStorageKey(identity = "") {
  return `${REALTIME_LEADER_PREFIX}:${identity || "anonymous"}`;
}

export function readLeader(identity = "") {
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

export function writeLeader(identity = "") {
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

export function releaseLeader(identity = "") {
  if (typeof window === "undefined" || !identity) return;
  try {
    const leader = readLeader(identity);
    if (leader?.tabId === TAB_ID) window.localStorage?.removeItem(leaderStorageKey(identity));
  } catch {
    // Leader release is best effort.
  }
}

export function hasBrowserSingletonOwner(identity = "") {
  if (typeof window === "undefined") return true;
  const owner = window[REALTIME_OWNER_KEY];
  if (!owner || owner.tabId === TAB_ID || Number(owner.expiresAt || 0) <= Date.now()) {
    window[REALTIME_OWNER_KEY] = { tabId: TAB_ID, identity, expiresAt: Date.now() + LEADER_TTL_MS };
    return true;
  }
  return false;
}

export function refreshBrowserSingletonOwner(identity = "", active = false) {
  if (typeof window === "undefined" || !active || !identity) return;
  if (window[REALTIME_OWNER_KEY]?.tabId === TAB_ID) {
    window[REALTIME_OWNER_KEY] = { tabId: TAB_ID, identity, expiresAt: Date.now() + LEADER_TTL_MS };
  }
}

export function releaseBrowserSingletonOwner() {
  if (typeof window !== "undefined" && window[REALTIME_OWNER_KEY]?.tabId === TAB_ID) {
    delete window[REALTIME_OWNER_KEY];
  }
}
