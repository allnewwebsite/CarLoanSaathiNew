import { Router } from "express";
import {
  assignAdminLead,
  approveBankApproval,
  approveDealershipApproval,
  deleteBankPermanently,
  deleteDealershipPermanently,
  freezeAdminPartner,
  getApprovalLogs,
  getAdminAnalytics,
  getAdminAuditLogs,
  getAdminEcosystem,
  getAdminLeads,
  getAdminOnboardingRequests,
  getAdminPartners,
  getAdminWorkflowLogs,
  getAdminWorkflowSettings,
  getPendingBankApprovals,
  getPendingDealershipApprovals,
  processAdminSlaBreaches,
  reassignAdminLead,
  rejectBankApproval,
  rejectDealershipApproval,
  suspendBankApproval,
  suspendDealershipApproval,
  updateAdminOnboardingRequest,
  updateAdminLeadStatus,
  updateAdminWorkflowSettings,
} from "../controllers/admin.controller.js";
import {
  getAnalyticsBanks,
  getAnalyticsCities,
  getAnalyticsDealers,
  getAnalyticsDisbursals,
  getAnalyticsMonthly,
  getAnalyticsOverview,
  getAnalyticsSla,
} from "../controllers/analytics.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.use(authenticate, requireRole(ROLES.SUPER_ADMIN));
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
router.patch("/leads/:id/status", updateAdminLeadStatus);
router.patch("/leads/:id/assign", assignAdminLead);
router.patch("/leads/:id/reassign", reassignAdminLead);
router.get("/analytics", getAdminAnalytics);
router.get("/ecosystem", getAdminEcosystem);
router.get("/analytics/overview", getAnalyticsOverview);
router.get("/analytics/monthly", getAnalyticsMonthly);
router.get("/analytics/cities", getAnalyticsCities);
router.get("/analytics/dealers", getAnalyticsDealers);
router.get("/analytics/banks", getAnalyticsBanks);
router.get("/analytics/sla", getAnalyticsSla);
router.get("/analytics/disbursals", getAnalyticsDisbursals);
router.get("/audit-logs", getAdminAuditLogs);
router.get("/partners", getAdminPartners);
router.get("/workflow/settings", getAdminWorkflowSettings);
router.get("/workflow/logs", getAdminWorkflowLogs);
router.patch("/workflow/settings", updateAdminWorkflowSettings);
router.post("/workflow/process-sla", processAdminSlaBreaches);
router.patch("/partners/:partnerId/freeze", freezeAdminPartner);

export default router;
