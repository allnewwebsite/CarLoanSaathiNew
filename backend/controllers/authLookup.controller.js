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
export async function lookupAccountForLogin(req, res, next) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const requestedLoginPortal = normalizeLoginPortal(req.body.targetPortal || req.body.portal);
    if (!requestedLoginPortal) {
      return res.status(400).json({ code: "INVALID_PORTAL", message: "Select a valid login portal." });
    }
    const portal = normalizePortal(requestedLoginPortal);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter a valid email address." });
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });

    let firebaseUser = null;
    try {
      firebaseUser = await firebaseAdmin.auth().getUserByEmail(email);
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
    }
    const firebaseUid = String(firebaseUser?.uid || "").trim();
    const identityContext = await identityContextFor(email, firebaseUid);
    const portalAccount = await accountForEmail(email, portal, firebaseUid, identityContext);
    const account = portalAccount || await accountForAnyPortal(email, firebaseUid, { identityContext, skipPortals: [portal] });

    if (account?.role) {
      const accountPortal = portalForRole(account.role);
      if (!portalAllowsRole(portal, account.role) || !loginPortalAllowsRole(requestedLoginPortal, account.role)) {
        return res.json({ exists: true, ...wrongLoginPortalPayload(account.role) });
      }
      if (!firebaseUser) {
        return res.json({
          exists: true,
          code: "LOGIN_CREDENTIALS_MISSING",
          role: account.role,
          correctPortal: accountPortal,
          message: "A staff profile exists for this email, but the login credential is missing. Remove and recreate this employee, or ask Super Admin to repair the Firebase Auth account.",
        });
      }
      if (firebaseUser.disabled === true) {
        return res.json({ exists: true, code: "ACCOUNT_DISABLED", message: "Your account has been temporarily disabled. Contact support." });
      }
      if (!accountActive(account)) return res.json({ exists: true, ...inactiveAccountMessage(account) });
      return res.json({ exists: true, code: "ACCOUNT_FOUND", role: account.role, correctPortal: accountPortal });
    }

    if (!firebaseUser) return res.json({ exists: false, code: "NO_ACCOUNT", message: "No account found for this email." });

    if (portal === "dealer") {
      const registration = await dealerRegistrationStatus(email);
      return res.json({
        exists: false,
        code: registration ? "APPROVAL_PENDING" : "NO_ACCOUNT",
        message: registration?.registrationSubmitted === true
          ? "Your dealership account is still pending approval."
          : "Please create your dealership account from Dealer Registration before using Dealer Login.",
        redirectTo: registration ? "/dealer-registration/pending" : "/dealer-registration",
        actionLabel: registration ? "Check Approval Status" : "Go to Dealer Registration",
      });
    }

    if (portal === "bank") {
      const registration = await bankRegistrationStatus(email);
      const gate = bankLoginGate(registration);
      return res.json({
        exists: false,
        code: registration ? "APPROVAL_PENDING" : "NO_ACCOUNT",
        message: gate.message,
        redirectTo: gate.redirectTo,
        actionLabel: gate.actionLabel,
      });
    }

    if (portal === "admin" && email === superAdminEmail()) {
      return res.json({
        exists: false,
        code: "SUPER_ADMIN_PROFILE_MISSING",
        message: "Super Admin authentication exists, but the Firestore profile is missing or inactive. Repair the configured Super Admin account before login.",
      });
    }

    return res.json({ exists: false, code: "NO_ACCOUNT", message: "No active account profile found for this email." });
  } catch (error) {
    next(error);
  }
}
