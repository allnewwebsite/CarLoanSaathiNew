import axios from "axios";
import { apiBaseUrl } from "./apiBaseUrl.js";

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function portalWarmupPath(role) {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "super-admin") return "/admin/leads";
  if (normalized === "bank-manager" || normalized === "loan-executive") return "/bank/leads";
  if (normalized === "gm") return "/gm/leads";
  if (normalized === "finance-desk" || normalized === "dealer") return "/dealer/leads";
  return null;
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

export async function warmupPortalRoute(api, role) {
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
