import { Router } from "express";
import { createDealerLead, createDealerSalesperson, createDealerStaff, deleteDealerStaff, getDealerBankTieUps, getDealerEarnings, getDealerLead, getDealerLeads, getDealerProfile, getDealerRegistrationStatus, getDealerSalespersons, getDealerStaff, getDealerStaffDetail, registerDealerOnboarding, removeDealerSalesperson, startDealerRegistration, updateDealerBankTieUps, updateDealerProfile } from "../controllers/dealer.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { registrationSecurity } from "../middleware/registrationSecurity.js";
import { registrationRateLimit } from "../middleware/securityMiddleware.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.post("/register", registrationRateLimit, registrationSecurity, registerDealerOnboarding);
router.post("/register/email-start", registrationRateLimit, registrationSecurity, startDealerRegistration);
router.post("/register/status", registrationRateLimit, registrationSecurity, getDealerRegistrationStatus);
router.use(authenticate, requireRole(ROLES.FINANCE_DESK));
router.get("/leads", getDealerLeads);
router.get("/leads/:id", getDealerLead);
router.post("/leads", createDealerLead);
router.get("/salespersons", getDealerSalespersons);
router.post("/salespersons", createDealerSalesperson);
router.delete("/salespersons/:id", removeDealerSalesperson);
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
