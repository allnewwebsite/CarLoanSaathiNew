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
export async function validatePasswordReset(req, res, next) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter a valid email address." });
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });
    let firebaseUser;
    try {
      firebaseUser = await firebaseAdmin.auth().getUserByEmail(email);
    } catch (error) {
      if (error.code === "auth/user-not-found") return res.status(404).json({ message: "No account found with this email address." });
      throw error;
    }
    if (firebaseUser.emailVerified !== true) {
      return res.status(403).json({ message: "Verify your email before resetting password.", code: "EMAIL_NOT_VERIFIED" });
    }
    const account = await resolveCanonicalIdentity({ uid: firebaseUser.uid, email })
      || (await findIdentityCandidates({ uid: firebaseUser.uid, email })).find((item) => item.role);
    if (!account) return res.status(404).json({ message: "No account found with this email address." });
    if (!accountActive(account)) {
      const inactive = inactiveAccountMessage(account);
      return res.status(403).json(inactive);
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}

export async function completeForcedPasswordChange(req, res, next) {
  try {
    const email = String(req.user?.email || "").trim().toLowerCase();
    const uid = String(req.user?.uid || "").trim();
    if (!email) return res.status(401).json({ message: "Invalid session" });
    const account = await resolveCanonicalIdentity({ uid, email });
    if (!account || !["loan-executive", "finance-desk", "gm"].includes(account.role)) return res.status(403).json({ message: "This account cannot complete forced password change" });
    const now = new Date().toISOString();
    const passwordExpiresAt = addDays(new Date(now), PASSWORD_VALID_DAYS).toISOString();
    const lifecyclePatch = {
      firstLoginRequired: false,
      forcePasswordReset: false,
      temporaryPasswordRequired: false,
      temporaryPasswordHash: null,
      temporaryPasswordIssuedAt: null,
      firstLoginCompleted: true,
      passwordChangedAt: now,
      passwordExpiresAt,
      passwordExpired: false,
      passwordDaysRemaining: PASSWORD_VALID_DAYS,
    };
    await upsertCanonicalUser(account.uid || account.id || uid || email, {
      ...account,
      ...lifecyclePatch,
    });
    await updatePasswordLifecycleRecords(email, account.role, lifecyclePatch);
    await writeLoginActivity({ email, role: account.role, status: "password-changed", req });
    const user = {
      ...account,
      uid: account.uid || account.email || email,
      email,
      ...lifecyclePatch,
      sessionId: req.user?.sessionId || null,
    };
    const token = jwt.sign(user, jwtSecret(), { expiresIn: "7d" });
    setAuthCookie(res, token);
    res.json({ ok: true, token, user, redirectTo: ROLE_ROUTES[account.role], firstLoginRequired: false, passwordChangedAt: now, passwordExpiresAt });
  } catch (error) {
    next(error);
  }
}
