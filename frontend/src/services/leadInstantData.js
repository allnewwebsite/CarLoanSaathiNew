import { normalizeStatus } from "../constants/status.js";
import { findCachedGetRows, prefetchGet } from "./api.js";

function leadStatus(lead = {}) {
  return normalizeStatus(lead.status || lead.leadStatus || lead.currentStatus || lead.workflowStatus);
}

export function cachedLeadRows(url, { status = "", search = "", limit = 10 } = {}) {
  const normalizedStatus = status ? normalizeStatus(status) : "";
  const query = String(search || "").trim().toLowerCase();
  return findCachedGetRows(url, (lead) => {
    const statusMatches = !normalizedStatus || leadStatus(lead) === normalizedStatus;
    if (!statusMatches) return false;
    if (!query) return true;
    return JSON.stringify(lead).toLowerCase().includes(query);
  }, { limit });
}

export function scheduleLeadPrefetch(url, statusOptions = [], baseParams = {}) {
  if (typeof window === "undefined" || !statusOptions.length) return;
  const schedule = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 400));
  schedule(() => {
    statusOptions.forEach((status, index) => {
      window.setTimeout(() => {
        prefetchGet(url, { page: 1, limit: baseParams.limit || 10, ...baseParams, status });
      }, index * 120);
    });
  });
}
