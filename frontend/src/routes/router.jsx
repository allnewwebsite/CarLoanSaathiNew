import { lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { PublicLayout } from "../layouts/PublicLayout.jsx";
import { DashboardLayout } from "../layouts/DashboardLayout.jsx";
import { ROLES } from "../auth/roleSystem.js";
import { ProtectedRoute } from "./ProtectedRoute.jsx";

function lazyPage(factory, exportName) {
  return lazy(() => factory().then((module) => ({ default: module[exportName] })));
}

const HomePage = lazyPage(() => import("../pages/HomePage.jsx"), "HomePage");
const ServicesPage = lazyPage(() => import("../pages/ServicesPage.jsx"), "ServicesPage");
const MarketplacePage = lazyPage(() => import("../pages/MarketplacePage.jsx"), "MarketplacePage");
const PartnerProgramPage = lazyPage(() => import("../pages/PartnerProgramPage.jsx"), "PartnerProgramPage");
const CarsPage = lazyPage(() => import("../pages/CarsPage.jsx"), "CarsPage");
const ApplyLoanPage = lazyPage(() => import("../pages/ApplyLoanPage.jsx"), "ApplyLoanPage");
const DealerRegistrationPage = lazyPage(() => import("../pages/DealerRegistrationPage.jsx"), "DealerRegistrationPage");
const DealerRegistrationFormPage = lazyPage(() => import("../pages/DealerRegistrationPage.jsx"), "DealerRegistrationFormPage");
const DealerRegistrationPendingPage = lazyPage(() => import("../pages/DealerRegistrationPage.jsx"), "DealerRegistrationPendingPage");
const DealerRegistrationApprovedPage = lazyPage(() => import("../pages/DealerRegistrationPage.jsx"), "DealerRegistrationApprovedPage");
const BankRegistration = lazyPage(() => import("../pages/public/BankRegistration.jsx"), "BankRegistration");
const BankBranchManagerPanel = lazyPage(() => import("../pages/bank/BankBranchManagerPanel.jsx"), "BankBranchManagerPanel");
const BankManagerLeadDetailPage = lazyPage(() => import("../pages/bank/BankBranchManagerPanel.jsx"), "BankManagerLeadDetailPage");
const LoanExecutivePanel = lazyPage(() => import("../pages/bank/LoanExecutivePanel.jsx"), "LoanExecutivePanel");
const LoanExecutiveLeadDetailPage = lazyPage(() => import("../pages/bank/LoanExecutivePanel.jsx"), "LoanExecutiveLeadDetailPage");
const LoginPage = lazyPage(() => import("../pages/auth/LoginPage.jsx"), "LoginPage");
const ExecutiveChangePasswordPage = lazyPage(() => import("../pages/auth/ExecutiveChangePasswordPage.jsx"), "ExecutiveChangePasswordPage");
const FinanceDeskPanel = lazyPage(() => import("../pages/dashboard/FinanceDeskPanel.jsx"), "FinanceDeskPanel");
const FinanceLeadDetailPage = lazyPage(() => import("../pages/dashboard/FinanceDeskPanel.jsx"), "FinanceLeadDetailPage");
const FinanceLeadDocumentsPage = lazyPage(() => import("../pages/dashboard/FinanceDeskPanel.jsx"), "FinanceLeadDocumentsPage");
const GmTrackingPanel = lazyPage(() => import("../pages/dashboard/GmTrackingPanel.jsx"), "GmTrackingPanel");
const GmLeadDetailPage = lazyPage(() => import("../pages/dashboard/GmTrackingPanel.jsx"), "GmLeadDetailPage");
const SuperAdminDashboard = lazyPage(() => import("../pages/dashboard/SuperAdminDashboard.jsx"), "SuperAdminDashboard");
const SuperAdminDealershipDetailPage = lazyPage(() => import("../pages/dashboard/SuperAdminDashboard.jsx"), "SuperAdminDealershipDetailPage");
const SuperAdminApprovalDetailPage = lazyPage(() => import("../pages/dashboard/SuperAdminDashboard.jsx"), "SuperAdminApprovalDetailPage");
const SuperAdminLeadDetailPage = lazyPage(() => import("../pages/dashboard/SuperAdminDashboard.jsx"), "SuperAdminLeadDetailPage");

export const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/cars/:brandSlug", element: <CarsPage /> },
      { path: "/apply-loan", element: <ApplyLoanPage /> },
      { path: "/dealer/register", element: <DealerRegistrationPage /> },
      { path: "/dealer/login", element: <LoginPage portal="dealer" /> },
      { path: "/finance/register", element: <DealerRegistrationPage audience="finance" /> },
      { path: "/finance/login", element: <LoginPage portal="finance" /> },
      { path: "/bank/register", element: <BankRegistration /> },
      { path: "/bank/login", element: <LoginPage portal="bank" /> },
      { path: "/executive/register", element: <BankRegistration audience="executive" /> },
      { path: "/executive/login", element: <LoginPage portal="executive" /> },
      { path: "/dealer-registration", element: <DealerRegistrationPage /> },
      { path: "/dealer-registration/form", element: <DealerRegistrationFormPage /> },
      { path: "/dealer-registration/pending", element: <DealerRegistrationPendingPage /> },
      { path: "/dealer-registration/pending-approval", element: <DealerRegistrationPendingPage /> },
      { path: "/dealer-registration/approved", element: <DealerRegistrationApprovedPage /> },
      { path: "/bank-registration", element: <BankRegistration /> },
      { path: "/bank-registration/form", element: <BankRegistration mode="form" /> },
      { path: "/bank-registration/pending", element: <BankRegistration mode="pending" /> },
      { path: "/bank-registration/pending-approval", element: <BankRegistration mode="pending" /> },
      { path: "/bank-registration/approved", element: <BankRegistration mode="approved" /> },
      { path: "/services", element: <ServicesPage /> },
      { path: "/marketplace", element: <MarketplacePage /> },
      { path: "/partners", element: <PartnerProgramPage /> },
      { path: "/dealer-login", element: <LoginPage portal="dealer" /> },
      { path: "/bank-login", element: <LoginPage portal="bank" /> },
      { path: "/super-admin", element: <LoginPage portal="admin" /> },
      { path: "/login", element: <Navigate to="/dealer-login" replace /> },
      { path: "/register", element: <Navigate to="/dealer-registration" replace /> },
      { path: "/otp", element: <Navigate to="/dealer-login" replace /> },
      { path: "/role-selection", element: <Navigate to="/dealer-login" replace /> },
    ],
  },
  {
    path: "/gm",
    element: <ProtectedRoute roles={[ROLES.GM_SM]} loginPath="/dealer-login" />,
    children: [
      { path: "dashboard", element: <DashboardLayout />, children: [{ index: true, element: <Navigate to="/gm/total-leads" replace /> }] },
      { path: "total-leads", element: <DashboardLayout />, children: [{ index: true, element: <GmTrackingPanel mode="total" /> }] },
      { path: "leads", element: <DashboardLayout />, children: [{ index: true, element: <Navigate to="/gm/cases" replace /> }] },
      { path: "leads/:leadId", element: <DashboardLayout />, children: [{ index: true, element: <GmLeadDetailPage /> }] },
      { path: "salespersons", element: <DashboardLayout />, children: [{ index: true, element: <GmTrackingPanel mode="salespersons" /> }] },
      { path: "salespersons/:salespersonId/cases", element: <DashboardLayout />, children: [{ index: true, element: <GmTrackingPanel mode="salesperson-cases" /> }] },
      { path: "status", element: <DashboardLayout />, children: [{ index: true, element: <GmTrackingPanel mode="status" /> }] },
      { path: "cases", element: <DashboardLayout />, children: [{ index: true, element: <GmTrackingPanel mode="cases" /> }] },
      { path: "banks", element: <DashboardLayout />, children: [{ index: true, element: <Navigate to="/gm/cases" replace /> }] },
      { path: "reports", element: <DashboardLayout />, children: [{ index: true, element: <Navigate to="/gm/cases" replace /> }] },
      { path: "analytics", element: <DashboardLayout />, children: [{ index: true, element: <Navigate to="/gm/status" replace /> }] },
      { path: "notifications", element: <DashboardLayout />, children: [{ index: true, element: <Navigate to="/gm/status" replace /> }] },
      { path: "settings", element: <DashboardLayout />, children: [{ index: true, element: <Navigate to="/gm/cases" replace /> }] },
    ],
  },
  {
    path: "/finance",
    element: <ProtectedRoute roles={[ROLES.FINANCE_DESK]} loginPath="/dealer-login" />,
    children: [
      {
        element: <DashboardLayout />,
        children: [
          { path: "dashboard", element: <Navigate to="/finance/total-leads" replace /> },
          { path: "total-leads", element: <FinanceDeskPanel mode="total" /> },
          { path: "add-lead", element: <FinanceDeskPanel mode="add" /> },
          { path: "cases", element: <FinanceDeskPanel mode="cases" /> },
          { path: "status", element: <FinanceDeskPanel mode="status" /> },
          { path: "leads/:leadId/documents", element: <FinanceLeadDocumentsPage /> },
          { path: "leads/:leadId", element: <FinanceLeadDetailPage /> },
          { path: "salespersons", element: <FinanceDeskPanel mode="salespersons" /> },
          { path: "active-salespersons", element: <FinanceDeskPanel mode="active-salespersons" /> },
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
    path: "/dealer",
    element: <ProtectedRoute roles={[ROLES.FINANCE_DESK]} loginPath="/dealer-login" />,
    children: [
      { path: "dashboard", element: <Navigate to="/finance/dashboard" replace /> },
    ],
  },
  {
    path: "/bank-manager",
    element: <ProtectedRoute roles={[ROLES.BANK_MANAGER]} loginPath="/bank-login" />,
    children: [
      { path: "dashboard", element: <Navigate to="/bank-manager/leads" replace /> },
      { path: "leads", element: <DashboardLayout />, children: [{ index: true, element: <BankBranchManagerPanel mode="leads" /> }] },
      { path: "manage-executive", element: <DashboardLayout />, children: [{ index: true, element: <BankBranchManagerPanel mode="manage-executive" /> }] },
      { path: "executives", element: <DashboardLayout />, children: [{ index: true, element: <BankBranchManagerPanel mode="executives" /> }] },
      { path: "executives/:executiveId/cases", element: <DashboardLayout />, children: [{ index: true, element: <BankBranchManagerPanel mode="executive-cases" /> }] },
      { path: "leads/:leadId", element: <DashboardLayout />, children: [{ index: true, element: <BankManagerLeadDetailPage /> }] },
      { path: "incoming", element: <Navigate to="/bank-manager/leads" replace /> },
      { path: "assigned", element: <Navigate to="/bank-manager/leads" replace /> },
      { path: "sla", element: <Navigate to="/bank-manager/leads" replace /> },
      { path: "approved", element: <Navigate to="/bank-manager/leads" replace /> },
      { path: "rejected", element: <Navigate to="/bank-manager/leads" replace /> },
      { path: "disbursed", element: <Navigate to="/bank-manager/leads" replace /> },
      { path: "analytics", element: <Navigate to="/bank-manager/leads" replace /> },
      { path: "notifications", element: <Navigate to="/bank-manager/leads" replace /> },
      { path: "reports", element: <Navigate to="/bank-manager/leads" replace /> },
      { path: "settings", element: <Navigate to="/bank-manager/leads" replace /> },
    ],
  },
  {
    path: "/loan-executive",
    element: <ProtectedRoute roles={[ROLES.LOAN_EXECUTIVE]} loginPath="/executive/login" />,
    children: [
      { path: "dashboard", element: <Navigate to="/loan-executive/leads" replace /> },
      { path: "assigned", element: <Navigate to="/loan-executive/leads" replace /> },
      { path: "change-password", element: <ExecutiveChangePasswordPage /> },
      { path: "leads", element: <DashboardLayout />, children: [{ index: true, element: <LoanExecutivePanel mode="leads" /> }] },
      { path: "leads/:leadId", element: <DashboardLayout />, children: [{ index: true, element: <LoanExecutiveLeadDetailPage /> }] },
      { path: "status", element: <DashboardLayout />, children: [{ index: true, element: <LoanExecutivePanel mode="status" /> }] },
      { path: "documents", element: <Navigate to="/loan-executive/status?status=DOCS_PENDING" replace /> },
      { path: "review", element: <Navigate to="/loan-executive/status?status=UNDER_REVIEW" replace /> },
      { path: "approved", element: <Navigate to="/loan-executive/status?status=UNDER_REVIEW" replace /> },
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
    element: <ProtectedRoute roles={[ROLES.SUPER_ADMIN]} loginPath="/super-admin" />,
    children: [
      {
        element: <DashboardLayout />,
        children: [
          { path: "dashboard", element: <Navigate to="/admin/leads" replace /> },
          { path: "dealerships", element: <SuperAdminDashboard mode="dealerships" /> },
          { path: "dealerships/:id", element: <SuperAdminDealershipDetailPage /> },
          { path: "banks", element: <SuperAdminDashboard mode="banks" /> },
          { path: "status", element: <SuperAdminDashboard mode="status" /> },
          { path: "leads", element: <SuperAdminDashboard mode="leads" /> },
          { path: "leads/:leadId", element: <SuperAdminLeadDetailPage /> },
          { path: "approvals/dealerships", element: <SuperAdminDashboard mode="approval-dealerships" /> },
          { path: "approvals/dealerships/:id", element: <SuperAdminApprovalDetailPage type="dealerships" /> },
          { path: "approvals/banks", element: <SuperAdminDashboard mode="approval-banks" /> },
          { path: "approvals/banks/:id", element: <SuperAdminApprovalDetailPage type="banks" /> },
          { path: "finance-desks", element: <Navigate to="/admin/dealerships" replace /> },
          { path: "gm-sm", element: <Navigate to="/admin/dealerships" replace /> },
          { path: "branches", element: <Navigate to="/admin/banks" replace /> },
          { path: "executives", element: <Navigate to="/admin/banks" replace /> },
          { path: "sla", element: <Navigate to="/admin/status" replace /> },
          { path: "approvals/approved", element: <Navigate to="/admin/dealerships" replace /> },
          { path: "approvals/rejected", element: <Navigate to="/admin/status?status=rejected" replace /> },
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
  { path: "/bank/*", element: <Navigate to="/bank-login" replace /> },
  { path: "/app/*", element: <Navigate to="/dealer-login" replace /> },
]);
