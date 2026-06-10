import { useEffect, useLayoutEffect, useRef } from "react";

const DUPLICATE_WINDOW_MS = 1500;
const renderCounters = new Map();
const requestWindow = new Map();
const apiSamples = [];
const LATENCY_LOG_LIMIT = 500;

let activeNavigation = {
  requestId: "",
  clickAt: 0,
  routeAt: 0,
  mountAt: 0,
  page: "",
  path: "",
};
let listenersInstalled = false;

function latencyEnabled() {
  if (typeof import.meta !== "undefined" && import.meta.env?.VITE_FRONTEND_LATENCY === "true") return true;
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) return true;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("CLS_FRONTEND_LATENCY") === "true";
  } catch {
    return false;
  }
}

function now() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
  return Date.now();
}

function wallTime() {
  return new Date().toISOString();
}

function requestId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function endpointKey(method, url, params) {
  const query = params && Object.keys(params).length ? `?${new URLSearchParams(params).toString()}` : "";
  return `${String(method || "get").toUpperCase()} ${url || ""}${query}`;
}

function log(tag, payload = {}) {
  if (!latencyEnabled()) return null;
  const entry = {
    tag,
    at: wallTime(),
    page: payload.page || activeNavigation.page || "",
    requestId: payload.requestId || activeNavigation.requestId || "",
    ...payload,
  };
  if (typeof window !== "undefined") {
    window.__CLS_FRONTEND_LATENCY__ = window.__CLS_FRONTEND_LATENCY__ || { logs: [], apiSamples };
    window.__CLS_FRONTEND_LATENCY__.logs.push(entry);
    if (window.__CLS_FRONTEND_LATENCY__.logs.length > LATENCY_LOG_LIMIT) {
      window.__CLS_FRONTEND_LATENCY__.logs.splice(0, window.__CLS_FRONTEND_LATENCY__.logs.length - LATENCY_LOG_LIMIT);
    }
  }
  // eslint-disable-next-line no-console
  console.info(tag, entry);
  return entry;
}

