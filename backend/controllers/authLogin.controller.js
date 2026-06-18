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
  logError,
  logInfo,
  logWarn,
  normalizeLoginPortal,
  normalizePortal,
  passwordChangeRouteForRole,
  passwordLifecyclePatch,
  persistPasswordLifecycleIfMissing,
  portalAllowsRole,
  queryRecords,
  resolveCanonicalIdentity,
  roleGuidance,
  ROLE_ROUTES,
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
import { buildSessionUserFromAccount } from "./authLoginSession.controller.js";

void AUTH_SHARED_SENTINEL;
export async function login(req, res, next) {
  const loginStartedAt = Date.now();
  const timings = {};
  let authPhase = "start";
  let normalizedEmail = "";
  let passwordFallbackDecoded = null;
  try {
    let { idToken } = req.body;
    const requestedLoginPortal = normalizeLoginPortal(req.body.targetPortal || req.body.portal);
    if (!requestedLoginPortal) {
      return res.status(400).json({ code: "INVALID_PORTAL", message: "Select a valid login portal." });
    }
    const portal = normalizePortal(requestedLoginPortal);
    authPhase = "validate-request";
    if (!idToken) {
      normalizedEmail = String(req.body.email || "").trim().toLowerCase();
      const password = String(req.body.password || "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || !password) {
        return res.status(400).json({ message: "Email and password are required" });
      }
      try {
        const startedAt = Date.now();
        idToken = await signInWithFirebasePassword(normalizedEmail, password);
        timings.firebasePasswordMs = Date.now() - startedAt;
      } catch (error) {
        const fallbackStartedAt = Date.now();
        passwordFallbackDecoded = await signInWithTemporaryPasswordFallback(normalizedEmail, password).catch((fallbackError) => {
          if (fallbackError.code === "IDENTITY_COLLISION") throw fallbackError;
          logWarn("Temporary password fallback failed", {
            requestId: req.requestId,
            message: fallbackError.message,
          });
          return null;
        });
        timings.temporaryPasswordFallbackMs = Date.now() - fallbackStartedAt;
        if (passwordFallbackDecoded) {
          logWarn("Firebase password sign-in failed; accepted temporary password fallback", {
            requestId: req.requestId,
            code: error.code || "firebase-auth-failed",
          });
        } else
        if (error.status === 401) {
          const result = await incrementFailedLogin(normalizedEmail, req, error.code || "firebase-auth-failed");
          if (result.locked) return res.status(423).json(accountLockedPayload({ lockedUntil: result.lockedUntil }));
        } else {
          logWarn("Firebase password sign-in failed", {
            requestId: req.requestId,
            code: error.code || "firebase-auth-failed",
            firebaseCode: error.firebaseCode || "",
            firebaseReferer: error.firebaseReferer || "",
          });
          await writeLoginActivity({ email: normalizedEmail, status: "denied", reason: error.code || "firebase-auth-failed", req });
        }
        if (!passwordFallbackDecoded) {
          return res.status(error.status || 500).json({ code: error.code, message: error.message });
        }
      }
    }
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });
    authPhase = "verify-firebase-token";
    const verifyStartedAt = Date.now();
    const decoded = passwordFallbackDecoded || await firebaseAdmin.auth().verifyIdToken(idToken);
    timings.firebaseVerifyMs = Date.now() - verifyStartedAt;
    normalizedEmail = String(decoded.email || "").trim().toLowerCase();
    const firebaseUid = String(decoded.uid || "").trim();
    logInfo("Auth login token verified", { requestId: req.requestId, portal });
    authPhase = "validate-firebase-email";
    if (!normalizedEmail) return res.status(400).json({ message: "Account email is required" });
    if (decoded.email_verified !== true) {
      await writeLoginActivity({ email: normalizedEmail, status: "denied", reason: "email-not-verified", req });
      return res.status(403).json({ message: "Please verify your email address before logging in.", code: "EMAIL_NOT_VERIFIED" });
    }
    authPhase = "resolve-account";
    const identityStartedAt = Date.now();
    const identityContext = await identityContextFor(normalizedEmail, firebaseUid);
    let account = await accountForEmail(normalizedEmail, portal, firebaseUid, identityContext);
    const resetFailedLogin = Boolean(account?.lockedUntil || account?.failedLoginAttempts || account?.accountStatus === "locked");
    account = await clearTransientLoginLock(normalizedEmail, account);
    timings.identityMs = Date.now() - identityStartedAt;
    if (account?.role && !loginPortalAllowsRole(requestedLoginPortal, account.role)) {
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: "wrong-login-portal", req });
      return res.status(403).json(wrongLoginPortalPayload(account.role));
    }
    if (!account || !ROLE_ROUTES[account.role]) {
      authPhase = "resolve-known-account";
      const knownAccount = await accountForAnyPortal(normalizedEmail, firebaseUid, { identityContext, skipPortals: [portal] });
      if (knownAccount?.role && (!portalAllowsRole(portal, knownAccount.role) || !loginPortalAllowsRole(requestedLoginPortal, knownAccount.role))) {
        await writeLoginActivity({ email: normalizedEmail, role: knownAccount.role, status: "denied", reason: "wrong-portal", req });
        return res.status(403).json(wrongLoginPortalPayload(knownAccount.role));
      }
      if (knownAccount?.role && portalAllowsRole(portal, knownAccount.role) && !accountActive(knownAccount)) {
        const inactive = inactiveAccountMessage(knownAccount);
        await writeLoginActivity({ email: normalizedEmail, role: knownAccount.role, status: "denied", reason: inactive.code.toLowerCase(), req });
        return res.status(inactive.code === "ACCOUNT_LOCKED" ? 423 : 403).json(inactive);
      }
      if (portal === "dealer") {
        authPhase = "dealer-registration-status";
        const registration = await dealerRegistrationStatus(normalizedEmail);
        await writeLoginActivity({ email: normalizedEmail, status: "denied", reason: registration ? "dealer-approval-pending" : "dealer-registration-required", req });
        return res.status(403).json({
          message: registration?.registrationSubmitted === true
            ? "Your dealership account is still pending approval."
            : "Please create your dealership account from Dealer Registration before using Dealer Login.",
          redirectTo: registration ? "/dealer-registration/pending" : "/dealer-registration",
          actionLabel: registration ? "Check Approval Status" : "Go to Dealer Registration",
        });
      }
      if (portal === "finance") {
        await writeLoginActivity({ email: normalizedEmail, status: "denied", reason: "finance-staff-not-found", req });
        return res.status(403).json({
          code: "NO_ACCOUNT",
          message: "No active Finance Head or GM account found for this email.",
        });
      }
      if (portal === "bank") {
        authPhase = "bank-registration-status";
        const registration = await bankRegistrationStatus(normalizedEmail);
        const gate = bankLoginGate(registration);
        await writeLoginActivity({ email: normalizedEmail, status: "denied", reason: gate.reason, req });
        return res.status(403).json({
          message: gate.message,
          redirectTo: gate.redirectTo,
          actionLabel: gate.actionLabel,
        });
      }
      await createPendingGoogleAccount({ decoded, portal, reason: "not-approved" });
      await writeLoginActivity({ email: normalizedEmail, status: "denied", reason: "not-approved", req });
      return res.status(403).json({ message: "Your account is awaiting CarLoanSaathi administrator approval." });
    }
    if (["dealer", "finance"].includes(portal) && account?.role && !accountActive(account) && await approvedDealerAccess(normalizedEmail, account)) {
      const repairedAccount = {
        ...account,
        active: true,
        approved: true,
        accountApproved: true,
        accountActive: true,
        accountStatus: "active",
        status: "active",
      };
      await upsertCanonicalUser(account.uid || account.id || firebaseUid || normalizedEmail, repairedAccount).catch(() => null);
      account = repairedAccount;
    }
    if (!accountActive(account)) {
      authPhase = "account-active-check";
      const inactive = inactiveAccountMessage(account);
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: "inactive", req });
      return res.status(inactive.code === "ACCOUNT_LOCKED" ? 423 : 403).json(inactive);
    }
    logInfo("Auth account resolved", {
      requestId: req.requestId,
      portal,
      resolvedRole: account.role,
      accountSource: account.accountSource || "unknown",
      redirectTo: ROLE_ROUTES[account.role],
    });
    if (["dealer", "finance"].includes(portal) && !account.dealershipId && account.role !== "super-admin") {
      logWarn("Auth login denied: missing dealership id", { requestId: req.requestId, role: account.role, portal });
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: "dealership-id-missing", req });
      return res.status(403).json({ message: "Your dealership account is pending Super Admin approval." });
    }
    if (portal === "bank" && !account.bankId) {
      logWarn("Auth login denied: missing bank id", { requestId: req.requestId, role: account.role, portal });
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: "bank-id-missing", req });
      return res.status(403).json({ message: "Your bank account is pending Super Admin approval." });
    }
    if (["dealer", "finance"].includes(portal) && !(await approvedDealerAccess(normalizedEmail, account))) {
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: "dealer-approval-pending", req });
      return res.status(403).json({
        title: "Dealer Registration Required",
        message: "Please create your dealership account from Dealer Registration before using Dealer Login.",
        redirectTo: "/dealer-registration",
        actionLabel: "Create Dealer Account",
      });
    }
    if (account.role === "super-admin" && normalizedEmail !== superAdminEmail()) {
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: "super-admin-restricted", req });
      return res.status(403).json({ message: "ACCESS DENIED" });
    }
    if (portal === "admin" && account.role !== "super-admin") {
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: "admin-role-required", req });
      return res.status(403).json({ message: "ACCESS DENIED" });
    }
    authPhase = "password-lifecycle";
    const lifecycle = passwordLifecyclePatch(account);
    authPhase = "persist-user-session";
    const user = await buildSessionUserFromAccount({
      account,
      email: normalizedEmail,
      firebaseUid,
      portal,
      lifecycle,
      accountApproved: ["dealer", "finance", "bank"].includes(portal) ? true : account.accountApproved === true,
      includeAccountSource: true,
    });
    authPhase = "create-user-session";
    const sessionStartedAt = Date.now();
    const sessionId = await createUserSession({ req, user });
    timings.sessionWriteMs = Date.now() - sessionStartedAt;
    user.sessionId = sessionId;
    authPhase = "sign-jwt";
    const token = jwt.sign(user, jwtSecret(), { expiresIn: "7d" });
    setAuthCookie(res, token);
    const forcedPasswordPath = passwordChangeRouteForRole(user.role);
    const redirectTo = user.firstLoginRequired === true || user.passwordExpired === true
      ? forcedPasswordPath
      : entitlementRedirect(user, ROLE_ROUTES[user.role]);
    logInfo("Auth login success", {
      requestId: req.requestId,
      jwtRole: user.role,
      accountSource: user.accountSource,
      redirectTo,
      durationMs: Date.now() - loginStartedAt,
      timings,
    });
    res.json({
      token,
      user,
      redirectTo,
    });
    scheduleLoginMaintenance(req.requestId, [
      {
        name: "login-activity",
        run: () => writeLoginActivity({ email: normalizedEmail, role: user.role, status: "success", req }),
      },
      ...(user.dashboardAccessAllowed === true ? [{
        name: "dashboard-access-audit",
        run: () => writeAuditLog({
          req,
          actionType: "DASHBOARD_ACCESS",
          targetEntity: "dealership",
          targetId: user.dealershipId,
          meta: { dealershipId: user.dealershipId, subscriptionStatus: user.subscriptionStatus },
        }),
      }] : []),
      {
        name: "firebase-claims",
        run: () => setFirebaseClaims(firebaseUid || normalizedEmail, user, { decoded }),
      },
      {
        name: "password-lifecycle",
        run: () => persistPasswordLifecycleIfMissing(normalizedEmail, account, lifecycle),
      },
      ...(resetFailedLogin ? [{
        name: "failed-login-reset",
        run: () => clearFailedLoginForAccount(normalizedEmail, account),
      }] : []),
    ]);
  } catch (error) {
    logError("Auth login failed", {
      requestId: req.requestId,
      phase: authPhase,
      message: error.message,
      code: error.code,
      status: error.status || 500,
    });
    next(error);
  }
}

