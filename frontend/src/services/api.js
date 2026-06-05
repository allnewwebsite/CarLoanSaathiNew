import axios from "axios";
import { getToken } from "firebase/app-check";
import { appCheck } from "./firebase.js";
import { clearAuthStorage, getCurrentPortalScope, getStoredToken, getStoredUser, publishAuthEvent, updateStoredToken } from "./authSessionManager.js";

const PRODUCTION_API_BASE_URL = "https://carloansaathi-apkaapnasaathi.onrender.com/api";
const DEFAULT_LOCAL_API_BASE_URL = "http://localhost:8080/api";
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const AUTH_REQUEST_TIMEOUT_MS = 60000;
const GET_CACHE_TTL_MS = 5 * 60 * 1000;
const GET_STALE_TTL_MS = 30 * 60 * 1000;
const APP_CHECK_CACHE_TTL_MS = 4 * 60 * 1000;

function normalizeApiUrl(url) {
  const trimmed = String(url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;
  if (trimmed.endsWith("/api")) return trimmed;
  return `${trimmed.replace(/\/+$/, "")}/api`;
}

function isLocalOrPrivateApiUrl(url) {
  try {
    const { hostname } = new URL(url);
    const normalized = hostname.toLowerCase();
    return ["localhost", "127.0.0.1", "0.0.0.0"].includes(normalized)
      || /^10\.|^192\.168\.|^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(normalized);
  } catch {
    return false;
  }
}

function apiBaseUrl() {
  let configured = import.meta.env.VITE_API_BASE_URL || DEFAULT_LOCAL_API_BASE_URL;
  if (typeof window === "undefined") return normalizeApiUrl(configured);

  configured = normalizeApiUrl(configured);
  const hostname = window.location.hostname.toLowerCase();
  const isLocalHost = ["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname);
  const isPrivateNetwork = /^10\.|^192\.168\.|^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
  const hasCustomApiBase = Boolean(import.meta.env.VITE_API_BASE_URL && !import.meta.env.VITE_API_BASE_URL.includes("api.example.com"));

  if (!isLocalHost && !isPrivateNetwork && isLocalOrPrivateApiUrl(configured)) {
    return PRODUCTION_API_BASE_URL;
  }

  if (hasCustomApiBase) {
    return configured;
  }

  if (!isLocalHost && !isPrivateNetwork) {
    return PRODUCTION_API_BASE_URL;
  }

  if ((configured.includes("localhost") || configured.includes("127.0.0.1")) && (isLocalHost || isPrivateNetwork)) {
    return configured.replace(/https?:\/\/(localhost|127\.0\.0\.1):8080/, `${window.location.protocol}//${window.location.hostname}:8080`);
  }

  return configured;
}

export const api = axios.create({
  baseURL: apiBaseUrl(),
  timeout: DEFAULT_REQUEST_TIMEOUT_MS,
  withCredentials: false,
});

let refreshPromise = null;
const getCache = new Map();
let appCheckCache = { token: "", expiresAt: 0, promise: null };

function stableParams(params) {
  if (!params) return "";
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function getCacheKey(url = "", params = null, baseURL = apiBaseUrl()) {
  if (authEndpoint(url)) return "";
  return `${baseURL}|${url || ""}|${stableParams(params)}|${requestPortalHeader()}`;
}

function cacheKey(config = {}) {
  const method = String(config.method || "get").toLowerCase();
  if (method !== "get") return "";
  return getCacheKey(config.url, config.params, config.baseURL || apiBaseUrl());
}

function cachedResponse(config) {
  const key = cacheKey(config);
  if (!key) return null;
  const entry = getCache.get(key);
  if (!entry || entry.stale || entry.expiresAt <= Date.now()) return null;
  return { ...entry.response, config, request: { cached: true } };
}

function rememberGetResponse(response) {
  const key = cacheKey(response.config);
  if (!key) return;
  getCache.set(key, {
    url: response.config?.url || "",
    params: response.config?.params || null,
    expiresAt: Date.now() + Number(response.config?.cacheTtlMs || GET_CACHE_TTL_MS),
    staleUntil: Date.now() + GET_STALE_TTL_MS,
    stale: false,
    response: {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    },
  });
}

export function getCachedGetData(url, params = null, { includeStale = true } = {}) {
  const key = getCacheKey(url, params);
  if (!key) return null;
  const entry = getCache.get(key);
  if (!entry) return null;
  const now = Date.now();
  if (entry.expiresAt <= now && (!includeStale || entry.staleUntil <= now)) return null;
  return entry.response.data;
}

export function findCachedGetItem(url, matcher) {
  if (typeof matcher !== "function") return null;
  for (const entry of getCache.values()) {
    if (!entry || (entry.expiresAt <= Date.now() && entry.staleUntil <= Date.now()) || entry.url !== url) continue;
    const payload = entry.response?.data;
    const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    const found = rows.find(matcher);
    if (found) return found;
    if (payload && typeof payload === "object") {
      for (const value of Object.values(payload)) {
        if (!Array.isArray(value)) continue;
        const nestedFound = value.find(matcher);
        if (nestedFound) return nestedFound;
      }
    }
  }
  return null;
}

export function prefetchGet(url, params = null, options = {}) {
  if (getCachedGetData(url, params)) return Promise.resolve(null);
  return api.get(url, {
    ...options,
    params,
    silent: true,
    timeout: Math.min(Number(options.timeout) || DEFAULT_REQUEST_TIMEOUT_MS, 10000),
  }).catch(() => null);
}

export function invalidateGetCache({ url, prefix } = {}) {
  const now = Date.now();
  for (const [key, entry] of getCache.entries()) {
    if (!entry) continue;
    const matches = url ? entry.url === url : prefix ? String(entry.url || "").startsWith(prefix) : true;
    if (!matches) continue;
    entry.stale = true;
    entry.expiresAt = now - 1;
    entry.staleUntil = Math.max(entry.staleUntil || 0, now + GET_STALE_TTL_MS);
    getCache.set(key, entry);
  }
}

async function appCheckHeaderToken() {
  if (!appCheck) return "";
  if (appCheckCache.token && appCheckCache.expiresAt > Date.now()) return appCheckCache.token;
  if (!appCheckCache.promise) {
    appCheckCache.promise = getToken(appCheck, false)
      .then((token) => {
        appCheckCache = {
          token: token?.token || "",
          expiresAt: Date.now() + APP_CHECK_CACHE_TTL_MS,
          promise: null,
        };
        return appCheckCache.token;
      })
      .catch(() => {
        appCheckCache.promise = null;
        return "";
      });
  }
  return appCheckCache.promise;
}

function jwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

function shouldRefreshToken(token) {
  const payload = jwtPayload(token);
  if (!payload?.exp) return false;
  return payload.exp * 1000 - Date.now() < 5 * 60 * 1000;
}

function authEndpoint(url = "") {
  const path = String(url).split("?")[0];
  return path === "/auth/login"
    || path === "/auth/session/restore"
    || path === "/auth/account-lookup"
    || path === "/auth/login-failure"
    || path.startsWith("/auth/password-reset");
}

function loginPathForRole(role, fallback = "/finance/login") {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "loan-executive") return "/executive/login";
  if (normalized === "bank-manager") return "/bank/login";
  if (normalized === "super-admin") return "/admin/login";
  if (normalized === "finance-desk" || normalized === "gm-sm") return "/finance/login";
  return fallback;
}

function currentLoginPath() {
  if (typeof window === "undefined") return "";
  const path = window.location.pathname || "";
  if (path.startsWith("/finance/login") || path.startsWith("/gm/login")) return "/finance/login";
  if (path.startsWith("/dealer/login")) return "/dealer/login";
  if (path.startsWith("/bank/login")) return "/bank/login";
  if (path.startsWith("/executive/login")) return "/executive/login";
  if (path.startsWith("/admin/login")) return "/admin/login";
  return "";
}

function loginPathForCurrentPortal(fallback = "/finance/login") {
  if (typeof window === "undefined") return fallback;
  const path = window.location.pathname || "";
  if (path.startsWith("/bank-manager") || path.startsWith("/bank")) return "/bank/login";
  if (path.startsWith("/loan-executive") || path.startsWith("/executive")) return "/executive/login";
  if (path.startsWith("/admin") || path.startsWith("/super-admin")) return "/admin/login";
  if (path.startsWith("/dealer/login")) return "/dealer/login";
  if (path.startsWith("/dealer") || path.startsWith("/finance") || path.startsWith("/gm")) return "/finance/login";
  return fallback;
}

function requestPortalHeader() {
  return getCurrentPortalScope() || loginPathForCurrentPortal().replace(/^\//, "").split("/")[0] || "finance";
}

function redirectToLoginForRole(role, fallback = "/finance/login") {
  if (typeof window === "undefined" || currentLoginPath()) return;
  const target = loginPathForRole(role, fallback || loginPathForCurrentPortal());
  if (window.location.pathname !== target) window.location.assign(target);
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function shouldRetryAuthNetworkError(error) {
  if (!authEndpoint(error.config?.url) || error.config?._authNetworkRetry) return false;
  return error.code === "ERR_NETWORK" || error.code === "ECONNABORTED" || !error.response;
}

export async function ensureApiReady({ onStatus, maxWaitMs = 65000 } = {}) {
  const started = Date.now();
  let attempt = 0;
  while (Date.now() - started < maxWaitMs) {
    attempt += 1;
    try {
      onStatus?.(attempt === 1 ? "Checking secure login service." : "Server is warming up. Try again shortly.");
      const response = await axios.get(`${apiBaseUrl()}/health`, {
        timeout: attempt === 1 ? 6000 : 10000,
        headers: { "X-CLS-Warmup": "true" },
      });
      if (["ok", "degraded"].includes(response.data?.status) || response.status === 200) return response.data;
    } catch (error) {
      if (error.response?.status && error.response.status < 500) throw error;
    }
    await sleep(Math.min(2000 + attempt * 500, 5000));
  }
  const error = new Error("Server is warming up. Try again shortly.");
  error.code = "BACKEND_WARMUP_TIMEOUT";
  throw error;
}

async function refreshSessionToken() {
  const token = getStoredToken();
  if (!token) return null;
  if (!refreshPromise) {
    refreshPromise = axios.post(`${apiBaseUrl()}/auth/session/refresh`, null, {
      timeout: 10000,
      withCredentials: false,
      headers: { Authorization: `Bearer ${token}`, "X-CLS-Portal": requestPortalHeader() },
    }).then((response) => {
      if (response.data?.token) {
        updateStoredToken(response.data.token);
        window.dispatchEvent(new CustomEvent("cls:auth-token-refreshed", { detail: response.data }));
        return response.data.token;
      }
      return null;
    }).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

function portalWarmupPath(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "super-admin") return "/admin/leads";
  if (normalized === "bank-manager" || normalized === "loan-executive") return "/bank/leads";
  if (normalized === "gm-sm") return "/gm/leads";
  if (normalized === "finance-desk" || normalized === "dealer") return "/dealer/leads";
  return null;
}

export async function warmupPortalRoute(role) {
  const route = portalWarmupPath(role);
  if (!route) return null;

  try {
    await api.get("/warmup", {
      timeout: 10000,
      headers: { "X-CLS-Warmup": "true" },
      params: { route },
    });
  } catch {
    // best-effort backend warmup
  }

  try {
    return await api.get(route, {
      timeout: 10000,
      headers: { "X-CLS-Warmup": "true" },
      params: { limit: 1 },
    });
  } catch {
    await sleep(1000);
    try {
      return await api.get(route, {
        timeout: 10000,
        headers: { "X-CLS-Warmup": "true" },
        params: { limit: 1 },
      });
    } catch {
      return null;
    }
  }
}

api.interceptors.request.use(async (config) => {
  let token = getStoredToken();
  const isAuthEndpoint = authEndpoint(config.url);
  config.headers = config.headers || {};
  config.headers["X-CLS-Portal"] = requestPortalHeader();
  const cached = cachedResponse(config);
  if (cached) {
    config.adapter = () => Promise.resolve(cached);
    return config;
  }
  if (isAuthEndpoint) {
    config.timeout = Math.max(Number(config.timeout) || 0, AUTH_REQUEST_TIMEOUT_MS);
  }
  if (token && !isAuthEndpoint && shouldRefreshToken(token)) {
    token = await refreshSessionToken().catch(() => token);
  }
  if (token && !isAuthEndpoint) config.headers.Authorization = `Bearer ${token}`;
  const appCheckToken = await appCheckHeaderToken();
  if (appCheckToken) config.headers["X-Firebase-AppCheck"] = appCheckToken;
  return config;
});

api.interceptors.response.use(
  (response) => {
    if (!response.request?.cached) rememberGetResponse(response);
    if (!["get", "head", "options"].includes(String(response.config?.method || "get").toLowerCase())) {
      const url = String(response.config?.url || "");
      if (url.startsWith("/bank/")) invalidateGetCache({ prefix: "/bank/" });
      else if (url.startsWith("/dealer/") || url.startsWith("/documents/")) invalidateGetCache({ prefix: "/dealer/" });
      else if (url.startsWith("/gm/")) invalidateGetCache({ prefix: "/gm/" });
      else if (url.startsWith("/admin/")) invalidateGetCache({ prefix: "/admin/" });
      else if (url.startsWith("/notifications")) invalidateGetCache({ prefix: "/notifications" });
      else invalidateGetCache();
    }
    return response;
  },
  async (error) => {
    if (shouldRetryAuthNetworkError(error)) {
      error.config._authNetworkRetry = true;
      await sleep(1200);
      return api(error.config);
    }
    if (error.code === "ECONNABORTED") {
      error.message = "Request timed out. Please try again.";
    } else if (error.code === "ERR_NETWORK" || !error.response) {
      error.message = "Could not reach CarLoanSaathi secure service. Check your connection and try again.";
    } else if (error.response?.status === 404) {
      const baseURL = error.config?.baseURL || "";
      const url = error.config?.url || "";
      error.message = `API route not found: ${baseURL}${url}`;
    } else if (error.response?.status === 401 && !error.config?._authRetry && !authEndpoint(error.config?.url)) {
      error.config._authRetry = true;
      const refreshed = await refreshSessionToken().catch(() => null);
      if (refreshed) {
        error.config.headers = { ...(error.config.headers || {}), Authorization: `Bearer ${refreshed}` };
        return api(error.config);
      }
      const stored = getStoredUser();
      clearAuthStorage();
      publishAuthEvent("logout", { reason: error.response?.data?.code || "session-refresh-failed" });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("cls:auth-session-cleared", { detail: { code: error.response?.data?.code } }));
        redirectToLoginForRole(stored?.role, loginPathForCurrentPortal());
      }
    } else if (error.response?.status === 403 && error.response?.data?.code === "PASSWORD_CHANGE_REQUIRED") {
      if (typeof window !== "undefined" && error.response.data.redirectTo && window.location.pathname !== error.response.data.redirectTo) {
        window.location.assign(error.response.data.redirectTo);
      }
    } else if ([401, 403, 423].includes(error.response?.status) && [
      "ACCOUNT_DELETED",
      "ACCOUNT_DISABLED",
      "ACCOUNT_INACTIVE",
      "IDENTITY_COLLISION",
      "ACCOUNT_LOCKED",
      "ACCOUNT_NOT_ACTIVE",
      "BANK_ACCOUNT_INACTIVE",
      "DEALER_ACCOUNT_INACTIVE",
      "INVALID_SESSION",
      "JWT_REQUIRED",
      "PORTAL_FORBIDDEN",
      "SESSION_ROLE_CHANGED",
      "SESSION_EXPIRED",
      "SESSION_PORTAL_CHANGED",
      "SESSION_UID_CHANGED",
      "SESSION_REVOKED",
    ].includes(error.response?.data?.code)) {
      const stored = getStoredUser();
      clearAuthStorage();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("cls:auth-session-cleared", { detail: { code: error.response?.data?.code } }));
        publishAuthEvent("logout", { reason: error.response?.data?.code });
        redirectToLoginForRole(stored?.role, error.response?.data?.code === "BANK_ACCOUNT_INACTIVE" ? "/bank/login" : loginPathForCurrentPortal());
      }
    }
    return Promise.reject(error);
  }
);
