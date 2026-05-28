export const ROLES = {
  FINANCE_DESK: "finance-desk",
  GM_SM: "gm-sm",
  BANK_MANAGER: "bank-manager",
  LOAN_EXECUTIVE: "loan-executive",
  SUPER_ADMIN: "super-admin",
};

export const ROLE_ROUTES = {
  [ROLES.FINANCE_DESK]: "/finance/dashboard",
  [ROLES.GM_SM]: "/gm/dashboard",
  [ROLES.BANK_MANAGER]: "/bank-manager/dashboard",
  [ROLES.LOAN_EXECUTIVE]: "/loan-executive/leads",
  [ROLES.SUPER_ADMIN]: "/admin/dashboard",
};

export const ROLE_LOGIN_ROUTES = {
  [ROLES.FINANCE_DESK]: "/dealer/login",
  [ROLES.GM_SM]: "/dealer/login",
  [ROLES.BANK_MANAGER]: "/bank/login",
  [ROLES.LOAN_EXECUTIVE]: "/executive/login",
  [ROLES.SUPER_ADMIN]: "/admin/login",
};

export const ROLE_PASSWORD_ROUTES = {
  [ROLES.FINANCE_DESK]: "/finance/change-password",
  [ROLES.GM_SM]: "/gm/change-password",
  [ROLES.LOAN_EXECUTIVE]: "/loan-executive/change-password",
};

export const ROLE_LABELS = {
  [ROLES.FINANCE_DESK]: "Finance Desk",
  [ROLES.GM_SM]: "GM / SM Head Admin",
  [ROLES.BANK_MANAGER]: "Bank Branch Manager",
  [ROLES.LOAN_EXECUTIVE]: "Loan Executive",
  [ROLES.SUPER_ADMIN]: "Super Admin",
};

export const PORTAL_ROLES = {
  dealer: [ROLES.FINANCE_DESK, ROLES.GM_SM],
  bank: [ROLES.BANK_MANAGER, ROLES.LOAN_EXECUTIVE],
  admin: [ROLES.SUPER_ADMIN],
};

export function isKnownRole(role) {
  return Boolean(ROLE_ROUTES[role]);
}

export function loginPathForRole(role) {
  return ROLE_LOGIN_ROUTES[role] || "/dealer/login";
}

export function dashboardPathForRole(role) {
  return ROLE_ROUTES[role] || loginPathForRole(role);
}

export function passwordPathForRole(role) {
  return ROLE_PASSWORD_ROUTES[role] || null;
}

export function requiresPasswordChange(user) {
  return Boolean(user && (user.firstLoginRequired === true || user.passwordExpired === true));
}
