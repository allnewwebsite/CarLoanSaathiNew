const ROLE_PORTALS = {
  "finance-desk": "finance",
  "gm": "finance",
  "bank-manager": "bank",
  "loan-executive": "bank",
  "super-admin": "admin",
};

const ROLE_LOGIN_PORTALS = {
  "finance-desk": "finance",
  "gm": "gm",
  "bank-manager": "bank-manager",
  "loan-executive": "loan-executive",
  "super-admin": "admin",
};

const TOKEN_DENY_STATUSES = new Set(["pending", "rejected", "suspended", "deleted", "inactive", "disabled", "removed", "locked"]);

export const REALTIME_TICKET_PATH = "/api/realtime/ticket";

export function portalForRole(role) {
  return ROLE_PORTALS[String(role || "").trim().toLowerCase()] || "";
}

export function loginPortalForRole(role) {
  return ROLE_LOGIN_PORTALS[String(role || "").trim().toLowerCase()] || "";
}

export function organizationIdForAccount(account = {}) {
  if (account.role === "super-admin") return account.uid || account.id || account.email || "platform";
  return account.dealershipId || account.bankId || null;
}

export function requestedLoginPortal(req) {
  const headerPortal = String(req.headers["x-cls-portal"] || "").trim().toLowerCase();
  if (headerPortal === "dealer" || headerPortal === "finance") return "finance";
  if (headerPortal === "gm") return "gm";
  if (headerPortal === "bank" || headerPortal === "bank-manager") return "bank-manager";
  if (headerPortal === "executive" || headerPortal === "loan-executive") return "loan-executive";
  if (headerPortal === "admin" || headerPortal === "super-admin") return "admin";
  return "";
}

export function requestedPortal(req) {
  const headerPortal = String(req.headers["x-cls-portal"] || "").trim().toLowerCase();
  if (["finance", "dealer", "gm"].includes(headerPortal)) return "finance";
  if (["bank", "executive", "bank-manager", "loan-executive"].includes(headerPortal)) return "bank";
  if (["admin", "super-admin"].includes(headerPortal)) return "admin";

  const path = String(req.originalUrl || req.path || "").toLowerCase();
  if (path.startsWith("/api/admin")) return "admin";
  if (path.startsWith("/api/bank")) return "bank";
  if (path.startsWith("/api/dealer") || path.startsWith("/api/gm")) return "finance";
  return "";
}

export function realtimeTicketFastAuthEnabled() {
  return process.env.REALTIME_TICKET_FAST_AUTH !== "false";
}

export function realtimeTicketFastAuthMaxAgeMs() {
  return Math.max(60_000, Number(process.env.REALTIME_TICKET_FAST_AUTH_MAX_AGE_MS || 30 * 60 * 1000));
}

export function isRealtimeTicketRequest(req) {
  return req.method === "POST" && String(req.originalUrl || req.path || "").split("?")[0] === REALTIME_TICKET_PATH;
}

export function tokenClaimsLookActive(tokenUser = {}) {
  const status = String(tokenUser.accountStatus || tokenUser.status || "").trim().toLowerCase();
  return Boolean(
    tokenUser.email
    && tokenUser.role
    && tokenUser.portal
    && tokenUser.portal === portalForRole(tokenUser.role)
    && tokenUser.approved === true
    && tokenUser.active !== false
    && tokenUser.accountApproved !== false
    && tokenUser.accountActive !== false
    && tokenUser.emailVerified !== false
    && !TOKEN_DENY_STATUSES.has(status)
  );
}

export function tokenFreshEnoughForRealtime(tokenUser = {}) {
  const issuedAtMs = Number(tokenUser.iat || 0) * 1000;
  if (!issuedAtMs) return false;
  return Date.now() - issuedAtMs <= realtimeTicketFastAuthMaxAgeMs();
}

export function realtimeUserFromToken(tokenUser = {}, email = "") {
  return {
    uid: tokenUser.uid || email,
    email,
    role: tokenUser.role,
    dealershipId: tokenUser.dealershipId || null,
    bankId: tokenUser.bankId || null,
    branchId: tokenUser.branchId || null,
    branchIfsc: tokenUser.branchIfsc || tokenUser.bankIfsc || tokenUser.ifscCode || tokenUser.branchId || null,
    bankIfsc: tokenUser.bankIfsc || tokenUser.branchIfsc || tokenUser.ifscCode || tokenUser.branchId || null,
    ifscCode: tokenUser.ifscCode || tokenUser.branchIfsc || tokenUser.bankIfsc || tokenUser.branchId || null,
    branchCity: tokenUser.branchCity || tokenUser.branchLocation || tokenUser.bankBranchLocation || tokenUser.bankBranchCity || null,
    branchLocation: tokenUser.branchLocation || tokenUser.bankBranchLocation || tokenUser.branchCity || tokenUser.bankBranchCity || null,
    bankName: tokenUser.bankName || tokenUser.companyName || null,
    approved: true,
    active: true,
    accountApproved: tokenUser.accountApproved !== false,
    accountActive: tokenUser.accountActive !== false,
    emailVerified: true,
    sessionId: tokenUser.sessionId || null,
    portal: tokenUser.portal,
    scope: tokenUser.scope || tokenUser.portal,
    loginPortal: tokenUser.loginPortal || loginPortalForRole(tokenUser.role),
    organizationId: tokenUser.organizationId || tokenUser.dealershipId || tokenUser.bankId || null,
  };
}
