import { getAuthScope, getCurrentPortalScope, getStoredUser } from "./authSessionManager.js";

export function loginPathForRole(role, fallback = "/finance/login") {
  const normalized = String(role || "").trim().toLowerCase();
  if (normalized === "loan-executive") return "/executive/login";
  if (normalized === "bank-manager") return "/bank/login";
  if (normalized === "super-admin") return "/admin/login";
  if (normalized === "finance-desk") return "/finance/login";
  if (normalized === "gm") return "/gm/login";
  return fallback;
}

export function currentLoginPath() {
  if (typeof window === "undefined") return "";
  const path = window.location.pathname || "";
  if (path.startsWith("/finance/login")) return "/finance/login";
  if (path.startsWith("/gm/login")) return "/gm/login";
  if (path.startsWith("/dealer/login")) return "/dealer/login";
  if (path.startsWith("/bank/login")) return "/bank/login";
  if (path.startsWith("/executive/login")) return "/executive/login";
  if (path.startsWith("/admin/login")) return "/admin/login";
  return "";
}

export function loginPathForCurrentPortal(fallback = "/finance/login") {
  if (typeof window === "undefined") return fallback;
  const path = window.location.pathname || "";
  if (path.startsWith("/bank-manager") || path.startsWith("/bank")) return "/bank/login";
  if (path.startsWith("/loan-executive") || path.startsWith("/executive")) return "/executive/login";
  if (path.startsWith("/admin") || path.startsWith("/super-admin")) return "/admin/login";
  if (path.startsWith("/dealer/login")) return "/dealer/login";
  if (path.startsWith("/gm")) return "/gm/login";
  if (path.startsWith("/dealer") || path.startsWith("/finance")) return "/finance/login";
  return fallback;
}

export function requestPortalHeader() {
  const pathScope = getCurrentPortalScope();
  if (pathScope) return pathScope;

  // /subscription-activation is shared by Finance Desk and GM. Deriving the
  // header from the URL there defaults GM to `finance`, which the backend
  // correctly rejects as a GM login portal. Preserve the authenticated role.
  const storedUser = getStoredUser();
  if (storedUser?.loginPortal) return storedUser.loginPortal;
  if (storedUser?.role === "gm") return "gm";
  if (getAuthScope() === "gm") return "gm";
  return loginPathForCurrentPortal().replace(/^\//, "").split("/")[0] || "finance";
}

export function redirectToLoginForRole(role, fallback = "/finance/login") {
  if (typeof window === "undefined" || currentLoginPath()) return;
  const target = loginPathForRole(role, fallback || loginPathForCurrentPortal());
  if (window.location.pathname !== target) window.location.assign(target);
}
