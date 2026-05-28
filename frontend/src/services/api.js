import axios from "axios";
import { getToken } from "firebase/app-check";
import { appCheck } from "./firebase.js";

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

function getSessionToken() {
  const sessionToken = sessionStorage.getItem("cls_token");
  if (sessionToken) return sessionToken;

  const legacyToken = localStorage.getItem("cls_token");
  if (legacyToken) {
    sessionStorage.setItem("cls_token", legacyToken);
    localStorage.removeItem("cls_token");
  }
  return legacyToken;
}

function clearSessionToken() {
  sessionStorage.removeItem("cls_token");
  localStorage.removeItem("cls_token");
}

api.interceptors.request.use(async (config) => {
  const token = getSessionToken();
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
    } else if (error.response?.status === 404) {
      const baseURL = error.config?.baseURL || "";
      const url = error.config?.url || "";
      error.message = `API route not found: ${baseURL}${url}`;
    } else if ([401, 403].includes(error.response?.status) && ["DEALER_ACCOUNT_INACTIVE", "BANK_ACCOUNT_INACTIVE", "ACCOUNT_DELETED"].includes(error.response?.data?.code)) {
      localStorage.removeItem("cls_user");
      clearSessionToken();
      if (typeof window !== "undefined") {
        const target = error.response?.data?.code === "BANK_ACCOUNT_INACTIVE" ? "/bank-login" : "/dealer-login";
        if (!window.location.pathname.includes(target.replace("/", ""))) window.location.assign(target);
      }
    }
    return Promise.reject(error);
  }
);
