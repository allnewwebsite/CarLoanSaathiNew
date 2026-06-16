import { ROLES } from "../auth/roleSystem.js";

export const loginSmokeRoutes = Object.freeze([
  { path: "/finance/login", portal: "finance", role: ROLES.FINANCE_DESK },
  { path: "/gm/login", portal: "gm", role: ROLES.GM },
  { path: "/bank/login", portal: "bank", role: ROLES.BANK_MANAGER },
  { path: "/executive/login", portal: "executive", role: ROLES.LOAN_EXECUTIVE },
  { path: "/admin/login", portal: "admin", role: ROLES.SUPER_ADMIN },
]);

export const protectedSmokeRoutes = Object.freeze([
  { path: "/finance/total-leads", role: ROLES.FINANCE_DESK, loginPath: "/finance/login", module: "dashboard/FinanceDeskPanel.jsx" },
  { path: "/gm/total-leads", role: ROLES.GM, loginPath: "/gm/login", module: "dashboard/GmTrackingPanel.jsx" },
  { path: "/bank-manager/leads", role: ROLES.BANK_MANAGER, loginPath: "/bank/login", module: "bank/BankBranchManagerPanel.jsx" },
  { path: "/loan-executive/leads", role: ROLES.LOAN_EXECUTIVE, loginPath: "/executive/login", module: "bank/LoanExecutivePanel.jsx" },
  { path: "/admin/leads", role: ROLES.SUPER_ADMIN, loginPath: "/admin/login", module: "dashboard/SuperAdminDashboard.jsx" },
]);

export const publicSmokeRoutes = Object.freeze([
  { path: "/", module: "HomePage.jsx" },
  { path: "/how-it-works", module: "HowItWorksPage.jsx" },
  { path: "/plans-and-billing", module: "PlansBillingPage.jsx" },
  { path: "/dealer-registration", module: "DealerRegistrationPage.jsx" },
  { path: "/bank-registration", module: "public/BankRegistration.jsx" },
]);

export const routeSmokeManifest = Object.freeze([
  ...publicSmokeRoutes,
  ...loginSmokeRoutes.map((route) => ({ ...route, module: "auth/LoginPage.jsx" })),
  ...protectedSmokeRoutes,
]);
