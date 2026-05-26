import { Router } from "express";
import { createLead, createPublicLead, getLeads, updateLeadStatus } from "../controllers/lead.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.post("/create", authenticate, requireRole(ROLES.FINANCE_DESK), createPublicLead);
router.use(authenticate);
router.get("/", getLeads);
router.post("/", requireRole(ROLES.FINANCE_DESK), createLead);
router.patch("/:id/status", requireRole(ROLES.LOAN_EXECUTIVE), updateLeadStatus);

export default router;
