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
  PASSWORD_VALID_DAYS,
  passwordLifecyclePatch,
  persistPasswordLifecycleIfMissing,
  portalAllowsRole,
  portalForRole,
  queryRecords,
  revokeUserSessions,
  registrationProfile,
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
import { createNotification } from "../services/notification.service.js";
import { publishRealtimeEvent, REALTIME_EVENTS } from "../services/realtime.service.js";

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,64}$/;
const COMMON_WEAK_PASSWORDS = new Set(["12345678", "password", "admin", "abc123", "qwerty", "aaaaaaaa", "11111111"]);

function passwordChangePortal(req) {
  return String(req.headers["x-cls-portal"] || req.user?.portal || req.user?.scope || "unknown").trim().toLowerCase();
}

function validNewPassword(value) {
  const password = String(value || "");
  return PASSWORD_PATTERN.test(password) && !COMMON_WEAK_PASSWORDS.has(password.toLowerCase());
}

async function auditPasswordChange(req, { success, reason }) {
  return writeAuditLog({
    req,
    actionType: "PASSWORD_CHANGE",
    targetEntity: "auth",
    targetId: req.user?.email || req.user?.uid || null,
    sourcePortal: passwordChangePortal(req),
    meta: {
      success,
      reason,
      device: deviceFromAgent(req.headers["user-agent"]),
      browser: browserFromAgent(req.headers["user-agent"]),
    },
  }).catch(() => null);
}

void AUTH_SHARED_SENTINEL;

