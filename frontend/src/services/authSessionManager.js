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
const ACTIVE_SCOPE_KEY = "cls_active_auth_scope";

const ROLE_SCOPES = {
  "finance-desk": "finance",
  "gm-sm": "gm",
  "bank-manager": "bank-manager",
  "loan-executive": "loan-executive",
  "super-admin": "admin",
};

function browserPath() {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

function scopeFromRole(role) {
  return ROLE_SCOPES[String(role || "").trim().toLowerCase()] || null;
}

function scopeFromPath(path = browserPath()) {
  const normalized = String(path || "").toLowerCase();
  if (normalized.startsWith("/gm")) return "gm";
  if (normalized.startsWith("/finance") || normalized.startsWith("/dealer")) return "finance";
  if (normalized.startsWith("/bank-manager") || normalized.startsWith("/bank")) return "bank-manager";
  if (normalized.startsWith("/loan-executive") || normalized.startsWith("/executive")) return "loan-executive";
  if (normalized.startsWith("/admin") || normalized.startsWith("/super-admin")) return "admin";
  return sessionStorage.getItem(ACTIVE_SCOPE_KEY) || "finance";
}

function scopedKey(key, scope = scopeFromPath()) {
  return `${key}:${scope}`;
}

function parseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function legacyUserForScope(scope) {
  const legacyUser = parseJson(sessionStorage.getItem(USER_KEY));
  return scopeFromRole(legacyUser?.role) === scope ? legacyUser : null;
}

export function authPersistenceMode() {
  return "session";
}

export function getStoredToken() {
  const scope = scopeFromPath();
  const scoped = sessionStorage.getItem(scopedKey(TOKEN_KEY, scope));
  if (scoped) return scoped;
  return legacyUserForScope(scope) ? sessionStorage.getItem(TOKEN_KEY) : null;
}

export function getStoredUser() {
  const scope = scopeFromPath();
  return parseJson(sessionStorage.getItem(scopedKey(USER_KEY, scope))) || legacyUserForScope(scope);
}

export function storeAuthSession(session, token) {
  const scope = scopeFromRole(session?.role) || scopeFromPath();
  sessionStorage.setItem(scopedKey(USER_KEY, scope), JSON.stringify(session));
  sessionStorage.setItem(scopedKey(PERSISTENCE_KEY, scope), "session");
  sessionStorage.setItem(ACTIVE_SCOPE_KEY, scope);
  if (token) sessionStorage.setItem(scopedKey(TOKEN_KEY, scope), token);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(PERSISTENCE_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PERSISTENCE_KEY);
}

export function updateStoredToken(token) {
  if (!token) return;
  const scope = scopeFromRole(getStoredUser()?.role) || scopeFromPath();
  sessionStorage.setItem(scopedKey(TOKEN_KEY, scope), token);
  localStorage.removeItem(TOKEN_KEY);
}

export function clearAuthStorage() {
  const scope = scopeFromPath();
  sessionStorage.removeItem(scopedKey(TOKEN_KEY, scope));
  sessionStorage.removeItem(scopedKey(USER_KEY, scope));
  sessionStorage.removeItem(scopedKey(PERSISTENCE_KEY, scope));
  sessionStorage.removeItem("cls_session_only");
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(PERSISTENCE_KEY);
  if (sessionStorage.getItem(ACTIVE_SCOPE_KEY) === scope) sessionStorage.removeItem(ACTIVE_SCOPE_KEY);
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
