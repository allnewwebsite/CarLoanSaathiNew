import axios from "axios";
import { getToken } from "firebase/app-check";
import { appCheck } from "./firebase.js";
import { clearAuthStorage, getStoredToken, getStoredUser } from "./authSessionManager.js";

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

api.interceptors.request.use(async (config) => {
  const token = getStoredToken();
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
  (error) => {
    if (error.code === "ECONNABORTED") {
      error.message = "Request timed out. Please try again.";
    } else if (error.code === "ERR_NETWORK" || !error.response) {
      error.message = "Could not reach CarLoanSaathi secure service. Check your connection and try again.";
    } else if (error.response?.status === 404) {
      const baseURL = error.config?.baseURL || "";
      const url = error.config?.url || "";
      error.message = `API route not found: ${baseURL}${url}`;
    } else if ([401, 403, 423].includes(error.response?.status) && [
      "ACCOUNT_DELETED",
      "ACCOUNT_INACTIVE",
      "ACCOUNT_LOCKED",
      "ACCOUNT_NOT_ACTIVE",
      "BANK_ACCOUNT_INACTIVE",
      "DEALER_ACCOUNT_INACTIVE",
      "INVALID_SESSION",
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
        if (!window.location.pathname.includes(target.replace("/", ""))) window.location.assign(target);
      }
    }
    return Promise.reject(error);
  }
);
