import { Router } from "express";
import { login, recordLoginFailure, restoreSession } from "../controllers/authLogin.controller.js";
import { forceLogoutUser, getLoginActivity, logout, refreshSession, session } from "../controllers/authSession.controller.js";
import { completeForcedPasswordChange, validatePasswordReset } from "../controllers/authPassword.controller.js";
import { lookupAccountForLogin } from "../controllers/authLookup.controller.js";
import { approvePendingGoogleAccount, rejectPendingGoogleAccount } from "../controllers/authGoogleApproval.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { authLookupRateLimit, authRateLimit, loginFailureRateLimit, passwordResetEmailRateLimit, passwordResetRateLimit } from "../middleware/securityMiddleware.js";
import { ROLES } from "../utils/constants.js";

const router = Router();

router.post("/login", authRateLimit, login);
router.post("/session/restore", authRateLimit, restoreSession);
router.post("/session/refresh", authenticate, refreshSession);
router.post("/account-lookup", authLookupRateLimit, lookupAccountForLogin);
router.post("/login-failure", loginFailureRateLimit, recordLoginFailure);
router.post("/password-reset/validate", passwordResetRateLimit, passwordResetEmailRateLimit, validatePasswordReset);
router.get("/session", authenticate, session);
router.post("/password/change-complete", authenticate, completeForcedPasswordChange);
router.get("/login-activity", authenticate, getLoginActivity);
router.post("/sessions/force-logout", authenticate, forceLogoutUser);
router.post("/logout", authenticate, logout);
router.post("/google-accounts/:id/approve", authenticate, requireRole(ROLES.SUPER_ADMIN), approvePendingGoogleAccount);
router.post("/google-accounts/:id/reject", authenticate, requireRole(ROLES.SUPER_ADMIN), rejectPendingGoogleAccount);

export default router;
