import { lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { PublicLayout } from "../layouts/PublicLayout.jsx";
import { ROLES } from "../auth/roleSystem.js";
import { ProtectedRoute } from "./ProtectedRoute.jsx";
import { RouteErrorBoundary } from "./RouteErrorBoundary.jsx";

const moduleCache = new WeakMap();

function loadModule(factory) {
  if (!moduleCache.has(factory)) {
    moduleCache.set(factory, factory());
  }
  return moduleCache.get(factory);
}

function lazyPage(factory, exportName) {
  return lazy(() => loadModule(factory).then((module) => ({ default: module[exportName] })));
}

const pageModules = {
  home: () => import("../pages/HomePage.jsx"),
  howItWorks: () => import("../pages/HowItWorksPage.jsx"),
  plansBilling: () => import("../pages/PlansBillingPage.jsx"),
  dealerRegistration: () => import("../pages/DealerRegistrationPage.jsx"),
  subscriptionActivation: () => import("../pages/SubscriptionActivationPage.jsx"),
  bankRegistration: () => import("../pages/public/BankRegistration.jsx"),
  bankBranchManager: () => import("../pages/bank/BankBranchManagerPanel.jsx"),
  bankManagerLeadDetail: () => import("../pages/bank/BankManagerLeadDetailPage.jsx"),
  loanExecutive: () => import("../pages/bank/LoanExecutivePanel.jsx"),
  login: () => import("../pages/auth/LoginPage.jsx"),
  executiveChangePassword: () => import("../pages/auth/ExecutiveChangePasswordPage.jsx"),
  loginActivity: () => import("../pages/security/LoginActivityPage.jsx"),
  financeDesk: () => import("../pages/dashboard/FinanceDeskPanel.jsx"),
  financeLeadDetail: () => import("../pages/dashboard/finance/FinanceLeadDetailPage.jsx"),
  financeLeadDocuments: () => import("../pages/dashboard/finance/FinanceLeadDocumentsPage.jsx"),
  financeStaffDetail: () => import("../pages/dashboard/finance/FinanceStaffDetailPage.jsx"),
  gmTracking: () => import("../pages/dashboard/GmTrackingPanel.jsx"),
  superAdmin: () => import("../pages/dashboard/SuperAdminDashboard.jsx"),
  adminMonitoring: () => import("../pages/dashboard/AdminMonitoringCenter.jsx"),
  deadCases: () => import("../pages/dashboard/DeadCasesPage.jsx"),
  legal: () => import("../pages/legal/LegalPages.jsx"),
};

const HomePage = lazyPage(pageModules.home, "HomePage");
const HowItWorksPage = lazyPage(pageModules.howItWorks, "HowItWorksPage");
const PlansBillingPage = lazyPage(pageModules.plansBilling, "PlansBillingPage");
const DealerRegistrationPage = lazyPage(pageModules.dealerRegistration, "DealerRegistrationPage");
const DealerRegistrationFormPage = lazyPage(pageModules.dealerRegistration, "DealerRegistrationFormPage");
const DealerRegistrationPendingPage = lazyPage(pageModules.dealerRegistration, "DealerRegistrationPendingPage");
const DealerRegistrationApprovedPage = lazyPage(pageModules.dealerRegistration, "DealerRegistrationApprovedPage");
const SubscriptionActivationPage = lazyPage(pageModules.subscriptionActivation, "SubscriptionActivationPage");
const BankRegistration = lazyPage(pageModules.bankRegistration, "BankRegistration");
const BankBranchManagerPanel = lazyPage(pageModules.bankBranchManager, "BankBranchManagerPanel");
const BankManagerLeadDetailPage = lazyPage(pageModules.bankManagerLeadDetail, "BankManagerLeadDetailPage");
const LoanExecutivePanel = lazyPage(pageModules.loanExecutive, "LoanExecutivePanel");
const LoanExecutiveLeadDetailPage = lazyPage(pageModules.loanExecutive, "LoanExecutiveLeadDetailPage");
const LoginPage = lazyPage(pageModules.login, "LoginPage");
const ExecutiveChangePasswordPage = lazyPage(pageModules.executiveChangePassword, "ExecutiveChangePasswordPage");
const LoginActivityPage = lazyPage(pageModules.loginActivity, "LoginActivityPage");
const FinanceDeskPanel = lazyPage(pageModules.financeDesk, "FinanceDeskPanel");
const FinanceStaffDetailPage = lazyPage(pageModules.financeStaffDetail, "FinanceStaffDetailPage");
const FinanceLeadDetailPage = lazyPage(pageModules.financeLeadDetail, "FinanceLeadDetailPage");
const FinanceLeadDocumentsPage = lazyPage(pageModules.financeLeadDocuments, "FinanceLeadDocumentsPage");
const GmTrackingPanel = lazyPage(pageModules.gmTracking, "GmTrackingPanel");
const GmLeadDetailPage = lazyPage(pageModules.gmTracking, "GmLeadDetailPage");
const SuperAdminDashboard = lazyPage(pageModules.superAdmin, "SuperAdminDashboard");
const SuperAdminDealershipDetailPage = lazyPage(pageModules.superAdmin, "SuperAdminDealershipDetailPage");
const SuperAdminApprovalDetailPage = lazyPage(pageModules.superAdmin, "SuperAdminApprovalDetailPage");
const SuperAdminLeadDetailPage = lazyPage(pageModules.superAdmin, "SuperAdminLeadDetailPage");
const AdminMonitoringCenter = lazyPage(pageModules.adminMonitoring, "AdminMonitoringCenter");
const DeadCasesPage = lazyPage(pageModules.deadCases, "DeadCasesPage");
const LegalPage = lazyPage(pageModules.legal, "LegalPage");
const DashboardLayout = lazy(() => import("../layouts/DashboardLayout.jsx").then((module) => ({ default: module.DashboardLayout })));

export const router = createBrowserRouter([
  {
    errorElement: <RouteErrorBoundary />,
    element: <PublicLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/how-it-works", element: <HowItWorksPage /> },
      { path: "/plans-and-billing", element: <PlansBillingPage /> },
      { path: "/terms", element: <LegalPage policy="terms" /> },
      { path: "/privacy", element: <LegalPage policy="privacy" /> },
      { path: "/refund-policy", element: <LegalPage policy="refund" /> },
      { path: "/subscription-policy", element: <LegalPage policy="subscription" /> },
      { path: "/cars/:brandSlug", element: <Navigate to="/" replace /> },
      { path: "/apply-loan", element: <Navigate to="/" replace /> },
      { path: "/dealer/register", element: <DealerRegistrationPage /> },
      { path: "/dealer/login", element: <LoginPage portal="dealer" /> },
      { path: "/finance/register", element: <DealerRegistrationPage audience="finance" /> },
      { path: "/finance/login", element: <LoginPage portal="finance" /> },
      { path: "/gm/login", element: <LoginPage portal="gm" /> },
      { path: "/bank/register", element: <BankRegistration /> },
      { path: "/bank/login", element: <LoginPage portal="bank" /> },
      { path: "/executive/register", element: <BankRegistration audience="executive" /> },
      { path: "/executive/login", element: <LoginPage portal="executive" /> },
      { path: "/loan-executive/login", element: <Navigate to="/executive/login" replace /> },
      { path: "/admin/login", element: <LoginPage portal="admin" /> },
      { path: "/dealer-registration", element: <DealerRegistrationPage /> },
      { path: "/dealer-registration/form", element: <DealerRegistrationFormPage /> },
      { path: "/dealer-registration/verify-email", element: <DealerRegistrationPendingPage mode="verify-email" /> },
      { path: "/dealer-registration/pending", element: <DealerRegistrationPendingPage /> },
      { path: "/dealer-registration/pending-approval", element: <DealerRegistrationPendingPage /> },
      { path: "/dealer-registration/rejected", element: <DealerRegistrationPendingPage mode="rejected" /> },
      { path: "/dealer-registration/suspended", element: <DealerRegistrationPendingPage mode="suspended" /> },
      { path: "/dealer-registration/approved", element: <DealerRegistrationApprovedPage /> },
      { path: "/subscription-activation", element: <SubscriptionActivationPage /> },
      { path: "/bank-registration", element: <BankRegistration /> },
      { path: "/bank-registration/form", element: <BankRegistration mode="form" /> },
      { path: "/bank-registration/verify-email", element: <BankRegistration mode="verify-email" /> },
      { path: "/bank-registration/pending", element: <BankRegistration mode="pending" /> },
      { path: "/bank-registration/pending-approval", element: <BankRegistration mode="pending" /> },
      { path: "/bank-registration/rejected", element: <BankRegistration mode="rejected" /> },
      { path: "/bank-registration/suspended", element: <BankRegistration mode="suspended" /> },
      { path: "/bank-registration/approved", element: <BankRegistration mode="approved" /> },
      { path: "/services", element: <Navigate to="/" replace /> },
      { path: "/marketplace", element: <Navigate to="/" replace /> },
      { path: "/partners", element: <Navigate to="/" replace /> },
      { path: "/dealer-login", element: <Navigate to="/dealer/login" replace /> },
      { path: "/bank-login", element: <Navigate to="/bank/login" replace /> },
      { path: "/super-admin", element: <Navigate to="/admin/login" replace /> },
      { path: "/login", element: <Navigate to="/dealer/login" replace /> },
      { path: "/register", element: <Navigate to="/dealer-registration" replace /> },
      { path: "/otp", element: <Navigate to="/dealer/login" replace /> },
      { path: "/role-selection", element: <Navigate to="/dealer/login" replace /> },
    ],
  },
  {
    path: "/gm",
    errorElement: <RouteErrorBoundary />,
    element: <ProtectedRoute roles={[ROLES.GM]} loginPath="/gm/login" />,
    children: [
      { path: "dashboard", element: <DashboardLayout />, children: [{ index: true, element: <Navigate to="/gm/total-leads" replace /> }] },
      { path: "change-password", element: <ExecutiveChangePasswordPage /> },
      { path: "total-leads", element: <DashboardLayout />, children: [{ index: true, element: <GmTrackingPanel mode="total" /> }] },
      { path: "leads", element: <DashboardLayout />, children: [{ index: true, element: <Navigate to="/gm/cases" replace /> }] },
      { path: "leads/:leadId", element: <DashboardLayout />, children: [{ index: true, element: <GmLeadDetailPage /> }] },
      { path: "salespersons", element: <DashboardLayout />, children: [{ index: true, element: <GmTrackingPanel mode="salespersons" /> }] },
      { path: "salespersons/:salespersonId/cases", element: <DashboardLayout />, children: [{ index: true, element: <GmTrackingPanel mode="salesperson-cases" /> }] },
      { path: "status", element: <DashboardLayout />, children: [{ index: true, element: <GmTrackingPanel mode="status" /> }] },
      { path: "cases", element: <DashboardLayout />, children: [{ index: true, element: <GmTrackingPanel mode="cases" /> }] },
      { path: "dead-cases", element: <DashboardLayout />, children: [{ index: true, element: <DeadCasesPage audience="gm" /> }] },
      { path: "banks", element: <DashboardLayout />, children: [{ index: true, element: <Navigate to="/gm/cases" replace /> }] },
      { path: "reports", element: <DashboardLayout />, children: [{ index: true, element: <Navigate to="/gm/cases" replace /> }] },
      { path: "analytics", element: <DashboardLayout />, children: [{ index: true, element: <Navigate to="/gm/status" replace /> }] },
      { path: "notifications", element: <DashboardLayout />, children: [{ index: true, element: <Navigate to="/gm/status" replace /> }] },
      { path: "settings", element: <DashboardLayout />, children: [{ index: true, element: <Navigate to="/gm/cases" replace /> }] },
    ],
  },
  {
    path: "/finance",
    errorElement: <RouteErrorBoundary />,
    element: <ProtectedRoute roles={[ROLES.FINANCE_DESK]} loginPath="/finance/login" />,
    children: [
      {
        element: <DashboardLayout />,
        children: [
          { path: "dashboard", element: <Navigate to="/finance/total-leads" replace /> },
          { path: "change-password", element: <ExecutiveChangePasswordPage /> },
          { path: "total-leads", element: <FinanceDeskPanel mode="total" /> },
          { path: "add-lead", element: <FinanceDeskPanel mode="add" /> },
          { path: "manage-staff", element: <FinanceDeskPanel mode="staff" /> },
          { path: "staff/:employeeId", element: <FinanceStaffDetailPage /> },
          { path: "manage-team", element: <Navigate to="/finance/manage-staff" replace /> },
          { path: "finance-managers", element: <FinanceDeskPanel mode="finance-managers" /> },
          { path: "cases", element: <FinanceDeskPanel mode="cases" /> },
          { path: "status", element: <FinanceDeskPanel mode="status" /> },
          { path: "bank-tieups", element: <FinanceDeskPanel mode="bank-tieups" /> },
          { path: "dead-cases", element: <DeadCasesPage audience="finance" /> },
          { path: "leads/:leadId/documents", element: <FinanceLeadDocumentsPage /> },
          { path: "leads/:leadId", element: <FinanceLeadDetailPage /> },
          { path: "salespersons", element: <FinanceDeskPanel mode="salespersons" /> },
          { path: "active-members", element: <FinanceDeskPanel mode="active-members" /> },
          { path: "active-salespersons", element: <Navigate to="/finance/active-members" replace /> },
          { path: "new-lead", element: <Navigate to="/finance/add-lead" replace /> },
          { path: "leads", element: <Navigate to="/finance/cases" replace /> },
          { path: "pending-documents", element: <Navigate to="/finance/status?status=Pending%20Documents" replace /> },
          { path: "bank-processing", element: <Navigate to="/finance/status?status=Bank%20Processing" replace /> },
          { path: "approved", element: <Navigate to="/finance/status?status=Disbursed" replace /> },
          { path: "disbursed", element: <Navigate to="/finance/status?status=Disbursed" replace /> },
          { path: "rejected", element: <Navigate to="/finance/status?status=Rejected" replace /> },
          { path: "reports", element: <Navigate to="/finance/cases" replace /> },
          { path: "settings", element: <Navigate to="/finance/cases" replace /> },
        ],
      },
    ],
  },
  {
    path: "/change-password",
    errorElement: <RouteErrorBoundary />,
    element: <ProtectedRoute roles={[ROLES.FINANCE_DESK, ROLES.GM, ROLES.BANK_MANAGER, ROLES.LOAN_EXECUTIVE]} loginPath="/finance/login" />,
    children: [
      { index: true, element: <ExecutiveChangePasswordPage /> },
    ],
  },
  {
    path: "/security",
    errorElement: <RouteErrorBoundary />,
    element: <ProtectedRoute roles={[ROLES.FINANCE_DESK, ROLES.GM, ROLES.BANK_MANAGER, ROLES.LOAN_EXECUTIVE, ROLES.SUPER_ADMIN]} loginPath="/finance/login" />,
    children: [
      { path: "login-activity", element: <DashboardLayout />, children: [{ index: true, element: <LoginActivityPage /> }] },
    ],
  },
  {
    path: "/dealer",
    errorElement: <RouteErrorBoundary />,
    element: <ProtectedRoute roles={[ROLES.FINANCE_DESK]} loginPath="/finance/login" />,
    children: [
      { path: "dashboard", element: <Navigate to="/finance/dashboard" replace /> },
    ],
  },
  {
    path: "/bank-manager",
    errorElement: <RouteErrorBoundary />,
    element: <ProtectedRoute roles={[ROLES.BANK_MANAGER]} loginPath="/bank/login" />,
    children: [
      { path: "dashboard", element: <Navigate to="/bank-manager/leads" replace /> },
      { path: "change-password", element: <ExecutiveChangePasswordPage /> },
      { path: "leads", element: <DashboardLayout />, children: [{ index: true, element: <BankBranchManagerPanel mode="leads" /> }] },
      { path: "status", element: <DashboardLayout />, children: [{ index: true, element: <BankBranchManagerPanel mode="status" /> }] },
      { path: "analytics", element: <DashboardLayout />, children: [{ index: true, element: <BankBranchManagerPanel mode="analytics" /> }] },
      { path: "dead-cases", element: <DashboardLayout />, children: [{ index: true, element: <DeadCasesPage audience="bank" /> }] },
      { path: "manage-executive", element: <DashboardLayout />, children: [{ index: true, element: <BankBranchManagerPanel mode="manage-executive" /> }] },
      { path: "executives", element: <DashboardLayout />, children: [{ index: true, element: <BankBranchManagerPanel mode="executives" /> }] },
      { path: "executives/:executiveId/cases", element: <DashboardLayout />, children: [{ index: true, element: <BankBranchManagerPanel mode="executive-cases" /> }] },
      { path: "dealerships", element: <DashboardLayout />, children: [{ index: true, element: <BankBranchManagerPanel mode="dealerships" /> }] },
      { path: "dealerships/:dealershipId/disbursed", element: <DashboardLayout />, children: [{ index: true, element: <BankBranchManagerPanel mode="dealership-disbursed" /> }] },
      { path: "leads/:leadId", element: <DashboardLayout />, children: [{ index: true, element: <BankManagerLeadDetailPage /> }] },
      { path: "incoming", element: <Navigate to="/bank-manager/leads" replace /> },
      { path: "assigned", element: <Navigate to="/bank-manager/leads" replace /> },
      { path: "approved", element: <Navigate to="/bank-manager/leads" replace /> },
      { path: "rejected", element: <Navigate to="/bank-manager/leads" replace /> },
      { path: "disbursed", element: <Navigate to="/bank-manager/leads" replace /> },
      { path: "reports", element: <Navigate to="/bank-manager/analytics" replace /> },
      { path: "notifications", element: <Navigate to="/bank-manager/leads" replace /> },
      { path: "settings", element: <Navigate to="/bank-manager/leads" replace /> },
    ],
  },
  {
    path: "/loan-executive",
    errorElement: <RouteErrorBoundary />,
    element: <ProtectedRoute roles={[ROLES.LOAN_EXECUTIVE]} loginPath="/executive/login" />,
    children: [
      { path: "dashboard", element: <Navigate to="/loan-executive/leads" replace /> },
      { path: "assigned", element: <Navigate to="/loan-executive/leads" replace /> },
      { path: "change-password", element: <ExecutiveChangePasswordPage /> },
      { path: "leads", element: <DashboardLayout />, children: [{ index: true, element: <LoanExecutivePanel mode="leads" /> }] },
      { path: "leads/:leadId", element: <DashboardLayout />, children: [{ index: true, element: <LoanExecutiveLeadDetailPage /> }] },
      { path: "status", element: <DashboardLayout />, children: [{ index: true, element: <LoanExecutivePanel mode="status" /> }] },
      { path: "dead-cases", element: <DashboardLayout />, children: [{ index: true, element: <DeadCasesPage audience="executive" /> }] },
      { path: "documents", element: <Navigate to="/loan-executive/status?status=REQUEST_PENDING_DOCUMENTS" replace /> },
      { path: "review", element: <Navigate to="/loan-executive/status?status=UNDER_BANK_PROCESS" replace /> },
      { path: "approved", element: <Navigate to="/loan-executive/status?status=UNDER_BANK_PROCESS" replace /> },
      { path: "rejected", element: <Navigate to="/loan-executive/status?status=REJECTED" replace /> },
      { path: "disbursed", element: <Navigate to="/loan-executive/status?status=DISBURSED" replace /> },
      { path: "timeline", element: <Navigate to="/loan-executive/leads" replace /> },
      { path: "notifications", element: <Navigate to="/loan-executive/leads" replace /> },
      { path: "reports", element: <Navigate to="/loan-executive/leads" replace /> },
      { path: "settings", element: <Navigate to="/loan-executive/leads" replace /> },
    ],
  },
  {
    path: "/admin",
    errorElement: <RouteErrorBoundary />,
    element: <ProtectedRoute roles={[ROLES.SUPER_ADMIN]} loginPath="/admin/login" />,
    children: [
      {
        element: <DashboardLayout />,
        children: [
          { path: "dashboard", element: <Navigate to="/admin/leads" replace /> },
          { path: "dealerships", element: <SuperAdminDashboard mode="dealerships" /> },
          { path: "dealerships/:id", element: <SuperAdminDealershipDetailPage /> },
          { path: "banks", element: <SuperAdminDashboard mode="banks" /> },
          { path: "status", element: <Navigate to="/admin/leads" replace /> },
          { path: "leads", element: <SuperAdminDashboard mode="leads" /> },
          { path: "dead-cases", element: <Navigate to="/admin/leads" replace /> },
          { path: "leads/:leadId", element: <SuperAdminLeadDetailPage /> },
          { path: "monitoring", element: <AdminMonitoringCenter /> },
          { path: "approvals/dealerships", element: <SuperAdminDashboard mode="approval-dealerships" /> },
          { path: "approvals/dealerships/:id", element: <SuperAdminApprovalDetailPage type="dealerships" /> },
          { path: "approvals/banks", element: <SuperAdminDashboard mode="approval-banks" /> },
          { path: "approvals/banks/:id", element: <SuperAdminApprovalDetailPage type="banks" /> },
          { path: "finance-desks", element: <Navigate to="/admin/dealerships" replace /> },
          { path: "gm", element: <Navigate to="/admin/dealerships" replace /> },
          { path: "branches", element: <Navigate to="/admin/banks" replace /> },
          { path: "executives", element: <Navigate to="/admin/banks" replace /> },
          { path: "approvals/approved", element: <Navigate to="/admin/dealerships" replace /> },
          { path: "approvals/rejected", element: <Navigate to="/admin/approvals/dealerships" replace /> },
          { path: "routing", element: <Navigate to="/admin/dashboard" replace /> },
          { path: "timeline", element: <Navigate to="/admin/dashboard" replace /> },
          { path: "notifications", element: <Navigate to="/admin/dashboard" replace /> },
          { path: "whatsapp", element: <Navigate to="/admin/dashboard" replace /> },
          { path: "approvals/logs", element: <Navigate to="/admin/dashboard" replace /> },
          { path: "access/:section", element: <Navigate to="/admin/dashboard" replace /> },
          { path: "analytics", element: <Navigate to="/admin/dashboard" replace /> },
          { path: "fraud", element: <Navigate to="/admin/dashboard" replace /> },
          { path: "logs", element: <Navigate to="/admin/dashboard" replace /> },
          { path: "settings", element: <Navigate to="/admin/dashboard" replace /> },
          { path: "audit-logs", element: <Navigate to="/admin/dashboard" replace /> },
        ],
      },
    ],
  },
  { path: "/bank/*", element: <Navigate to="/bank/login" replace /> },
  { path: "/app/*", element: <Navigate to="/dealer/login" replace /> },
]);
