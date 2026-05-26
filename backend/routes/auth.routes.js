import { Router } from "express";
import { approvePendingGoogleAccount, login, logout, recordLoginFailure, rejectPendingGoogleAccount, session, validatePasswordReset } from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { authRateLimit, passwordResetRateLimit } from "../middleware/securityMiddleware.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.post("/login", authRateLimit, login);
router.post("/login-failure", authRateLimit, recordLoginFailure);
router.post("/password-reset/validate", passwordResetRateLimit, validatePasswordReset);
router.get("/session", authenticate, session);
router.post("/logout", authenticate, logout);
router.post("/google-accounts/:id/approve", authenticate, requireRole(ROLES.SUPER_ADMIN), approvePendingGoogleAccount);
router.post("/google-accounts/:id/reject", authenticate, requireRole(ROLES.SUPER_ADMIN), rejectPendingGoogleAccount);

export default router;
