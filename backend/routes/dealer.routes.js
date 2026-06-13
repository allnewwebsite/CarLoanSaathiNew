import { Router } from "express";
import { createDealerFinanceManager, createDealerLead, createDealerSalesperson, createDealerStaff, deleteDealerFinanceManager, deleteDealerStaff, getDealerBankTieUps, getDealerEarnings, getDealerFinanceManagers, getDealerLead, getDealerLeads, getDealerProfile, getDealerRegistrationStatus, getDealerSalespersons, getDealerStaff, getDealerStaffDetail, registerDealerOnboarding, removeDealerSalesperson, startDealerRegistration, updateDealerBankTieUps, updateDealerFinanceManager, updateDealerProfile } from "../controllers/dealer.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { registrationSecurity } from "../middleware/registrationSecurity.js";
import { billingRateLimit, registrationRateLimit } from "../middleware/securityMiddleware.js";
import { requireLeadCreationSubscription } from "../middleware/subscription.js";
import { ROLES } from "../utils/constants.js";
import {
  createFinanceSubscriptionOrder,
  getFinanceBilling,
  getFinanceBillingHistory,
  verifyFinanceSubscriptionPayment,
} from "../controllers/subscription.controller.js";

const router = Router();

router.post("/register", registrationRateLimit, registrationSecurity, registerDealerOnboarding);
router.post("/register/email-start", registrationRateLimit, registrationSecurity, startDealerRegistration);
router.post("/register/status", registrationRateLimit, registrationSecurity, getDealerRegistrationStatus);
router.use(authenticate, requireRole(ROLES.FINANCE_DESK));
router.get("/leads", getDealerLeads);
router.get("/leads/:id", getDealerLead);
router.post("/leads", requireLeadCreationSubscription, createDealerLead);
router.get("/salespersons", getDealerSalespersons);
router.post("/salespersons", createDealerSalesperson);
router.delete("/salespersons/:id", removeDealerSalesperson);
router.get("/finance-managers", getDealerFinanceManagers);
router.post("/finance-managers", createDealerFinanceManager);
router.patch("/finance-managers/:id", updateDealerFinanceManager);
router.delete("/finance-managers/:id", deleteDealerFinanceManager);
router.get("/staff", getDealerStaff);
router.post("/staff", createDealerStaff);
router.get("/staff/:id", getDealerStaffDetail);
router.delete("/staff/:id", deleteDealerStaff);
router.get("/earnings", getDealerEarnings);
router.get("/profile", getDealerProfile);
router.get("/billing", getFinanceBilling);
router.get("/billing/history", getFinanceBillingHistory);
router.post("/billing/order", billingRateLimit, createFinanceSubscriptionOrder);
router.post("/billing/verify", billingRateLimit, verifyFinanceSubscriptionPayment);
router.get("/bank-tieups", getDealerBankTieUps);
router.patch("/bank-tieups", updateDealerBankTieUps);
router.patch("/profile", updateDealerProfile);

export default router;
