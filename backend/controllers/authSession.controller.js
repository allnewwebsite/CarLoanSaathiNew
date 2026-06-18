import {
  accountActive,
  accountForAnyPortal,
  accountForEmail,
  accountLocked,
  accountLockedPayload,
  accountWithUserLifecycle,
  activeIdentity,
  addDays,
  approvedDealerAccess,
  assertNoActiveIdentityCollision,
  AUTH_SHARED_SENTINEL,
  bankLoginGate,
  bankRegistrationStatus,
  browserFromAgent,
  canonicalFromContext,
  clearAuthCookie,
  clearFailedLogin,
  clearFailedLoginForAccount,
  clearIdentityCaches,
  clearTransientLoginLock,
  createPendingGoogleAccount,
  createRecord,
  createUserSession,
  dealerRegistrationStatus,
  dealershipEntitlement,
  deviceFromAgent,
  effectiveLockedUntil,
  emailMatchesRecord,
  enforceConcurrentSessionLimit,
  entitlementRedirect,
  firebaseAdmin,
  firebaseAuthReferers,
  firebaseClaimsMatch,
  firebasePasswordErrorPayload,
  findIdentityCandidates,
  findRecordsByField,
  firstLoginRequiredFor,
  firstLookup,
  getRecord,
  identityContextFor,
  inactiveAccountMessage,
  incrementFailedLogin,
  isFirebaseRefererBlocked,
  jwt,
  jwtSecret,
  lifecycleOverlay,
  LOGIN_PORTAL_ROLES,
  loginPortalAllowsRole,
  loginPortalForRole,
  logError,
  logInfo,
  logWarn,
  normalizeLoginPortal,
  normalizePortal,
  onboardingStatusForUser,
  organizationIdForAccount,
  passwordChangeRouteForRole,
  passwordLifecyclePatch,
  persistPasswordLifecycleIfMissing,
  portalAllowsRole,
  portalForRole,
  queryRecords,
  registrationProfile,
  resolveCanonicalIdentity,
  roleGuidance,
  scheduleLoginMaintenance,
  sessionUserFromAuthenticatedRequest,
  setAuthCookie,
  setFirebaseClaims,
  signInWithFirebasePassword,
  signInWithTemporaryPasswordFallback,
  superAdminEmail,
  uidMatchesRecord,
  uniqueAuthRecords,
  updatePasswordLifecycleRecords,
  updateRecord,
  upsertCanonicalUser,
  upsertRecord,
  verifyTemporaryPassword,
  writeAuditLog,
  writeLoginActivity,
  wrongLoginPortalPayload,
  wrongPortalPayload,
} from './authShared.controller.js';

void AUTH_SHARED_SENTINEL;
export async function refreshSession(req, res, next) {
  try {
    const email = String(req.user?.email || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ message: "Invalid session", code: "INVALID_SESSION" });
    const account = req.authAccount || req.user || {};
    const role = account.role || req.user?.role;
    if (!role || !ROLE_ROUTES[role]) {
      return res.status(403).json({ message: "Account no longer exists", code: "ACCOUNT_DELETED" });
    }
    const user = {
      ...sessionUserFromAuthenticatedRequest(req, account),
      portal: portalForRole(role),
      scope: portalForRole(role),
      loginPortal: loginPortalForRole(role),
      organizationId: organizationIdForAccount(account),
      sessionId: req.user.sessionId || null,
    };
    const token = jwt.sign(user, jwtSecret(), { expiresIn: "7d" });
    setAuthCookie(res, token);
    const forcedPasswordPath = passwordChangeRouteForRole(role);
    res.json({
      token,
      user,
      redirectTo: user.firstLoginRequired === true || user.passwordExpired === true
        ? forcedPasswordPath
        : entitlementRedirect(user, ROLE_ROUTES[role]),
    });
  } catch (error) {
    next(error);
  }
}

export async function session(req, res, next) {
  try {
    const email = String(req.user?.email || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ message: "Invalid session" });
    res.json({ user: sessionUserFromAuthenticatedRequest(req) });
  } catch (error) {
    next(error);
  }
}

export async function logout(req, res, next) {
  try {
    await writeLoginActivity({ email: req.user?.email || req.user?.uid, role: req.user?.role, status: "logout", req });
    if (req.user?.sessionId) {
      await updateRecord("userSessions", req.user.sessionId, {
        revoked: true,
        revokedAt: new Date().toISOString(),
        revokedReason: "user-logout",
      }).catch(() => null);
      clearIdentityCaches({ email: req.user?.email || req.user?.uid, uid: req.user?.uid, sessionId: req.user.sessionId });
    }
    clearAuthCookie(res);
    res.json({ message: "Logged out" });
  } catch (error) {
    next(error);
  }
}

export async function getLoginActivity(req, res, next) {
  try {
    const email = String(req.query.email || req.user?.email || req.user?.uid || "").trim().toLowerCase();
    const role = req.user?.role;
    const canViewRequested = req.user?.role === "super-admin"
      || String(req.user?.email || "").toLowerCase() === email;
    if (!canViewRequested) return res.status(403).json({ message: "Access denied" });
    const [activitiesPage, sessionsPage] = await Promise.all([
      queryRecords("loginActivity", { where: [{ field: "email", value: email }], orderBy: "createdAt", direction: "desc", limit: 100, maxLimit: 100 }),
      queryRecords("userSessions", { where: [{ field: "email", value: email }], orderBy: "loginAt", direction: "desc", limit: 50, maxLimit: 50 }),
    ]);
    const activities = activitiesPage.data;
    const sessions = sessionsPage.data;
    res.json({ role, activities, sessions });
  } catch (error) {
    next(error);
  }
}

export async function forceLogoutUser(req, res, next) {
  try {
    if (req.user?.role !== "super-admin") return res.status(403).json({ message: "Only Super Admin can force logout users from this endpoint" });
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Email is required" });
    await revokeUserSessions(email, "admin-force-logout");
    await writeAuditLog({ req, actionType: "FORCE_LOGOUT", targetEntity: "user", targetId: email, meta: { email } });
    res.json({ message: "Employee sessions revoked" });
  } catch (error) {
    next(error);
  }
}

export { revokeUserSessions } from "./authShared.controller.js";
