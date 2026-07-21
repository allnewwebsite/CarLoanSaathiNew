import axios from "axios";
import { clearAuthStorage, getAuthScope, getStoredToken, getStoredUser, publishAuthEvent, updateStoredToken } from "./authSessionManager.js";
import { apiBaseUrl } from "./apiBaseUrl.js";
import { loginPathForCurrentPortal, redirectToLoginForRole, requestPortalHeader } from "./apiPortal.js";

let refreshPromise = null;

function jwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

export function shouldRefreshToken(token) {
  const payload = jwtPayload(token);
  if (!payload?.exp) return false;
  return payload.exp * 1000 - Date.now() < 5 * 60 * 1000;
}

export function authEndpoint(url = "") {
  const path = String(url).split("?")[0];
  return path === "/auth/login"
    || path === "/auth/session/restore"
    || path === "/auth/account-lookup"
    || path === "/auth/login-failure"
    || path.startsWith("/auth/password-reset");
}

export function shouldRetryAuthNetworkError(error) {
  if (!authEndpoint(error.config?.url) || error.config?._authNetworkRetry) return false;
  return error.code === "ERR_NETWORK" || error.code === "ECONNABORTED" || !error.response;
}

export async function refreshSessionToken() {
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

export async function handleAuthResponseError(error, api) {
  const responseCode = error.response?.data?.code || error.response?.data?.errorCode;
  if (error.response?.status === 401 && !error.config?._authRetry && !authEndpoint(error.config?.url)) {
    error.config._authRetry = true;
    const refreshed = await refreshSessionToken().catch(() => null);
    if (refreshed) {
      error.config.headers = { ...(error.config.headers || {}), Authorization: `Bearer ${refreshed}` };
      return api(error.config);
    }
    const stored = getStoredUser();
    const scope = getAuthScope();
    clearAuthStorage();
    publishAuthEvent("logout", { scope, reason: responseCode || "session-refresh-failed" });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("cls:auth-session-cleared", { detail: { code: error.response?.data?.code } }));
      redirectToLoginForRole(stored?.role, loginPathForCurrentPortal());
    }
    return null;
  }

  if (error.response?.status === 403 && error.response?.data?.code === "PASSWORD_CHANGE_REQUIRED") {
    if (typeof window !== "undefined" && error.response.data.redirectTo && window.location.pathname !== error.response.data.redirectTo) {
      window.location.assign(error.response.data.redirectTo);
    }
    return null;
  }

  // Subscription is an entitlement, not an authentication failure. Keep the
  // scoped JWT/session intact and move only this tab to the renewal page.
  if (error.response?.status === 403 && ["SUBSCRIPTION_EXPIRED", "SUBSCRIPTION_PAYMENT_REQUIRED"].includes(responseCode)) {
    if (typeof window !== "undefined" && window.location.pathname !== "/subscription-activation") {
      window.location.assign(error.response?.data?.redirect || "/subscription-activation");
    }
    return null;
  }

  if ([401, 403, 423].includes(error.response?.status) && [
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
    "SESSION_ORGANIZATION_CHANGED",
    "SESSION_EXPIRED",
    "SESSION_PORTAL_CHANGED",
    "SESSION_UID_CHANGED",
    "SESSION_REVOKED",
  ].includes(responseCode)) {
    const stored = getStoredUser();
    const scope = getAuthScope();
    clearAuthStorage();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("cls:auth-session-cleared", { detail: { code: responseCode } }));
      publishAuthEvent("logout", { scope, reason: responseCode });
      redirectToLoginForRole(stored?.role, responseCode === "BANK_ACCOUNT_INACTIVE" ? "/bank/login" : loginPathForCurrentPortal());
    }
  }

  return null;
}