export async function restoreSession(req, res, next) {
  try {
    const { idToken } = req.body;
    const requestedLoginPortal = normalizeLoginPortal(req.body.targetPortal || req.body.portal);
    if (!requestedLoginPortal) {
      return res.status(400).json({ code: "INVALID_PORTAL", message: "Select a valid login portal." });
    }
    const requestedPortal = normalizePortal(requestedLoginPortal);
    if (!idToken) return res.status(400).json({ message: "Firebase authentication token is required" });
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });
    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    const normalizedEmail = String(decoded.email || "").trim().toLowerCase();
    const firebaseUid = String(decoded.uid || "").trim();
    if (!normalizedEmail) return res.status(400).json({ message: "Account email is required" });
    if (decoded.email_verified !== true) {
      await writeLoginActivity({ email: normalizedEmail, status: "denied", reason: "restore-email-not-verified", req });
      return res.status(403).json({ message: "Please verify your email address before logging in.", code: "EMAIL_NOT_VERIFIED" });
    }

    const identityContext = await identityContextFor(normalizedEmail, firebaseUid);
    const account = await accountForAnyPortal(normalizedEmail, firebaseUid, { identityContext });
    if (!account?.role || !ROLE_ROUTES[account.role]) {
      await writeLoginActivity({ email: normalizedEmail, status: "denied", reason: "restore-account-not-approved", req });
      return res.status(403).json({ message: "Your account is awaiting approval.", code: "APPROVAL_PENDING" });
    }
    if (!portalAllowsRole(requestedPortal, account.role) || !loginPortalAllowsRole(requestedLoginPortal, account.role)) {
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: "restore-wrong-portal", req });
      return res.status(403).json(wrongLoginPortalPayload(account.role));
    }
    if (!accountActive(account)) {
      const inactive = inactiveAccountMessage(account);
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: `restore-${inactive.code.toLowerCase()}`, req });
      return res.status(inactive.code === "ACCOUNT_LOCKED" ? 423 : 403).json(inactive);
    }
    if (["finance-desk", "gm"].includes(account.role) && !(await approvedDealerAccess(normalizedEmail, account))) {
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: "restore-dealer-approval-pending", req });
      return res.status(403).json({ message: "Your account is awaiting approval.", code: "APPROVAL_PENDING" });
    }
    if (["bank-manager", "loan-executive"].includes(account.role) && !account.bankId) {
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: "restore-bank-id-missing", req });
      return res.status(403).json({ message: "Your account is awaiting approval.", code: "APPROVAL_PENDING" });
    }

    const lifecycle = passwordLifecyclePatch(account);
    const user = await buildSessionUserFromAccount({
      account,
      email: normalizedEmail,
      firebaseUid,
      portal: requestedPortal,
      lifecycle,
      accountApproved: true,
    });
    const sessionId = await createUserSession({ req, user });
    user.sessionId = sessionId;
    const token = jwt.sign(user, jwtSecret(), { expiresIn: "7d" });
    setAuthCookie(res, token);
    const forcedPasswordPath = passwordChangeRouteForRole(user.role);
    res.json({
      token,
      user,
      redirectTo: user.firstLoginRequired === true || user.passwordExpired === true
        ? forcedPasswordPath
        : entitlementRedirect(user, ROLE_ROUTES[user.role]),
    });
    scheduleLoginMaintenance(req.requestId, [
      {
        name: "canonical-session-user",
        run: () => upsertCanonicalUser(user.uid, user),
      },
      {
        name: "failed-login-clear",
        run: () => clearFailedLogin(normalizedEmail),
      },
      {
        name: "firebase-claims",
        run: () => setFirebaseClaims(normalizedEmail, user),
      },
      {
        name: "password-lifecycle",
        run: () => persistPasswordLifecycleIfMissing(normalizedEmail, account, lifecycle),
      },
      {
        name: "login-activity",
        run: () => writeLoginActivity({ email: normalizedEmail, role: user.role, status: "session-restored", req }),
      },
    ]);
  } catch (error) {
    next(error);
  }
}

export async function recordLoginFailure(req, res, next) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter a valid email address." });
    const result = await incrementFailedLogin(email, req, req.body.reason || "firebase-auth-failed");
    res.json({
      recorded: true,
      locked: result.locked,
      code: result.locked ? "ACCOUNT_LOCKED" : "LOGIN_FAILURE_RECORDED",
      message: result.locked ? "Account locked after repeated failed attempts." : "Login failure recorded.",
      lockedUntil: result.lockedUntil,
      lockMinutes: ACCOUNT_LOCK_MINUTES,
    });
  } catch (error) {
    next(error);
  }
}
