import axios from "axios";
import Constants from "expo-constants";
import { session } from "../auth/session";

function baseUrl() {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL || Constants.expoConfig?.extra?.apiBaseUrl || "";
  const value = String(configured).trim().replace(/\/+$/, "");
  if (!value) throw new Error("EXPO_PUBLIC_API_BASE_URL is required.");
  return value.endsWith("/api") ? value : `${value}/api`;
}

export const API_BASE_URL = baseUrl();
export const api = axios.create({ baseURL: API_BASE_URL, timeout: 20_000, headers: { "X-CLS-Portal": "finance" } });

let refreshPromise: Promise<string | null> | null = null;
let unauthorizedHandler: (() => void) | undefined;
export function setUnauthorizedHandler(handler: () => void) { unauthorizedHandler = handler; }

async function refreshToken() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const token = await session.getToken();
    if (!token) return null;
    const response = await axios.post(`${API_BASE_URL}/auth/session/refresh`, undefined, { headers: { Authorization: `Bearer ${token}`, "X-CLS-Portal": "finance" }, timeout: 20_000 });
    const next = String(response.data?.token || "");
    if (!next) return null;
    const user = response.data?.user || await session.getUser();
    if (user) await session.set(next, user);
    return next;
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

api.interceptors.request.use(async (config) => {
  const token = await session.getToken();
  config.headers = config.headers || {};
  config.headers["X-CLS-Portal"] = "finance";
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use((response) => response, async (error) => {
  const config = error.config || {};
  const url = String(config.url || "");
  if (error.response?.status === 401 && !config._authRetried && !url.includes("/auth/login") && !url.includes("/auth/session/refresh")) {
    config._authRetried = true;
    try {
      const next = await refreshToken();
      if (next) {
        config.headers = { ...config.headers, Authorization: `Bearer ${next}` };
        return api.request(config);
      }
    } catch { /* handled below */ }
    await session.clear();
    unauthorizedHandler?.();
  }
  error.userMessage = error.response?.data?.message || (error.response?.status === 403 ? "You are not authorized to access this data." : error.response?.status >= 500 ? "CarLoanSaathi is temporarily unavailable." : "Something went wrong. Please try again.");
  return Promise.reject(error);
});

export const errorMessage = (error: any) => error?.userMessage || error?.response?.data?.message || "Something went wrong. Please try again.";
