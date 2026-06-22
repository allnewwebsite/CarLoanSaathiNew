import { Router } from "express";
import { getDealerRegistrationStatus, registerDealerOnboarding, startDealerRegistration } from "../controllers/dealerRegistration.controller.js";
import { createDealerLead, getDealerEarnings, getDealerLead, getDealerLeads } from "../controllers/dealerLead.controller.js";
import { createDealerSalesperson, getDealerSalespersons, removeDealerSalesperson } from "../controllers/dealerSalesperson.controller.js";
import { createDealerFinanceManager, deleteDealerFinanceManager, getDealerFinanceManagers, updateDealerFinanceManager } from "../controllers/dealerFinanceManager.controller.js";
import { createDealerStaff, deleteDealerStaff, getDealerActiveMembers, getDealerStaff, getDealerStaffDetail } from "../controllers/dealerStaff.controller.js";
import { getDealerBankTieUps, updateDealerBankTieUps } from "../controllers/dealerBankTieup.controller.js";
import { getDealerProfile, updateDealerProfile } from "../controllers/dealerProfile.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { registrationSecurity } from "../middleware/registrationSecurity.js";
import { billingRateLimit, registrationRateLimit } from "../middleware/securityMiddleware.js";
import { requireDashboardSubscription, requireLeadCreationSubscription } from "../middleware/subscription.js";
import { ROLES } from "../utils/constants.js";
import {
  createFinanceSubscriptionOrder,
  getFinanceBilling,
  getFinanceBillingHistory,
  verifyFinanceSubscriptionPayment,
} from "../controllers/subscription.controller.js";
import {
  createFinanceDeadCase,
  getFinanceDeadCase,
  getFinanceDeadCases,
  restoreFinanceDeadCase,
  updateFinanceDeadCase,
} from "../controllers/deadCase.controller.js";

const router = Router();

router.post("/register", registrationRateLimit, registrationSecurity, registerDealerOnboarding);
router.post("/register/email-start", registrationRateLimit, registrationSecurity, startDealerRegistration);
router.post("/register/status", registrationRateLimit, registrationSecurity, getDealerRegistrationStatus);
router.use(authenticate, requireRole(ROLES.FINANCE_DESK));
router.get("/billing", getFinanceBilling);
router.get("/billing/history", getFinanceBillingHistory);
router.post("/billing/order", billingRateLimit, createFinanceSubscriptionOrder);
router.post("/billing/verify", billingRateLimit, verifyFinanceSubscriptionPayment);
router.use(requireDashboardSubscription);
router.get("/leads", getDealerLeads);
router.get("/dead-cases", getFinanceDeadCases);
router.post("/dead-cases", createFinanceDeadCase);
router.get("/dead-cases/:id", getFinanceDeadCase);
router.post("/dead-cases/:id/restore", restoreFinanceDeadCase);
router.patch("/dead-cases/:id", updateFinanceDeadCase);
router.get("/leads/:id", getDealerLead);
router.post("/leads", requireLeadCreationSubscription, createDealerLead);
router.get("/salespersons", getDealerSalespersons);
router.post("/salespersons", createDealerSalesperson);
router.delete("/salespersons/:id", removeDealerSalesperson);
router.get("/finance-managers", getDealerFinanceManagers);
router.post("/finance-managers", createDealerFinanceManager);
router.patch("/finance-managers/:id", updateDealerFinanceManager);
router.delete("/finance-managers/:id", deleteDealerFinanceManager);
router.get("/active-members", getDealerActiveMembers);
router.get("/staff", getDealerStaff);
router.post("/staff", createDealerStaff);
router.get("/staff/:id", getDealerStaffDetail);
router.delete("/staff/:id", deleteDealerStaff);
router.get("/earnings", getDealerEarnings);
router.get("/profile", getDealerProfile);
router.get("/bank-tieups", getDealerBankTieUps);
router.patch("/bank-tieups", updateDealerBankTieUps);
router.patch("/profile", updateDealerProfile);

export default router;
