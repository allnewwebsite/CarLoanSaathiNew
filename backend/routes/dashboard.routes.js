import { Router } from "express";
import { getFastDashboard, getOverview } from "../controllers/dashboard.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.get(
  "/fast",
  authenticate,
  requireRole(ROLES.SUPER_ADMIN, ROLES.FINANCE_DESK, ROLES.GM_SM, ROLES.BANK_MANAGER, ROLES.LOAN_EXECUTIVE),
  getFastDashboard,
);

router.get(
  "/overview",
  authenticate,
  requireRole(ROLES.SUPER_ADMIN, ROLES.FINANCE_DESK, ROLES.GM_SM, ROLES.BANK_MANAGER, ROLES.LOAN_EXECUTIVE),
  getOverview,
);

export default router;
