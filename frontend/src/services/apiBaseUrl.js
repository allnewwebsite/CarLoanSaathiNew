const DEFAULT_LOCAL_API_BASE_URL = "http://localhost:8080/api";

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
