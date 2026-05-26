import axios from "axios";

const PRODUCTION_API_BASE_URL = "https://carloansaathi-backend.onrender.com/api";

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
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("cls_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
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
      localStorage.removeItem("cls_token");
      if (typeof window !== "undefined") {
        const target = error.response?.data?.code === "BANK_ACCOUNT_INACTIVE" ? "/bank-login" : "/dealer-login";
        if (!window.location.pathname.includes(target.replace("/", ""))) window.location.assign(target);
      }
    }
    return Promise.reject(error);
  }
);
