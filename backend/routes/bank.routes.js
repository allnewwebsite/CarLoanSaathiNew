import { Router } from "express";
import {
  acceptBankLead,
  deleteBankLeadDocument,
  getBankRegistrationStatus,
  getBankAnalytics,
  getBankLead,
  getBankExecutiveCases,
  getBankExecutives,
  getBankLeads,
  getBankLeadTimeline,
  getBankNotifications,
  registerBankPartner,
  createBankExecutive,
  removeBankExecutive,
  rejectBankLead,
  reassignBankLead,
  startBankRegistration,
  updateBankLeadRemarks,
  updateBankLeadStatus,
  uploadBankLeadDocument,
} from "../controllers/bank.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { registrationSecurity } from "../middleware/registrationSecurity.js";
import { registrationRateLimit, uploadRateLimit } from "../middleware/securityMiddleware.js";
import { upload } from "../middleware/upload.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.post("/register", registrationRateLimit, registrationSecurity, registerBankPartner);
router.post("/register/email-start", registrationRateLimit, registrationSecurity, startBankRegistration);
router.post("/register/status", registrationRateLimit, registrationSecurity, getBankRegistrationStatus);
router.use(authenticate, requireRole(ROLES.BANK_MANAGER, ROLES.LOAN_EXECUTIVE));
router.get("/leads", getBankLeads);
router.get("/executives", requireRole(ROLES.BANK_MANAGER), getBankExecutives);
router.post("/executives", requireRole(ROLES.BANK_MANAGER), createBankExecutive);
router.delete("/executives/:executiveId", requireRole(ROLES.BANK_MANAGER), removeBankExecutive);
router.get("/executives/:executiveId/cases", requireRole(ROLES.BANK_MANAGER), getBankExecutiveCases);
router.get("/analytics", getBankAnalytics);
router.get("/notifications", getBankNotifications);
router.get("/leads/:id", getBankLead);
router.patch("/leads/:id/accept", requireRole(ROLES.LOAN_EXECUTIVE), acceptBankLead);
router.patch("/leads/:id/reject", requireRole(ROLES.LOAN_EXECUTIVE), rejectBankLead);
router.patch("/leads/:id/reassign", reassignBankLead);
router.patch("/leads/:id/status", requireRole(ROLES.LOAN_EXECUTIVE), updateBankLeadStatus);
router.patch("/leads/:id/remarks", updateBankLeadRemarks);
router.post("/leads/:id/documents", uploadRateLimit, upload.single("document"), uploadBankLeadDocument);
router.delete("/leads/:id/documents/:documentId", deleteBankLeadDocument);
router.get("/leads/:id/timeline", getBankLeadTimeline);

export default router;
