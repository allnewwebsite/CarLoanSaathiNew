export const AUTH_STATES = {
  LOADING: "AUTH_LOADING",
  AUTHENTICATED: "AUTHENTICATED",
  UNAUTHORIZED: "UNAUTHORIZED",
  ROLE_MISMATCH: "ROLE_MISMATCH",
  PASSWORD_EXPIRED: "PASSWORD_EXPIRED",
  APPROVAL_PENDING: "APPROVAL_PENDING",
  FAILED: "AUTH_FAILED",
};

const TOKEN_KEY = "cls_token";
const USER_KEY = "cls_user";
const PERSISTENCE_KEY = "cls_auth_persistence";
const AUTH_CHANNEL = "cls_auth_channel";

export function authPersistenceMode() {
  return "session";
}

export function getStoredToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function getStoredUser() {
  const raw = sessionStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function storeAuthSession(session, token) {
  sessionStorage.setItem(USER_KEY, JSON.stringify(session));
  sessionStorage.setItem(PERSISTENCE_KEY, "session");
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PERSISTENCE_KEY);
}

export function updateStoredToken(token) {
  if (!token) return;
  sessionStorage.setItem(TOKEN_KEY, token);
  localStorage.removeItem(TOKEN_KEY);
}

export function clearAuthStorage() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(PERSISTENCE_KEY);
  sessionStorage.removeItem("cls_session_only");
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(PERSISTENCE_KEY);
  localStorage.removeItem("cls_session_only");
}

export function publishAuthEvent(type, payload = {}) {
  if (type === "logout") return;
  const event = { type, payload, at: Date.now() };
  localStorage.setItem(AUTH_CHANNEL, JSON.stringify(event));
  localStorage.removeItem(AUTH_CHANNEL);
  if ("BroadcastChannel" in window) {
    const channel = new BroadcastChannel(AUTH_CHANNEL);
    channel.postMessage(event);
    channel.close();
  }
}

export function subscribeAuthEvents(callback) {
  const onStorage = (event) => {
    if (event.key !== AUTH_CHANNEL || !event.newValue) return;
    try {
      callback(JSON.parse(event.newValue));
    } catch {
      // Ignore malformed cross-tab messages.
    }
  };
  window.addEventListener("storage", onStorage);
  let channel = null;
  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel(AUTH_CHANNEL);
    channel.onmessage = (event) => callback(event.data);
  }
  return () => {
    window.removeEventListener("storage", onStorage);
    if (channel) channel.close();
  };
}

export function passwordExpiryWarning(user) {
  if (!user?.passwordExpiresAt || user.passwordExpired) return "";
  const days = Number(user.passwordDaysRemaining);
  if (!Number.isFinite(days) || days > 7) return "";
  if (days <= 0) return "Your password expires today. Please change it.";
  return `Your password expires in ${days} day${days === 1 ? "" : "s"}.`;
}