function activePath() {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname}${window.location.search}`;
}

export function installFrontendLatencyListeners() {
  if (typeof window === "undefined" || listenersInstalled) return;
  listenersInstalled = true;
  window.addEventListener("pointerdown", (event) => {
    const target = event.target?.closest?.("a,button,[role='button']");
    if (!target) return;
    activeNavigation = {
      ...activeNavigation,
      requestId: requestId(),
      clickAt: now(),
      path: target.getAttribute("href") || target.getAttribute("aria-label") || target.textContent?.trim()?.slice(0, 80) || activePath(),
    };
  }, { capture: true, passive: true });
}

export function markRouteChangeStart(path) {
  activeNavigation = {
    ...activeNavigation,
    requestId: activeNavigation.requestId || requestId(),
    routeAt: now(),
    path: path || activePath(),
  };
  log("FRONTEND-ROUTE", { path: activeNavigation.path });
}

export function markComponentMount(page, meta = {}) {
  activeNavigation = {
    ...activeNavigation,
    requestId: activeNavigation.requestId || requestId(),
    mountAt: now(),
    page,
  };
  log("FRONTEND-COMPONENT-MOUNT", {
    page,
    path: activePath(),
    routeChangeMs: activeNavigation.routeAt ? Math.round(activeNavigation.mountAt - activeNavigation.routeAt) : null,
    totalUserWaitMs: activeNavigation.clickAt ? Math.round(activeNavigation.mountAt - activeNavigation.clickAt) : null,
    ...meta,
  });
}

export function markApiRequestStart(config = {}, { cacheHit = false } = {}) {
  const startedAt = now();
  const key = endpointKey(config.method, config.url, config.params);
  if (latencyEnabled()) {
    const existing = requestWindow.get(key)?.filter((time) => startedAt - time <= DUPLICATE_WINDOW_MS) || [];
    existing.push(startedAt);
    requestWindow.set(key, existing);

    if (existing.length > 1) {
      log("DUPLICATE-REQUEST", {
        endpoint: key,
        requestCount: existing.length,
        timeWindowMs: DUPLICATE_WINDOW_MS,
      });
    }

    const params = config.params || {};
    if (params.search || params.q || params.query) {
      log("SEARCH-REQUEST", { endpoint: key, search: params.search || params.q || params.query });
    }
    if (params.page || params.cursor || params.nextCursor) {
      log("PAGINATION-REQUEST", { endpoint: key, page: params.page || "", cursor: params.cursor || params.nextCursor || "" });
    }
  }

  config.__frontendLatency = {
    startedAt,
    endpoint: key,
    cacheHit,
    requestId: activeNavigation.requestId || requestId(),
  };
  return config.__frontendLatency;
}

export function markApiResponseEnd(config = {}, response = null, error = null) {
  const sample = config.__frontendLatency || {};
  const endedAt = now();
  const durationMs = sample.startedAt ? Math.round(endedAt - sample.startedAt) : null;
  let responseBytes = null;
  if (latencyEnabled()) {
    try {
      responseBytes = response?.data === undefined ? null : new Blob([JSON.stringify(response.data)]).size;
    } catch {
      responseBytes = null;
    }
  }
  const entry = {
    endpoint: sample.endpoint || endpointKey(config.method, config.url, config.params),
    durationMs,
    cacheStatus: sample.cacheHit || response?.request?.cached ? "hit" : "miss",
    responseBytes,
    status: response?.status || error?.response?.status || 0,
    error: error ? error.message : "",
    endedAt,
  };
  if (latencyEnabled()) {
    apiSamples.push(entry);
    if (apiSamples.length > LATENCY_LOG_LIMIT) apiSamples.splice(0, apiSamples.length - LATENCY_LOG_LIMIT);
  }
  log("FRONTEND-API", entry);
  return entry;
}

export function markTableRenderStart(meta = {}) {
  return {
    startedAt: now(),
    page: activeNavigation.page,
    requestId: activeNavigation.requestId,
    ...meta,
  };
}

export function markTableRenderComplete(renderInfo = {}, meta = {}) {
  if (!latencyEnabled()) return null;
  const completedAt = now();
  const lastApi = apiSamples.at(-1);
  const renderDurationMs = renderInfo.startedAt ? Math.round(completedAt - renderInfo.startedAt) : null;
  const firstRowVisibleMs = meta.rowCount > 0 && activeNavigation.clickAt ? Math.round(completedAt - activeNavigation.clickAt) : null;
  return log("FRONTEND-LATENCY", {
    component: meta.component || renderInfo.component || "Table",
    tableTitle: meta.title || "",
    path: activePath(),
    routeChangeMs: activeNavigation.routeAt && activeNavigation.mountAt ? Math.round(activeNavigation.mountAt - activeNavigation.routeAt) : null,
    apiDurationMs: lastApi?.durationMs ?? null,
    stateUpdateMs: lastApi?.endedAt && renderInfo.startedAt ? Math.round(renderInfo.startedAt - lastApi.endedAt) : null,
    renderDurationMs,
    firstRowVisibleMs,
    pageInteractiveMs: activeNavigation.clickAt ? Math.round(completedAt - activeNavigation.clickAt) : null,
    totalUserWaitMs: activeNavigation.clickAt ? Math.round(completedAt - activeNavigation.clickAt) : null,
    rowCount: meta.rowCount ?? null,
    cacheStatus: lastApi?.cacheStatus || "unknown",
    responseBytes: lastApi?.responseBytes ?? null,
  });
}

export function logSseRefresh(payload = {}) {
  log("SSE-REFRESH", payload);
}

export function logNotificationRefresh(payload = {}) {
  log("NOTIFICATION-REFRESH", payload);
}

export function useRenderDiagnostics(component, meta = {}) {
  const renderStartedAtRef = useRef(0);
  renderStartedAtRef.current = now();
  const countRef = useRef(0);
  countRef.current += 1;
  useEffect(() => {
    if (!latencyEnabled()) return;
    const previous = renderCounters.get(component) || 0;
    const renderCount = Math.max(previous + 1, countRef.current);
    renderCounters.set(component, renderCount);
    log("RENDER-COUNT", {
      component,
      renderCount,
      renderDurationMs: Math.round(now() - renderStartedAtRef.current),
      ...meta,
    });
  });
}

export function usePageLatency(page, meta = {}) {
  useRenderDiagnostics(page, meta);
  useEffect(() => {
    if (!latencyEnabled()) return;
    markComponentMount(page, meta);
  }, [page]);
  useLayoutEffect(() => {
    if (!latencyEnabled()) return undefined;
    const started = now();
    const frame = window.requestAnimationFrame?.(() => {
      log("FRONTEND-PAGE-INTERACTIVE", {
        page,
        path: activePath(),
        pageInteractiveMs: activeNavigation.clickAt ? Math.round(now() - activeNavigation.clickAt) : Math.round(now() - started),
      });
    });
    return () => {
      if (frame && window.cancelAnimationFrame) window.cancelAnimationFrame(frame);
    };
  }, [page]);
}
