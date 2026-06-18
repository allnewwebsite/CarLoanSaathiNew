import { getDealershipSubscription } from "../services/subscription.service.js";
import { cached } from "../services/ttlCache.service.js";

export const ROLE_ROUTES = {
  "finance-desk": "/finance/dashboard",
  "gm": "/gm/dashboard",
  "bank-manager": "/bank-manager/dashboard",
  "loan-executive": "/loan-executive/leads",
  "super-admin": "/admin/dashboard",
};

export const PORTAL_ROLES = {
  finance: ["finance-desk", "gm"],
  dealer: ["finance-desk", "gm"],
  bank: ["bank-manager", "loan-executive"],
  admin: ["super-admin"],
};

export const LOGIN_PORTAL_ROLES = {
  finance: ["finance-desk", "gm"],
  gm: ["gm"],
  "bank-manager": ["bank-manager"],
  "loan-executive": ["loan-executive"],
  admin: ["super-admin"],
};

export const ROLE_LOGIN_PORTALS = {
  "finance-desk": "finance",
  "gm": "gm",
  "bank-manager": "bank-manager",
  "loan-executive": "loan-executive",
  "super-admin": "admin",
};

export const ROLE_GUIDANCE = {
  "finance-desk": {
    roleLabel: "Finance Desk",
    portalLabel: "Finance Desk Portal",
    redirectTo: "/finance/login",
    actionLabel: "Go to Finance Login",
  },
  gm: {
    roleLabel: "General Manager",
    portalLabel: "GM Portal",
    redirectTo: "/gm/login",
    actionLabel: "Go to GM Login",
  },
  "bank-manager": {
    roleLabel: "Bank Manager",
    portalLabel: "Bank Portal",
    redirectTo: "/bank/login",
    actionLabel: "Go to Bank Manager Login",
  },
  "loan-executive": {
    roleLabel: "Loan Executive",
    portalLabel: "Executive Portal",
    redirectTo: "/executive/login",
    actionLabel: "Go to Executive Login",
  },
  "super-admin": {
    roleLabel: "Super Admin",
    portalLabel: "Super Admin Portal",
    redirectTo: "/admin/login",
    actionLabel: "Go to Super Admin Login",
  },
};

export const AUTH_ENTITLEMENT_CACHE_TTL_MS = Number(process.env.AUTH_ENTITLEMENT_CACHE_TTL_MS || 60_000);

export function accountEntitlementSnapshot(account = {}) {
  if (!["finance-desk", "gm"].includes(account?.role)) return null;
  if (typeof account.dashboardAccessAllowed !== "boolean" || !account.subscriptionStatus) return null;
  return {
    selectedPlan: account.selectedPlan || "TRIAL",
    subscriptionStatus: account.subscriptionStatus,
    dashboardAccessAllowed: account.dashboardAccessAllowed === true,
  };
}

export async function dealershipEntitlement(account, fallbackEmail = "") {
  if (!["finance-desk", "gm"].includes(account?.role)) return {};
  const dealershipId = account.dealershipId || fallbackEmail;
  const accountSnapshot = accountEntitlementSnapshot(account);
  if (accountSnapshot) return accountSnapshot;
  const subscription = await cached(
    `auth:dealership-entitlement:${dealershipId}`,
    AUTH_ENTITLEMENT_CACHE_TTL_MS,
    async () => await getDealershipSubscription(dealershipId, { initialize: false }).catch(() => null) || false
  );
  return {
    selectedPlan: subscription?.selectedPlan || account.selectedPlan || "TRIAL",
    subscriptionStatus: subscription?.subscriptionStatus || account.subscriptionStatus || "EXPIRED",
    dashboardAccessAllowed: subscription?.dashboardAccessAllowed ?? account.dashboardAccessAllowed === true,
  };
}

export function entitlementRedirect(user, fallback) {
  if (["finance-desk", "gm"].includes(user?.role) && user.dashboardAccessAllowed === false) {
    return "/subscription-activation";
  }
  return fallback;
}

export function normalizePortal(portal = "dealer") {
  if (portal === "gm") return "finance";
  if (["bank-manager", "loan-executive", "executive"].includes(portal)) return "bank";
  if (portal === "super-admin") return "admin";
  return PORTAL_ROLES[portal] ? portal : "dealer";
}

export function normalizeLoginPortal(portal = "") {
  const normalized = String(portal || "").trim().toLowerCase();
  if (normalized === "dealer") return "finance";
  if (normalized === "bank") return "bank-manager";
  if (normalized === "executive") return "loan-executive";
  if (normalized === "super-admin") return "admin";
  return LOGIN_PORTAL_ROLES[normalized] ? normalized : "";
}

export function loginPortalForRole(role) {
  return ROLE_LOGIN_PORTALS[String(role || "").trim().toLowerCase()] || "";
}

export function loginPortalAllowsRole(portal, role) {
  return Boolean((LOGIN_PORTAL_ROLES[portal] || []).includes(role));
}

export function organizationIdForAccount(account = {}) {
  if (account.role === "super-admin") return account.uid || account.id || account.email || "platform";
  return account.dealershipId || account.bankId || null;
}

export function portalAllowsRole(portal, role) {
  return Boolean((PORTAL_ROLES[portal] || []).includes(role));
}

export function portalForRole(role) {
  if (["finance-desk", "gm"].includes(role)) return "finance";
  return Object.entries(PORTAL_ROLES).find(([, roles]) => roles.includes(role))?.[0] || null;
}

export function roleGuidance(role) {
  return ROLE_GUIDANCE[role] || {
    roleLabel: "registered",
    portalLabel: "assigned",
    redirectTo: "/",
    actionLabel: "Go to Correct Login",
  };
}

export function wrongLoginPortalPayload(role = "") {
  const guidance = roleGuidance(role);
  return {
    code: "WRONG_PORTAL",
    message: "You are not authorized to access this portal.",
    role,
    correctPortal: loginPortalForRole(role) || portalForRole(role),
    redirectTo: guidance.redirectTo,
    actionLabel: guidance.actionLabel,
  };
}

export function wrongPortalPayload(account = {}) {
  const guidance = roleGuidance(account.role);
  return {
    code: "WRONG_PORTAL",
    role: account.role,
    roleLabel: guidance.roleLabel,
    correctPortal: portalForRole(account.role),
    portalLabel: guidance.portalLabel,
    redirectTo: guidance.redirectTo,
    actionLabel: guidance.actionLabel,
    message: `This email is registered as a ${guidance.roleLabel} account. Please login through the ${guidance.portalLabel}.`,
  };
}

export function passwordChangeRouteForRole(role) {
  if (role === "loan-executive") return "/loan-executive/change-password";
  if (role === "bank-manager") return "/bank-manager/change-password";
  if (role === "gm") return "/gm/change-password";
  if (role === "finance-desk") return "/finance/change-password";
  return "/change-password";
}
