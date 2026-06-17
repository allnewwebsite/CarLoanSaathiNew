import axios from "axios";
import { clearAuthStorage, getCurrentPortalScope, getStoredToken, getStoredUser, publishAuthEvent, updateStoredToken } from "./authSessionManager.js";
import { markApiRequestStart, markApiResponseEnd } from "./frontendLatency.js";

const DEFAULT_LOCAL_API_BASE_URL = "http://localhost:8080/api";
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const AUTH_REQUEST_TIMEOUT_MS = 60000;
const GET_CACHE_TTL_MS = 5 * 60 * 1000;
const GET_STALE_TTL_MS = 30 * 60 * 1000;
const APP_CHECK_CACHE_TTL_MS = 4 * 60 * 1000;
const GET_CACHE_STORAGE_KEY = "cls_get_cache_v3";
const GET_CACHE_MAX_ENTRIES = 180;
const DATA_MUTATION_CHANNEL = "cls_data_mutation_v1";
const DATA_MUTATION_STORAGE_KEY = "cls_data_mutation_event_v1";
const NOTIFICATION_CACHE_TTL_MS = 60 * 1000;
const STATIC_CACHE_TTL_MS = 10 * 60 * 1000;

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

export function apiBaseUrl() {
  const configuredEnv = import.meta.env.VITE_API_BASE_URL;
  let configured = configuredEnv || (import.meta.env.PROD ? "/api" : DEFAULT_LOCAL_API_BASE_URL);
  if (typeof window === "undefined") return normalizeApiUrl(configured);

  configured = normalizeApiUrl(configured);
  const hostname = window.location.hostname.toLowerCase();
  const isLocalHost = ["localhost", "127.0.0.1", "0.0.0.0"].includes(hostname);
  const isPrivateNetwork = /^10\.|^192\.168\.|^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
  const hasCustomApiBase = Boolean(configuredEnv && !configuredEnv.includes("api.example.com"));

  if (!isLocalHost && !isPrivateNetwork && isLocalOrPrivateApiUrl(configured) && import.meta.env.PROD) {
    return normalizeApiUrl("/api");
  }

  if (hasCustomApiBase) {
    return configured;
  }

  if (!isLocalHost && !isPrivateNetwork && !hasCustomApiBase) {
    return normalizeApiUrl("/api");
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
const pendingGetRequests = new Map();
let appCheckCache = { token: "", expiresAt: 0, promise: null };
let appCheckModulePromise = null;
let getCacheHydrated = false;
let getCachePersistTimer = null;
let dataMutationChannel = null;
let dataMutationListenersReady = false;
let lastRemoteMutationKey = "";
const dataMutationSource = (() => {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
})();

function browserStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

function hydrateGetCache() {
  if (getCacheHydrated) return;
  getCacheHydrated = true;
  const storage = browserStorage();
  if (!storage) return;
  try {
    const raw = storage.getItem(GET_CACHE_STORAGE_KEY);
    const entries = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    if (!Array.isArray(entries)) return;
    entries.forEach(([key, entry]) => {
      if (!key || !entry?.response || Number(entry.staleUntil || 0) <= now) return;
      getCache.set(key, entry);
    });
  } catch {
    getCache.clear();
  }
}

function trimGetCache() {
  if (getCache.size <= GET_CACHE_MAX_ENTRIES) return;
  const sorted = [...getCache.entries()].sort(([, left], [, right]) => Number(left.staleUntil || 0) - Number(right.staleUntil || 0));
  sorted.slice(0, Math.max(0, sorted.length - GET_CACHE_MAX_ENTRIES)).forEach(([key]) => getCache.delete(key));
}

function persistGetCache() {
  const storage = browserStorage();
  if (!storage) return;
  try {
    trimGetCache();
    const now = Date.now();
    const entries = [...getCache.entries()].filter(([, entry]) => entry?.response && Number(entry.staleUntil || 0) > now);
    storage.setItem(GET_CACHE_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Persistent cache is an optimization only.
  }
}

function scheduleGetCachePersist() {
  if (typeof window === "undefined") return;
  if (getCachePersistTimer) window.clearTimeout(getCachePersistTimer);
  getCachePersistTimer = window.setTimeout(persistGetCache, 250);
}

function cacheTtlForUrl(url = "") {
  const path = String(url || "");
  if (path.startsWith("/notifications") || path.endsWith("/notifications")) return NOTIFICATION_CACHE_TTL_MS;
  if (
    path.includes("/salespersons")
    || path.includes("/finance-managers")
    || path.includes("/staff")
    || path.includes("/executives")
    || path.includes("/dealerships")
    || path.includes("/bank-tieups")
    || path.includes("/workflow/settings")
    || path.includes("/ecosystem")
    || path.startsWith("/banks")
    || path.startsWith("/branches")
    || path.startsWith("/brands")
  ) {
    return STATIC_CACHE_TTL_MS;
  }
  return GET_CACHE_TTL_MS;
}

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
  hydrateGetCache();
  const key = cacheKey(config);
  if (!key) return null;
  const entry = getCache.get(key);
  if (!entry || entry.stale || entry.expiresAt <= Date.now()) return null;
  return { ...entry.response, config, request: { cached: true } };
}

function axiosAdapter(adapter) {
  if (typeof adapter === "function") return adapter;
  if (typeof axios.getAdapter === "function") return axios.getAdapter(adapter || api.defaults.adapter || axios.defaults.adapter);
  return null;
}

function coalesceGetRequest(config) {
  const key = cacheKey(config);
  if (!key || config.adapter) return false;

  const pending = pendingGetRequests.get(key);
  if (pending) {
    config.adapter = () => pending.then((response) => ({
      ...response,
      config,
      request: { ...(response.request || {}), deduped: true },
    }));
    return true;
  }

  const adapter = axiosAdapter(api.defaults.adapter || axios.defaults.adapter);
  if (!adapter) return false;

  let resolvePending;
  let rejectPending;
  const shared = new Promise((resolve, reject) => {
    resolvePending = resolve;
    rejectPending = reject;
  });
  shared.catch(() => {});
  pendingGetRequests.set(key, shared);

  config.adapter = async (adapterConfig) => {
    try {
      const response = await adapter(adapterConfig);
      resolvePending(response);
      return response;
    } catch (error) {
      rejectPending(error);
      throw error;
    } finally {
      pendingGetRequests.delete(key);
    }
  };
  return true;
}

function rememberGetResponse(response) {
  hydrateGetCache();
  const key = cacheKey(response.config);
  if (!key) return;
  const now = Date.now();
  getCache.set(key, {
    url: response.config?.url || "",
    params: response.config?.params || null,
    expiresAt: now + Number(response.config?.cacheTtlMs || cacheTtlForUrl(response.config?.url)),
    staleUntil: now + GET_STALE_TTL_MS,
    stale: false,
    response: {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    },
  });
  trimGetCache();
  scheduleGetCachePersist();
}

export function getCachedGetData(url, params = null, { includeStale = true } = {}) {
  hydrateGetCache();
  const key = getCacheKey(url, params);
  if (!key) return null;
  const entry = getCache.get(key);
  if (!entry) return null;
  const now = Date.now();
  if (entry.expiresAt <= now && (!includeStale || entry.staleUntil <= now)) return null;
  return entry.response.data;
}

export function patchCachedGetData(url, patcher, { params = null, matchPrefix = false } = {}) {
  hydrateGetCache();
  if (typeof patcher !== "function") return;
  const now = Date.now();
  for (const [key, entry] of getCache.entries()) {
    if (!entry || !entry.response) continue;
    const matches = matchPrefix
      ? String(entry.url || "").startsWith(url)
      : entry.url === url && (!params || stableParams(entry.params) === stableParams(params));
    if (!matches) continue;
    const nextData = patcher(entry.response.data, entry.params || null);
    if (nextData === undefined) continue;
    getCache.set(key, {
      ...entry,
      expiresAt: Math.max(entry.expiresAt || 0, now + cacheTtlForUrl(entry.url || url)),
      stale: false,
      response: {
        ...entry.response,
        data: nextData,
      },
    });
  }
  scheduleGetCachePersist();
}

export function findCachedGetItem(url, matcher) {
  hydrateGetCache();
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

export function findCachedGetRows(url, matcher = null, { limit = 10 } = {}) {
  hydrateGetCache();
  const rows = [];
  const seen = new Set();
  const now = Date.now();
  const accepts = typeof matcher === "function" ? matcher : () => true;

  for (const entry of getCache.values()) {
    if (!entry || (entry.expiresAt <= now && entry.staleUntil <= now) || entry.url !== url) continue;
    const payload = entry.response?.data;
    const candidates = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    for (const item of candidates) {
      if (!item || !accepts(item)) continue;
      const key = String(item.id || item.caseId || item.leadId || JSON.stringify(item));
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(item);
      if (rows.length >= limit) return rows;
    }
  }
  return rows;
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

export function invalidateGetCache({ url, prefix, purge = false } = {}) {
  hydrateGetCache();
  const now = Date.now();
  for (const [key, entry] of getCache.entries()) {
    if (!entry) continue;
    const matches = url ? entry.url === url : prefix ? String(entry.url || "").startsWith(prefix) : true;
    if (!matches) continue;
    if (purge) {
      getCache.delete(key);
      continue;
    }
    entry.stale = true;
    entry.expiresAt = now - 1;
    entry.staleUntil = Math.max(entry.staleUntil || 0, now + GET_STALE_TTL_MS);
    getCache.set(key, entry);
  }
  scheduleGetCachePersist();
}

function isLeadMutationUrl(url = "") {
  const path = String(url || "");
  return path.startsWith("/bank/leads/")
    || path.startsWith("/dealer/leads")
    || path.startsWith("/gm/leads")
    || path.startsWith("/admin/leads")
    || path.startsWith("/documents/");
}

function invalidateLeadCaches() {
  [
    "/admin/leads",
    "/bank/leads",
    "/bank/analytics",
    "/dealer/leads",
    "/gm/leads",
    "/timeline",
    "/notifications",
  ].forEach((prefix) => invalidateGetCache({ prefix, purge: true }));
  invalidateGetCache({ prefix: "/bank/dealerships", purge: true });
  invalidateGetCache({ prefix: "/dashboard", purge: true });
}

function dispatchDataMutation(payload) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("cls:data-mutated", {
    detail: payload,
  }));
}

function handleRemoteDataMutation(payload) {
  if (typeof window === "undefined" || !payload || payload.source === dataMutationSource) return;
  const mutationKey = `${payload.source || ""}:${payload.at || ""}:${payload.canonicalUrl || payload.url || ""}`;
  if (mutationKey === lastRemoteMutationKey) return;
  lastRemoteMutationKey = mutationKey;
  if (payload.kind === "lead") invalidateLeadCaches();
  else invalidateGetCache();
  dispatchDataMutation({ ...payload, remote: true });
}

function setupDataMutationListeners() {
  if (typeof window === "undefined" || dataMutationListenersReady) return;
  dataMutationListenersReady = true;
  try {
    if ("BroadcastChannel" in window) {
      dataMutationChannel = new BroadcastChannel(DATA_MUTATION_CHANNEL);
      dataMutationChannel.onmessage = (event) => handleRemoteDataMutation(event.data);
    }
  } catch {
    dataMutationChannel = null;
  }
  window.addEventListener("storage", (event) => {
    if (event.key !== DATA_MUTATION_STORAGE_KEY || !event.newValue) return;
    try {
      handleRemoteDataMutation(JSON.parse(event.newValue));
    } catch {
      // Cross-tab refresh is best-effort.
    }
  });
}

function leadMutationMetadata(data = {}) {
  const payload = data?.lead && typeof data.lead === "object" ? data.lead : data;
  return {
    leadId: payload?.leadId || payload?.id || payload?.sourceId || "",
    caseId: payload?.caseId || "",
    status: payload?.status || payload?.leadStatus || "",
    dealershipId: payload?.dealershipId || payload?.dealershipEmail || payload?.dealerEmail || "",
    bankId: payload?.bankId || payload?.assignedBankId || payload?.assignedPartnerId || "",
    executiveId: payload?.assignedExecutiveId || payload?.updatedByExecutiveId || "",
    executiveEmail: payload?.assignedExecutiveEmail || "",
  };
}

function emitDataMutation(url = "", data = {}) {
  if (typeof window === "undefined") return;
  setupDataMutationListeners();
  const leadMutation = isLeadMutationUrl(url);
  const payload = {
    url,
    canonicalUrl: leadMutation ? "/lead-mutation" : url,
    kind: leadMutation ? "lead" : "generic",
    ...(leadMutation ? leadMutationMetadata(data) : {}),
    at: Date.now(),
    source: dataMutationSource,
    portal: requestPortalHeader(),
  };
  dispatchDataMutation(payload);
  try {
    dataMutationChannel?.postMessage(payload);
  } catch {
    // BroadcastChannel is optional.
  }
  try {
    window.localStorage?.setItem(DATA_MUTATION_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage events are optional.
  }
}

setupDataMutationListeners();

async function appCheckHeaderToken() {
  if (!import.meta.env.VITE_FIREBASE_APPCHECK_RECAPTCHA_SITE_KEY) return "";
  if (appCheckCache.token && appCheckCache.expiresAt > Date.now()) return appCheckCache.token;
  if (!appCheckCache.promise) {
    appCheckCache.promise = loadAppCheck()
      .then(({ appCheck, getToken }) => {
        if (!appCheck || typeof getToken !== "function") return "";
        return getToken(appCheck, false);
      })
      .then((token) => {
        appCheckCache = {
          token: typeof token === "string" ? token : token?.token || "",
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

async function loadAppCheck() {
  if (!appCheckModulePromise) {
    appCheckModulePromise = Promise.all([
      import("firebase/app-check"),
      import("./firebaseAppCheck.js"),
    ])
      .then(([appCheckModule, firebaseModule]) => ({
        getToken: appCheckModule.getToken,
        appCheck: firebaseModule.appCheck,
      }))
      .catch(() => ({ getToken: null, appCheck: null }));
  }
  return appCheckModulePromise;
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
  if (normalized === "finance-desk") return "/finance/login";
  if (normalized === "gm") return "/gm/login";
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
  if (normalized === "gm") return "/gm/leads";
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
    markApiRequestStart(config, { cacheHit: true });
    config.adapter = () => Promise.resolve(cached);
    return config;
  }
  const coalesced = coalesceGetRequest(config);
  markApiRequestStart(config, { cacheHit: false, coalesced });
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
    markApiResponseEnd(response.config, response);
    if (!response.request?.cached) rememberGetResponse(response);
    if (!["get", "head", "options"].includes(String(response.config?.method || "get").toLowerCase())) {
      const url = String(response.config?.url || "");
      let shouldEmitMutation = false;
      if (isLeadMutationUrl(url)) {
        invalidateLeadCaches();
        shouldEmitMutation = true;
      } else if (url.startsWith("/bank/")) {
        invalidateGetCache({ prefix: "/bank/" });
        shouldEmitMutation = true;
      } else if (url.startsWith("/dealer/")) {
        invalidateGetCache({ prefix: "/dealer/" });
        shouldEmitMutation = true;
      } else if (url.startsWith("/gm/")) {
        invalidateGetCache({ prefix: "/gm/" });
        shouldEmitMutation = true;
      } else if (url.startsWith("/admin/")) {
        invalidateGetCache({ prefix: "/admin/" });
        shouldEmitMutation = true;
      }
      else if (url.startsWith("/notifications")) invalidateGetCache({ prefix: "/notifications" });
      else invalidateGetCache();
      if (shouldEmitMutation) emitDataMutation(url, response.data);
    }
    return response;
  },
  async (error) => {
    markApiResponseEnd(error.config || {}, null, error);
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
      "SESSION_ORGANIZATION_CHANGED",
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
