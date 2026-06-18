import { ROLE_LABELS, ROLE_ROUTES } from "../auth/roleSystem.js";

export const SESSION_VALIDATE_FRESHNESS_MS = 5 * 60 * 1000;
export const SESSION_VALIDATE_KEY = "cls_last_session_validate_at";

export const LOGIN_PORTAL_ROLES = {
  dealer: ["finance-desk"],
  finance: ["finance-desk", "gm"],
  gm: ["gm"],
  bank: ["bank-manager"],
  "bank-manager": ["bank-manager"],
  executive: ["loan-executive"],
  "loan-executive": ["loan-executive"],
  admin: ["super-admin"],
  "super-admin": ["super-admin"],
};

export const ROLE_LOGIN_PORTALS = {
  "finance-desk": "finance",
  "gm": "gm",
  "bank-manager": "bank-manager",
  "loan-executive": "loan-executive",
  "super-admin": "admin",
};

const ROLE_LOGIN_PATHS = {
  "finance-desk": "/finance/login",
  "gm": "/gm/login",
  "bank-manager": "/bank/login",
  "loan-executive": "/executive/login",
  "super-admin": "/admin/login",
};

const FIREBASE_CONTINUE_PATHS = {
  dealer: "/dealer-registration/verify-email",
  finance: "/dealer-registration/verify-email",
  bank: "/bank-registration/verify-email",
  "bank-manager": "/bank-registration/verify-email",
};

export function actionCodeSettings(portal = "dealer") {
  const fallbackPath = FIREBASE_CONTINUE_PATHS[String(portal || "dealer").trim().toLowerCase()] || "/dealer-registration/verify-email";
  const explicitUrl = import.meta.env.VITE_FIREBASE_ACTION_CONTINUE_URL;
  const url = explicitUrl || `${window.location.origin}${fallbackPath}`;
  return { url, handleCodeInApp: false };
}

export function sessionFromResponse(response) {
  const sessionUser = response.data.user || {};
  return {
    uid: sessionUser.uid || sessionUser.email,
    email: sessionUser.email,
    role: sessionUser.role,
    portal: sessionUser.portal || null,
    loginPortal: sessionUser.loginPortal || ROLE_LOGIN_PORTALS[sessionUser.role] || null,
    organizationId: sessionUser.organizationId || sessionUser.dealershipId || sessionUser.bankId || null,
    createdAt: sessionUser.createdAt || null,
    roleLabel: ROLE_LABELS[sessionUser.role] || sessionUser.role,
    approved: sessionUser.approved === true,
    accountApproved: sessionUser.accountApproved === true,
    accountActive: sessionUser.accountActive !== false,
    dealershipId: sessionUser.dealershipId || null,
    dealershipName: sessionUser.dealershipName || null,
    dealerCity: sessionUser.dealerCity || null,
    bankId: sessionUser.bankId || null,
    bankName: sessionUser.bankName || null,
    bankIfsc: sessionUser.bankIfsc || null,
    bankBranchLocation: sessionUser.bankBranchLocation || null,
    branchId: sessionUser.branchId || null,
    firstLoginRequired: sessionUser.firstLoginRequired === true,
    passwordChangedAt: sessionUser.passwordChangedAt || null,
    passwordExpiresAt: sessionUser.passwordExpiresAt || null,
    passwordDaysRemaining: Number.isFinite(Number(sessionUser.passwordDaysRemaining)) ? Number(sessionUser.passwordDaysRemaining) : null,
    passwordExpired: sessionUser.passwordExpired === true,
    profile: sessionUser.profile && typeof sessionUser.profile === "object" ? sessionUser.profile : {},
    selectedPlan: sessionUser.selectedPlan || null,
    subscriptionStatus: sessionUser.subscriptionStatus || null,
    dashboardAccessAllowed: sessionUser.dashboardAccessAllowed !== false,
    onboardingCompleted: sessionUser.onboardingCompleted === true,
    onboardingCompletedAt: sessionUser.onboardingCompletedAt || null,
    onboardingSkipped: sessionUser.onboardingSkipped === true,
    showOnboarding: sessionUser.showOnboarding === true,
    redirectTo: response.data.redirectTo || ROLE_ROUTES[sessionUser.role],
  };
}

export function registrationAccountError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function wrongPortalError(role = "") {
  const error = new Error("You are not authorized to access this portal.");
  error.code = "WRONG_PORTAL";
  const loginPortal = ROLE_LOGIN_PORTALS[role] || "";
  error.response = {
    status: 403,
    data: {
      code: "WRONG_PORTAL",
      message: error.message,
      role,
      correctPortal: loginPortal,
      redirectTo: ROLE_LOGIN_PATHS[role] || "",
      actionLabel: "Go to Correct Login",
    },
  };
  return error;
}

export function shouldClearSessionForError(error) {
  const status = error?.response?.status;
  const code = error?.response?.data?.code;
  if (!status || status >= 500 || error.code === "ERR_NETWORK" || error.code === "ECONNABORTED") return false;
  return [
    "ACCOUNT_DELETED",
    "ACCOUNT_DISABLED",
    "ACCOUNT_INACTIVE",
    "ACCOUNT_LOCKED",
    "ACCOUNT_NOT_ACTIVE",
    "APPROVAL_PENDING",
    "BANK_ACCOUNT_INACTIVE",
    "DEALER_ACCOUNT_INACTIVE",
    "EMAIL_NOT_VERIFIED",
    "IDENTITY_COLLISION",
    "INVALID_SESSION",
    "JWT_REQUIRED",
    "PORTAL_FORBIDDEN",
    "SESSION_EXPIRED",
    "SESSION_PORTAL_CHANGED",
    "SESSION_ORGANIZATION_CHANGED",
    "SESSION_REVOKED",
    "SESSION_ROLE_CHANGED",
    "SESSION_UID_CHANGED",
  ].includes(code);
}

export function restoredFirebaseUser(auth, onAuthStateChanged) {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = (user) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      unsubscribe();
      resolve(user || auth.currentUser || null);
    };
    const timeout = window.setTimeout(() => finish(null), 1200);
    unsubscribe = onAuthStateChanged(auth, finish);
  });
}
