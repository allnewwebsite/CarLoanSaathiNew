import axios from "axios";
import { getAuthCacheIdentity, getStoredToken } from "./authSessionManager.js";
import { appCheckHeaderToken } from "./apiAppCheck.js";
import { apiBaseUrl } from "./apiBaseUrl.js";
import { authEndpoint, handleAuthResponseError, refreshSessionToken, shouldRefreshToken, shouldRetryAuthNetworkError } from "./apiAuth.js";
import { createApiCache } from "./apiCache.js";
import { createApiMutationEvents } from "./apiMutationEvents.js";
import { requestPortalHeader } from "./apiPortal.js";
import { ensureApiReady, warmupPortalRoute as warmupPortalRouteWithApi } from "./apiWarmup.js";
import { markApiRequestStart, markApiResponseEnd } from "./frontendLatency.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const AUTH_REQUEST_TIMEOUT_MS = 60000;

export { apiBaseUrl, ensureApiReady };

export const api = axios.create({
  baseURL: apiBaseUrl(),
  timeout: DEFAULT_REQUEST_TIMEOUT_MS,
  withCredentials: false,
});

const apiCache = createApiCache({
  axios,
  api,
  apiBaseUrl,
  requestPortalHeader,
  authEndpoint,
  authCacheIdentity: getAuthCacheIdentity,
  defaultRequestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
});

const apiMutations = createApiMutationEvents({
  invalidateGetCache: apiCache.invalidateGetCache,
  requestPortalHeader,
});

export const getCachedGetData = apiCache.getCachedGetData;
export const patchCachedGetData = apiCache.patchCachedGetData;
export const findCachedGetItem = apiCache.findCachedGetItem;
export const findCachedGetRows = apiCache.findCachedGetRows;
export const prefetchGet = apiCache.prefetchGet;
export const invalidateGetCache = apiCache.invalidateGetCache;

export function warmupPortalRoute(role) {
  return warmupPortalRouteWithApi(api, role);
}

api.interceptors.request.use(async (config) => {
  let token = getStoredToken();
  const isAuthEndpoint = authEndpoint(config.url);
  config.headers = config.headers || {};
  config.headers["X-CLS-Portal"] = requestPortalHeader();
  const cached = apiCache.cachedResponse(config);
  if (cached) {
    markApiRequestStart(config, { cacheHit: true });
    config.adapter = () => Promise.resolve(cached);
    return config;
  }
  const coalesced = apiCache.coalesceGetRequest(config);
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
    if (!response.request?.cached) apiCache.rememberGetResponse(response);
    apiMutations.handleMutationResponse(response);
    return response;
  },
  async (error) => {
    markApiResponseEnd(error.config || {}, null, error);
    if (shouldRetryAuthNetworkError(error)) {
      error.config._authNetworkRetry = true;
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
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
    }
    const retryResponse = await handleAuthResponseError(error, api);
    if (retryResponse) return retryResponse;
    return Promise.reject(error);
  }
);
