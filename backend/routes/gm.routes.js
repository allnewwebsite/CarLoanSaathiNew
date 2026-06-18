import { Router } from "express";
import { getGmLead, getGmLeads, getGmNotifications, getGmSalespersons } from "../controllers/gm.controller.js";
import { getGmDeadCases } from "../controllers/deadCase.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { ROLES } from "../utils/constants.js";
import { requireDashboardSubscription } from "../middleware/subscription.js";

const router = Router();

router.use(authenticate, requireRole(ROLES.GM), requireDashboardSubscription);
router.get("/leads", getGmLeads);
router.get("/dead-cases", getGmDeadCases);
router.get("/salespersons", getGmSalespersons);
router.get("/leads/:id", getGmLead);
router.get("/notifications", getGmNotifications);

export default router;
