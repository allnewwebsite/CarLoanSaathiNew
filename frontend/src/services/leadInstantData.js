import { normalizeStatus } from "../constants/status.js";
import { findCachedGetRows, prefetchGet } from "./api.js";

function leadStatus(lead = {}) {
  return normalizeStatus(lead.status || lead.leadStatus || lead.currentStatus || lead.workflowStatus);
}

export function cachedLeadRows(url, { status = "", search = "", limit = 10 } = {}) {
  const normalizedStatus = status ? normalizeStatus(status) : "";
  const query = String(search || "").trim().toLowerCase();
  return findCachedGetRows(url, (lead) => {
    const currentStatus = leadStatus(lead);
    const statusMatches = lead.isDeadCase !== true && (normalizedStatus
      ? currentStatus === normalizedStatus
      : !["REJECTED", "DISBURSED"].includes(currentStatus));
    if (!statusMatches) return false;
    if (!query) return true;
    return JSON.stringify(lead).toLowerCase().includes(query);
  }, { limit });
}

export function scheduleLeadPrefetch(url, statusOptions = [], baseParams = {}) {
  if (typeof window === "undefined" || !statusOptions.length || String(baseParams.search || "").trim()) return () => {};
  const timers = new Set();
  let cancelled = false;
  const usesIdleCallback = typeof window.requestIdleCallback === "function";
  const schedule = usesIdleCallback ? window.requestIdleCallback.bind(window) : (callback) => window.setTimeout(callback, 400);
  const idleHandle = schedule(() => {
    if (cancelled) return;
    statusOptions.forEach((status, index) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        if (cancelled) return;
        prefetchGet(url, { page: 1, limit: baseParams.limit || 10, ...baseParams, status });
      }, index * 120);
      timers.add(timer);
    });
  });
  return () => {
    cancelled = true;
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
    if (usesIdleCallback && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idleHandle);
    else window.clearTimeout(idleHandle);
  };
}
