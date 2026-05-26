export const ROLES = {
  FINANCE_DESK: "finance-desk",
  GM_SM: "gm-sm",
  BANK_MANAGER: "bank-manager",
  LOAN_EXECUTIVE: "loan-executive",
  SUPER_ADMIN: "super-admin",
};

export const ROLE_ROUTES = {
  [ROLES.FINANCE_DESK]: "/finance/total-leads",
  [ROLES.GM_SM]: "/gm/total-leads",
  [ROLES.BANK_MANAGER]: "/bank-manager/leads",
  [ROLES.LOAN_EXECUTIVE]: "/loan-executive/leads",
  [ROLES.SUPER_ADMIN]: "/admin/dashboard",
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
