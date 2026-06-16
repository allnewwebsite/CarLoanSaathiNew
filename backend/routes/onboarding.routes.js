import { Router } from "express";
import { completeOnboarding, getOnboardingStatus, resetOnboarding } from "../controllers/onboarding.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.get("/status", authenticate, getOnboardingStatus);
router.post("/complete", authenticate, completeOnboarding);
router.post("/reset", authenticate, requireRole(ROLES.SUPER_ADMIN), resetOnboarding);

export default router;
