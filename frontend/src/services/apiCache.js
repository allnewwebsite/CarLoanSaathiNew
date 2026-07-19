const GET_CACHE_TTL_MS = 5 * 60 * 1000;
const GET_STALE_TTL_MS = 30 * 60 * 1000;
const GET_CACHE_STORAGE_KEY = "cls_get_cache_v3";
const GET_CACHE_MAX_ENTRIES = 180;
const NOTIFICATION_CACHE_TTL_MS = 60 * 1000;
const STATIC_CACHE_TTL_MS = 10 * 60 * 1000;

function browserStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

function stableParams(params) {
  if (!params) return "";
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
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

export function createApiCache({ axios, api, apiBaseUrl, requestPortalHeader, authEndpoint, authCacheIdentity, defaultRequestTimeoutMs }) {
  const getCache = new Map();
  const pendingGetRequests = new Map();
  let getCacheHydrated = false;
  let getCachePersistTimer = null;

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

  function getCacheKey(url = "", params = null, baseURL = apiBaseUrl()) {
    if (authEndpoint(url)) return "";
    return `${baseURL}|${url || ""}|${stableParams(params)}|${requestPortalHeader()}|${authCacheIdentity()}`;
  }

  function belongsToCurrentIdentity(key) {
    const suffix = `|${requestPortalHeader()}|${authCacheIdentity()}`;
    return String(key || "").endsWith(suffix);
  }

  function cacheKey(config = {}) {
    const method = String(config.method || "get").toLowerCase();
    if (method !== "get") return "";
    return getCacheKey(config.url, config.params, config.baseURL || apiBaseUrl());
  }

  function cachedResponse(config) {
    if (config?.skipCache === true) return null;
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
    if (config?.skipCache === true) return false;
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

  function getCachedGetData(url, params = null, { includeStale = true } = {}) {
    hydrateGetCache();
    const key = getCacheKey(url, params);
    if (!key) return null;
    const entry = getCache.get(key);
    if (!entry) return null;
    const now = Date.now();
    if (entry.expiresAt <= now && (!includeStale || entry.staleUntil <= now)) return null;
    return entry.response.data;
  }

  function patchCachedGetData(url, patcher, { params = null, matchPrefix = false } = {}) {
    hydrateGetCache();
    if (typeof patcher !== "function") return;
    const now = Date.now();
    for (const [key, entry] of getCache.entries()) {
      if (!entry || !entry.response) continue;
      if (!belongsToCurrentIdentity(key)) continue;
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

  function findCachedGetItem(url, matcher) {
    hydrateGetCache();
    if (typeof matcher !== "function") return null;
    for (const [key, entry] of getCache.entries()) {
      if (!belongsToCurrentIdentity(key)) continue;
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

  function findCachedGetRows(url, matcher = null, { limit = 10 } = {}) {
    hydrateGetCache();
    const rows = [];
    const seen = new Set();
    const now = Date.now();
    const accepts = typeof matcher === "function" ? matcher : () => true;
    for (const [key, entry] of getCache.entries()) {
      if (!belongsToCurrentIdentity(key)) continue;
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

  function prefetchGet(url, params = null, options = {}) {
    if (getCachedGetData(url, params)) return Promise.resolve(null);
    return api.get(url, {
      ...options,
      params,
      silent: true,
      timeout: Math.min(Number(options.timeout) || defaultRequestTimeoutMs, 10000),
    }).catch(() => null);
  }

  function invalidateGetCache({ url, prefix, purge = false } = {}) {
    hydrateGetCache();
    const now = Date.now();
    for (const [key, entry] of getCache.entries()) {
      if (!entry) continue;
      if (!belongsToCurrentIdentity(key)) continue;
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

  return {
    cachedResponse,
    coalesceGetRequest,
    findCachedGetItem,
    findCachedGetRows,
    getCachedGetData,
    invalidateGetCache,
    patchCachedGetData,
    prefetchGet,
    rememberGetResponse,
  };
}