export async function changeAuthenticatedPassword(req, res, next) {
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");
  const confirmPassword = String(req.body?.confirmPassword || "");
  const reject = async (status, message, code, reason = code) => {
    await auditPasswordChange(req, { success: false, reason });
    return res.status(status).json({ message, code });
  };

  try {
    const email = String(req.user?.email || "").trim().toLowerCase();
    const uid = String(req.user?.uid || "").trim();
    if (!email || !uid) return reject(401, "Login again before changing your password.", "AUTH_REQUIRED");
    if (!currentPassword) return reject(400, "Current password is required.", "CURRENT_PASSWORD_REQUIRED");
    if (!newPassword) return reject(400, "New password is required.", "NEW_PASSWORD_REQUIRED");
    if (newPassword !== confirmPassword) return reject(400, "Passwords do not match.", "PASSWORD_MISMATCH");
    if (newPassword === currentPassword) {
      return reject(400, "New password must be different from your current password.", "PASSWORD_REUSED");
    }
    if (!validNewPassword(newPassword)) {
      return reject(400, "Password does not meet security requirements.", "WEAK_PASSWORD");
    }
    if (!firebaseAdmin) return reject(503, "Unable to change password. Please try again.", "FIREBASE_UNAVAILABLE");

    try {
      await signInWithFirebasePassword(email, currentPassword);
    } catch (error) {
      if (["auth/invalid-credential", "INVALID_PASSWORD", "INVALID_LOGIN_CREDENTIALS"].includes(error.code) || error.status === 401) {
        return reject(401, "Current password is incorrect.", "CURRENT_PASSWORD_INCORRECT");
      }
      if (error.status === 429) {
        return reject(429, "Too many incorrect attempts. Please try again later.", "PASSWORD_CHANGE_RATE_LIMITED", "FIREBASE_RATE_LIMIT");
      }
      throw error;
    }

    const firebaseUser = await firebaseAdmin.auth().getUserByEmail(email);
    if (firebaseUser.uid !== uid && uid !== email) {
      return reject(403, "Unable to change password. Please try again.", "IDENTITY_MISMATCH");
    }

    await firebaseAdmin.auth().updateUser(firebaseUser.uid, { password: newPassword });
    await firebaseAdmin.auth().revokeRefreshTokens(firebaseUser.uid);
    await revokeUserSessions(email, "password-changed");

    const now = new Date().toISOString();
    const passwordExpiresAt = addDays(new Date(now), PASSWORD_VALID_DAYS).toISOString();
    const lifecyclePatch = {
      passwordChangedAt: now,
      passwordExpiresAt,
      passwordExpired: false,
      passwordDaysRemaining: PASSWORD_VALID_DAYS,
      firstLoginRequired: false,
      forcePasswordReset: false,
      temporaryPasswordRequired: false,
      temporaryPasswordHash: null,
      temporaryPasswordIssuedAt: null,
    };
    const device = deviceFromAgent(req.headers["user-agent"]);
    const browser = browserFromAgent(req.headers["user-agent"]);
    const followUps = await Promise.allSettled([
      upsertCanonicalUser(uid, { ...(req.authAccount || {}), ...lifecyclePatch }),
      updatePasswordLifecycleRecords(email, req.user.role, lifecyclePatch),
      createNotification({
        type: "password-changed",
        title: "Password changed successfully",
        message: "Your password was changed successfully.",
        recipientRole: req.user.role,
        recipientId: uid,
        recipientEmail: email,
        userId: uid,
        priority: "high",
        entityType: "security",
        entityId: uid,
        meta: { changedAt: now, device, browser, ip: req.ip || null, dedupeKey: `password-change-${now}` },
        source: "security",
        requestId: req.requestId || null,
      }),
      auditPasswordChange(req, { success: true, reason: "PASSWORD_CHANGED" }),
      writeLoginActivity({ email, role: req.user.role, status: "password-changed", req }),
    ]);
    followUps.forEach((result, index) => {
      if (result.status === "rejected") {
        logError("Password change follow-up failed after credentials were secured", {
          userId: uid,
          followUpIndex: index,
          error: result.reason?.message || "unknown",
        });
      }
    });

    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.SESSION_REVOKED,
      actor: { uid, email, role: req.user.role },
      data: { recipientId: uid, recipientIds: [uid, email], reason: "password-changed", timestamp: now },
    });
    clearAuthCookie(res);
    return res.json({
      ok: true,
      message: "Password changed successfully. Please log in again using your new password.",
      code: "PASSWORD_CHANGED",
    });
  } catch (error) {
    await auditPasswordChange(req, { success: false, reason: error.code || "PASSWORD_CHANGE_FAILED" });
    if (error.status && error.status < 500) {
      return res.status(error.status).json({ message: "Unable to change password. Please try again.", code: error.code || "PASSWORD_CHANGE_FAILED" });
    }
    next(error);
  }
}
export async function validatePasswordReset(req, res, next) {
  const email = String(req.body.email || "").trim().toLowerCase();
  const requestedPortal = normalizeLoginPortal(req.body.portal);
  const auditAttempt = async ({ success, reason, role = "unknown" }) => {
    await writeAuditLog({
      req,
      actorId: email || "anonymous",
      actorRole: role,
      actionType: "PASSWORD_RESET_ATTEMPT",
      targetEntity: "auth",
      targetId: email || null,
      sourcePortal: requestedPortal || String(req.body.portal || "").trim().toLowerCase() || "unknown",
      meta: { success, reason, requestedPortal: requestedPortal || "invalid" },
    }).catch(() => null);
  };
  const reject = async (status, payload, role) => {
    await auditAttempt({ success: false, reason: payload.code || payload.message, role });
    return res.status(status).json(payload);
  };
  try {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reject(400, { message: "Enter a valid email address.", code: "INVALID_EMAIL" });
    if (!requestedPortal) return reject(400, { message: "Select a valid portal before requesting a password reset.", code: "INVALID_PORTAL" });
    const account = await accountForAnyPortal(email);
    if (!account?.role) return reject(404, { message: "No account was found with this email address.", code: "NO_ACCOUNT" });
    if (!loginPortalAllowsRole(requestedPortal, account.role)) {
      return reject(403, {
        message: "This account belongs to another portal.",
        code: "WRONG_PORTAL",
        correctPortal: loginPortalForRole(account.role),
        redirectTo: roleGuidance(account.role).redirectTo,
        actionLabel: roleGuidance(account.role).actionLabel,
      }, account.role);
    }
    if (!accountActive(account)) {
      return reject(403, { message: "Your account is inactive. Please contact your administrator.", code: "ACCOUNT_DISABLED" }, account.role);
    }
    if (!firebaseAdmin) return reject(503, { message: "Firebase Admin is not configured", code: "FIREBASE_UNAVAILABLE" }, account.role);
    let firebaseUser;
    try {
      firebaseUser = await firebaseAdmin.auth().getUserByEmail(email);
    } catch (error) {
      if (error.code === "auth/user-not-found") return reject(404, { message: "No account was found with this email address.", code: "NO_FIREBASE_ACCOUNT" }, account.role);
      throw error;
    }
    if (firebaseUser.emailVerified !== true) {
      return reject(403, { message: "Verify your email before resetting password.", code: "EMAIL_NOT_VERIFIED" }, account.role);
    }
    const firebaseLinkedAccount = await resolveCanonicalIdentity({ uid: firebaseUser.uid, email })
      || (await findIdentityCandidates({ uid: firebaseUser.uid, email })).find((item) => item.role);
    if (!firebaseLinkedAccount?.role || firebaseLinkedAccount.role !== account.role) {
      return reject(403, { message: "The authentication account does not match this portal account.", code: "IDENTITY_MISMATCH" }, account.role);
    }
    await auditAttempt({ success: true, reason: "VALIDATION_APPROVED", role: account.role });
    res.json({ ok: true });
  } catch (error) {
    await auditAttempt({ success: false, reason: "VALIDATION_ERROR" });
    next(error);
  }
}

export async function completeForcedPasswordChange(req, res, next) {
  try {
    const email = String(req.user?.email || "").trim().toLowerCase();
    const uid = String(req.user?.uid || "").trim();
    if (!email) return res.status(401).json({ message: "Invalid session" });
    const account = await resolveCanonicalIdentity({ uid, email });
    if (!account || !["loan-executive", "bank-manager", "finance-desk", "gm"].includes(account.role)) return res.status(403).json({ message: "This account cannot complete forced password change" });
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
