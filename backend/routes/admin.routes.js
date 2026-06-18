import { Router } from "express";
import {
  approveBankApproval,
  approveDealershipApproval,
  getApprovalLogs,
  getPendingBankApprovals,
  getPendingDealershipApprovals,
  rejectBankApproval,
  rejectDealershipApproval,
  suspendBankApproval,
  suspendDealershipApproval,
} from "../controllers/adminApprovals.controller.js";
import { getAdminLead, getAdminLeads, updateAdminLeadStatus } from "../controllers/adminLead.controller.js";
import { deleteDealershipPermanently } from "../controllers/adminDealer.controller.js";
import { deleteBankPermanently } from "../controllers/adminBank.controller.js";
import { freezeAdminPartner, getAdminOnboardingRequests, getAdminPartners, getAdminWorkflowLogs, getAdminWorkflowSettings, updateAdminOnboardingRequest, updateAdminWorkflowSettings } from "../controllers/adminWorkflow.controller.js";
import { getAdminAuditLogs } from "../controllers/adminAudit.controller.js";
import { getAdminAnalytics, getAdminEcosystem } from "../controllers/adminEcosystem.controller.js";
import {
  registerBankBranchAdmin,
  approveBankBranchAdmin,
  rejectBankBranchAdmin,
  deactivateBankBranchAdmin,
  getAdminBankBranches,
  getBankBranchDetailsAdmin,
  updateBankBranchAdmin,
} from "../controllers/bank.admin.controller.js";
import {
  getAnalyticsBanks,
  getAnalyticsCities,
  getAnalyticsDealers,
  getAnalyticsDisbursals,
  getAnalyticsMonthly,
  getAnalyticsOverview,
} from "../controllers/analytics.controller.js";
import { testWhatsApp } from "../controllers/whatsapp.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { ROLES } from "../utils/constants.js";
import {
  activateAdminTrial,
  extendAdminSubscription,
  getAdminSubscription,
  suspendAdminSubscription,
} from "../controllers/subscription.controller.js";
import { getAdminDeadCase, getAdminDeadCases } from "../controllers/deadCase.controller.js";

const router = Router();

async function getAdminMonitoringCenterLazy(req, res, next) {
  try {
    const { getAdminMonitoringCenter } = await import("../controllers/monitoring.controller.js");
    return getAdminMonitoringCenter(req, res, next);
  } catch (error) {
    return next(error);
  }
}

router.use(authenticate, requireRole(ROLES.SUPER_ADMIN));

// Existing routes
router.get("/onboarding-requests", getAdminOnboardingRequests);
router.patch("/onboarding-requests/:id", updateAdminOnboardingRequest);
router.delete("/dealerships/:id/permanent", deleteDealershipPermanently);
router.delete("/banks/:id/permanent", deleteBankPermanently);
router.get("/approvals/dealerships", getPendingDealershipApprovals);
router.post("/approvals/dealerships/:id/approve", approveDealershipApproval);
router.post("/approvals/dealerships/:id/reject", rejectDealershipApproval);
router.post("/approvals/dealerships/:id/suspend", suspendDealershipApproval);
router.get("/approvals/banks", getPendingBankApprovals);
router.post("/approvals/banks/:id/approve", approveBankApproval);
router.post("/approvals/banks/:id/reject", rejectBankApproval);
router.post("/approvals/banks/:id/suspend", suspendBankApproval);
router.get("/approvals/logs", getApprovalLogs);
router.get("/leads", getAdminLeads);
router.get("/dead-cases", getAdminDeadCases);
router.get("/dead-cases/:id", getAdminDeadCase);
router.get("/leads/:id", getAdminLead);
router.patch("/leads/:id/status", updateAdminLeadStatus);
router.get("/analytics", getAdminAnalytics);
router.get("/ecosystem", getAdminEcosystem);
router.get("/monitoring", getAdminMonitoringCenterLazy);
router.post("/test-whatsapp", testWhatsApp);
router.get("/analytics/overview", getAnalyticsOverview);
router.get("/analytics/monthly", getAnalyticsMonthly);
router.get("/analytics/cities", getAnalyticsCities);
router.get("/analytics/dealers", getAnalyticsDealers);
router.get("/analytics/banks", getAnalyticsBanks);
router.get("/analytics/disbursals", getAnalyticsDisbursals);
router.get("/audit-logs", getAdminAuditLogs);
router.get("/partners", getAdminPartners);
router.get("/workflow/settings", getAdminWorkflowSettings);
router.get("/workflow/logs", getAdminWorkflowLogs);
router.patch("/workflow/settings", updateAdminWorkflowSettings);
router.patch("/partners/:partnerId/freeze", freezeAdminPartner);
router.get("/subscriptions/:dealershipId", getAdminSubscription);
router.post("/subscriptions/:dealershipId/extend", extendAdminSubscription);
router.post("/subscriptions/:dealershipId/trial", activateAdminTrial);
router.post("/subscriptions/:dealershipId/suspend", suspendAdminSubscription);

// NEW: Bank branch management (dynamic IFSC system)
router.post("/bank-branches", registerBankBranchAdmin);
router.get("/bank-branches", getAdminBankBranches);
router.get("/bank-branches/:bankId", getBankBranchDetailsAdmin);
router.patch("/bank-branches/:bankId", updateBankBranchAdmin);
router.post("/bank-branches/:bankId/approve", approveBankBranchAdmin);
router.post("/bank-branches/:bankId/reject", rejectBankBranchAdmin);
router.post("/bank-branches/:bankId/deactivate", deactivateBankBranchAdmin);

export default router;
