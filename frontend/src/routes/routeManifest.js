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

export const passwordSmokeRoutes = Object.freeze([
  { path: "/finance/change-password", role: ROLES.FINANCE_DESK, loginPath: "/finance/login", module: "auth/ExecutiveChangePasswordPage.jsx" },
  { path: "/gm/change-password", role: ROLES.GM, loginPath: "/gm/login", module: "auth/ExecutiveChangePasswordPage.jsx" },
  { path: "/bank-manager/change-password", role: ROLES.BANK_MANAGER, loginPath: "/bank/login", module: "auth/ExecutiveChangePasswordPage.jsx" },
  { path: "/loan-executive/change-password", role: ROLES.LOAN_EXECUTIVE, loginPath: "/executive/login", module: "auth/ExecutiveChangePasswordPage.jsx" },
]);

export const registrationLifecycleRoutes = Object.freeze([
  { path: "/dealer-registration", module: "DealerRegistrationPage.jsx" },
  { path: "/dealer-registration/form", module: "DealerRegistrationPage.jsx" },
  { path: "/dealer-registration/verify-email", module: "DealerRegistrationPage.jsx" },
  { path: "/dealer-registration/pending", module: "DealerRegistrationPage.jsx" },
  { path: "/dealer-registration/pending-approval", module: "DealerRegistrationPage.jsx" },
  { path: "/dealer-registration/rejected", module: "DealerRegistrationPage.jsx" },
  { path: "/dealer-registration/suspended", module: "DealerRegistrationPage.jsx" },
  { path: "/dealer-registration/approved", module: "DealerRegistrationPage.jsx" },
  { path: "/bank-registration", module: "public/BankRegistration.jsx" },
  { path: "/bank-registration/form", module: "public/BankRegistration.jsx" },
  { path: "/bank-registration/verify-email", module: "public/BankRegistration.jsx" },
  { path: "/bank-registration/pending", module: "public/BankRegistration.jsx" },
  { path: "/bank-registration/pending-approval", module: "public/BankRegistration.jsx" },
  { path: "/bank-registration/rejected", module: "public/BankRegistration.jsx" },
  { path: "/bank-registration/suspended", module: "public/BankRegistration.jsx" },
  { path: "/bank-registration/approved", module: "public/BankRegistration.jsx" },
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
  ...passwordSmokeRoutes,
]);
