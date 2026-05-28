import axios from "axios";
import { getToken } from "firebase/app-check";
import { appCheck } from "./firebase.js";
import { clearAuthStorage, getStoredToken, getStoredUser, publishAuthEvent, updateStoredToken } from "./authSessionManager.js";

const PRODUCTION_API_BASE_URL = "https://carloansaathi-apkaapnasaathi.onrender.com/api";

function apiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080/api";
  if (typeof window === "undefined") return configured;

  const isProductionHost = /(^|\.)carloansaathi\.com$/i.test(window.location.hostname);
  if (isProductionHost && (!configured || configured.includes("api.example.com"))) {
    return PRODUCTION_API_BASE_URL;
  }

  if (isProductionHost && configured === "https://carloansaathi-backend.onrender.com") {
    return PRODUCTION_API_BASE_URL;
  }

  const isLocalhostApi = configured.includes("localhost") || configured.includes("127.0.0.1");
  const isLanFrontend = !["localhost", "127.0.0.1"].includes(window.location.hostname);

  if (isLocalhostApi && isLanFrontend) {
    return configured.replace(/https?:\/\/(localhost|127\.0\.0\.1):8080/, `${window.location.protocol}//${window.location.hostname}:8080`);
  }

  return configured;
}

export const api = axios.create({
  baseURL: apiBaseUrl(),
  timeout: 15000,
  withCredentials: true,
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

async function refreshSessionToken() {
  const token = getStoredToken();
  if (!token) return null;
  if (!refreshPromise) {
    refreshPromise = axios.post(`${apiBaseUrl()}/auth/session/refresh`, null, {
      timeout: 10000,
      withCredentials: true,
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
          ? "/loan-executive/login"
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
          ? "/loan-executive/login"
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
