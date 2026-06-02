import axios from "axios";
import { getToken } from "firebase/app-check";
import { appCheck } from "./firebase.js";
import { clearAuthStorage, getStoredToken, getStoredUser, publishAuthEvent, updateStoredToken } from "./authSessionManager.js";

const PRODUCTION_API_BASE_URL = "https://carloansaathi-apkaapnasaathi.onrender.com/api";
const DEFAULT_LOCAL_API_BASE_URL = "http://localhost:8080/api";

function normalizeApiUrl(url) {
  const trimmed = String(url || "").trim().replace(/\/+$|\s+/g, "");
  if (!trimmed) return trimmed;
  if (trimmed.endsWith("/api")) return trimmed;
  return `${trimmed.replace(/\/+$/, "")}/api`;
}

function apiBaseUrl() {
  let configured = import.meta.env.VITE_API_BASE_URL || DEFAULT_LOCAL_API_BASE_URL;
  if (typeof window === "undefined") return normalizeApiUrl(configured);

  configured = normalizeApiUrl(configured);
  const hostname = window.location.hostname.toLowerCase();
  const isLocalHost = ["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname);
  const isPrivateNetwork = /^10\.|^192\.168\.|^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
  const hasCustomApiBase = Boolean(import.meta.env.VITE_API_BASE_URL && !import.meta.env.VITE_API_BASE_URL.includes("api.example.com"));

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
  timeout: 15000,
  withCredentials: false,
});

let refreshPromise = null;

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
  return String(url).startsWith("/auth/login")
    || String(url).startsWith("/auth/session/restore")
    || String(url).startsWith("/auth/account-lookup")
    || String(url).startsWith("/auth/login-failure")
    || String(url).startsWith("/auth/password-reset");
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function ensureApiReady({ onStatus, maxWaitMs = 65000 } = {}) {
  const started = Date.now();
  let attempt = 0;
  while (Date.now() - started < maxWaitMs) {
    attempt += 1;
    try {
      onStatus?.(attempt === 1 ? "Checking secure login service..." : "Server is waking up. Please wait 30-60 seconds.");
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
  const error = new Error("Server is waking up. Please wait 30-60 seconds and try again.");
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
      headers: { Authorization: `Bearer ${token}` },
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
  if (token && !authEndpoint(config.url) && shouldRefreshToken(token)) {
    token = await refreshSessionToken().catch(() => token);
  }
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (appCheck) {
    try {
      const appCheckToken = await getToken(appCheck, false);
      if (appCheckToken?.token) config.headers["X-Firebase-AppCheck"] = appCheckToken.token;
    } catch {
      // Backend decides whether App Check is mandatory.
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
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
        const target = stored?.role === "loan-executive"
          ? "/executive/login"
          : stored?.role === "bank-manager"
            ? "/bank/login"
            : stored?.role === "super-admin"
              ? "/admin/login"
              : "/dealer/login";
        window.dispatchEvent(new CustomEvent("cls:auth-session-cleared", { detail: { code: error.response?.data?.code } }));
        if (!window.location.pathname.includes(target.replace("/", ""))) window.location.assign(target);
      }
    } else if (error.response?.status === 403 && error.response?.data?.code === "PASSWORD_CHANGE_REQUIRED") {
      if (typeof window !== "undefined" && error.response.data.redirectTo && window.location.pathname !== error.response.data.redirectTo) {
        window.location.assign(error.response.data.redirectTo);
      }
    } else if ([401, 403, 423].includes(error.response?.status) && [
      "ACCOUNT_DELETED",
      "ACCOUNT_INACTIVE",
      "ACCOUNT_LOCKED",
      "ACCOUNT_NOT_ACTIVE",
      "BANK_ACCOUNT_INACTIVE",
      "DEALER_ACCOUNT_INACTIVE",
      "INVALID_SESSION",
      "JWT_REQUIRED",
      "SESSION_ROLE_CHANGED",
      "SESSION_EXPIRED",
      "SESSION_REVOKED",
    ].includes(error.response?.data?.code)) {
      const stored = getStoredUser();
      clearAuthStorage();
      if (typeof window !== "undefined") {
        const target = stored?.role === "loan-executive"
          ? "/executive/login"
          : stored?.role === "bank-manager" || error.response?.data?.code === "BANK_ACCOUNT_INACTIVE"
            ? "/bank/login"
            : stored?.role === "super-admin"
              ? "/admin/login"
              : "/dealer/login";
        window.dispatchEvent(new CustomEvent("cls:auth-session-cleared", { detail: { code: error.response?.data?.code } }));
        publishAuthEvent("logout", { reason: error.response?.data?.code });
        if (!window.location.pathname.includes(target.replace("/", ""))) {
          window.location.assign(target);
        }
      }
    }
    return Promise.reject(error);
  }
);
