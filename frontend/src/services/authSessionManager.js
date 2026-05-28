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

export function authPersistenceMode() {
  if (sessionStorage.getItem(PERSISTENCE_KEY) === "session") return "session";
  if (localStorage.getItem(PERSISTENCE_KEY) === "local") return "local";
  return "local";
}

export function getStoredToken() {
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser() {
  const raw = sessionStorage.getItem(USER_KEY) || localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function storeAuthSession(session, token, { rememberMe = true } = {}) {
  const durable = rememberMe !== false;
  const primary = durable ? localStorage : sessionStorage;
  const secondary = durable ? sessionStorage : localStorage;
  primary.setItem(USER_KEY, JSON.stringify(session));
  primary.setItem(PERSISTENCE_KEY, durable ? "local" : "session");
  if (token) primary.setItem(TOKEN_KEY, token);
  secondary.removeItem(USER_KEY);
  secondary.removeItem(TOKEN_KEY);
  secondary.removeItem(PERSISTENCE_KEY);
}

export function clearAuthStorage() {
  for (const storage of [localStorage, sessionStorage]) {
    storage.removeItem(TOKEN_KEY);
    storage.removeItem(USER_KEY);
    storage.removeItem(PERSISTENCE_KEY);
    storage.removeItem("cls_session_only");
  }
}

export function passwordExpiryWarning(user) {
  if (!user?.passwordExpiresAt || user.passwordExpired) return "";
  const days = Number(user.passwordDaysRemaining);
  if (!Number.isFinite(days) || days > 7) return "";
  if (days <= 0) return "Your password expires today. Please change it.";
  return `Your password expires in ${days} day${days === 1 ? "" : "s"}.`;
}
