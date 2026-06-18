import crypto from "node:crypto";
import { createRecord, findRecordsByField, queryRecords, updateRecord } from "../services/firestore.service.js";
import { logWarn } from "../services/logger.service.js";
import { activeIdentity, clearIdentityCaches, findIdentityCandidates, upsertCanonicalUser } from "../services/identity.service.js";
import { loginPortalForRole, portalForRole } from "./authPortalShared.controller.js";

export const MAX_FAILED_LOGINS = Number(process.env.MAX_FAILED_LOGINS || 5);
export const ACCOUNT_LOCK_MINUTES = Number(process.env.ACCOUNT_LOCK_MINUTES || 2);
export const SESSION_TIMEOUT_HOURS = Number(process.env.SESSION_TIMEOUT_HOURS || 8);
export const MAX_CONCURRENT_SESSIONS = Number(process.env.MAX_CONCURRENT_SESSIONS || 3);
export const PASSWORD_VALID_DAYS = Number(process.env.PASSWORD_VALID_DAYS || 90);
export const SESSION_COOKIE_NAME = "cls_session";

export function authCookieEnabled() {
  return false;
}

export function authCookieOptions() {
  const production = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  };
}

export function setAuthCookie(res, token) {
  if (authCookieEnabled() && token) res.cookie(SESSION_COOKIE_NAME, token, authCookieOptions());
  else clearAuthCookie(res);
}

export function clearAuthCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, { ...authCookieOptions(), maxAge: undefined });
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function firstLoginRequiredFor(account = {}) {
  return account.firstLoginRequired === true && !account.passwordChangedAt;
}

export function passwordLifecyclePatch(account = {}, now = new Date()) {
  if (firstLoginRequiredFor(account)) {
    return {
      passwordChangedAt: account.passwordChangedAt || null,
      passwordExpiresAt: account.passwordExpiresAt || null,
      passwordExpired: false,
      passwordDaysRemaining: null,
    };
  }
  const changedAt = account.passwordChangedAt || now.toISOString();
  const expiresAt = account.passwordExpiresAt || addDays(new Date(changedAt), PASSWORD_VALID_DAYS).toISOString();
  const remainingMs = new Date(expiresAt).getTime() - now.getTime();
  const daysRemaining = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
  return {
    passwordChangedAt: changedAt,
    passwordExpiresAt: expiresAt,
    passwordExpired: remainingMs <= 0,
    passwordDaysRemaining: Math.max(daysRemaining, 0),
  };
}

export async function persistPasswordLifecycleIfMissing(email, account, lifecycle) {
  if (!email || firstLoginRequiredFor(account)) return;
  if (account.passwordChangedAt && account.passwordExpiresAt) return;
  await upsertCanonicalUser(account.uid || account.id || email, {
    ...account,
    passwordChangedAt: lifecycle.passwordChangedAt,
    passwordExpiresAt: lifecycle.passwordExpiresAt,
  }).catch(() => null);
}

export async function writeLoginActivity({ email, role = null, status, reason = "", req }) {
  return createRecord("loginActivity", {
    email,
    role,
    status,
    reason,
    ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
    userAgent: req.headers["user-agent"] || "",
    createdAt: new Date().toISOString(),
  });
}

export function browserFromAgent(agent = "") {
  if (/Edg\//i.test(agent)) return "Edge";
  if (/Chrome\//i.test(agent)) return "Chrome";
  if (/Firefox\//i.test(agent)) return "Firefox";
  if (/Safari\//i.test(agent)) return "Safari";
  return "Unknown";
}

export function deviceFromAgent(agent = "") {
  if (/Mobile|Android|iPhone/i.test(agent)) return "Mobile";
  if (/iPad|Tablet/i.test(agent)) return "Tablet";
  if (/Windows/i.test(agent)) return "Windows";
  if (/Macintosh|Mac OS/i.test(agent)) return "Mac";
  if (/Linux/i.test(agent)) return "Linux";
  return "Unknown";
}

export async function createUserSession({ req, user }) {
  const now = new Date().toISOString();
  const sessionId = crypto.randomUUID();
  const userAgent = req.headers["user-agent"] || "";
  await createRecord("userSessions", {
    id: sessionId,
    sessionId,
    email: user.email,
    role: user.role,
    portal: user.portal || portalForRole(user.role),
    scope: user.scope || user.portal || portalForRole(user.role),
    loginPortal: user.loginPortal || loginPortalForRole(user.role),
    organizationId: user.organizationId || null,
    dealershipId: user.dealershipId || null,
    bankId: user.bankId || null,
    branchId: user.branchId || null,
    ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
    userAgent,
    browser: browserFromAgent(userAgent),
    device: deviceFromAgent(userAgent),
    loginAt: now,
    lastSeenAt: now,
    expiresAt: new Date(Date.now() + SESSION_TIMEOUT_HOURS * 60 * 60 * 1000).toISOString(),
    revoked: false,
  });
  setImmediate(() => {
    enforceConcurrentSessionLimit(user.email).catch((error) => {
      logWarn("Concurrent session cleanup failed", { message: error.message });
    });
  });
  return sessionId;
}

export async function enforceConcurrentSessionLimit(email) {
  const now = new Date().toISOString();
  const page = await queryRecords("userSessions", {
    where: [
      { field: "email", value: email },
      { field: "revoked", value: false },
    ],
    orderBy: "loginAt",
    direction: "desc",
    limit: Math.max(MAX_CONCURRENT_SESSIONS + 1, 1),
    maxLimit: Math.max(MAX_CONCURRENT_SESSIONS + 1, 1),
  });
  const activeSessions = page.data || [];
  const revoke = activeSessions.slice(Math.max(MAX_CONCURRENT_SESSIONS, 0));
  await Promise.all(revoke.map((session) => updateRecord("userSessions", session.id, {
    revoked: true,
    revokedAt: now,
    revokedReason: "concurrent-session-limit",
  }).catch(() => null)));
}

export function scheduleLoginMaintenance(requestId, tasks = []) {
  setImmediate(async () => {
    const results = await Promise.allSettled(tasks.map(({ run }) => run()));
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        logWarn("Deferred login maintenance failed", {
          requestId,
          task: tasks[index]?.name || "unknown",
          message: result.reason?.message || "Unknown error",
        });
      }
    });
  });
}

export function lockUntilDate() {
  return new Date(Date.now() + ACCOUNT_LOCK_MINUTES * 60 * 1000).toISOString();
}

export function accountLocked(account) {
  const lockedUntil = effectiveLockedUntil(account);
  return lockedUntil && new Date(lockedUntil).getTime() > Date.now();
}

export function effectiveLockedUntil(account = {}) {
  if (!account?.lockedUntil) return null;
  const storedLock = new Date(account.lockedUntil).getTime();
  if (!Number.isFinite(storedLock)) return null;
  const lastFailure = account.lastFailedLoginAt ? new Date(account.lastFailedLoginAt).getTime() : null;
  if (!Number.isFinite(lastFailure)) return account.lockedUntil;
  return new Date(Math.min(storedLock, lastFailure + ACCOUNT_LOCK_MINUTES * 60 * 1000)).toISOString();
}

export function accountLockedPayload(account = {}) {
  return {
    code: "ACCOUNT_LOCKED",
    message: "Account locked after repeated failed attempts.",
    lockedUntil: effectiveLockedUntil(account),
    lockMinutes: ACCOUNT_LOCK_MINUTES,
  };
}

export async function incrementFailedLogin(email, req, reason = "firebase-auth-failed") {
  const account = (await findIdentityCandidates({ email })).find((item) => item.role);
  const expiredLock = account?.lockedUntil && !accountLocked(account);
  const attempts = (expiredLock ? 0 : Number(account?.failedLoginAttempts || 0)) + 1;
  const lockedUntil = attempts >= MAX_FAILED_LOGINS ? lockUntilDate() : null;
  const update = {
    failedLoginAttempts: attempts,
    lastFailedLoginAt: new Date().toISOString(),
    lockedUntil: lockedUntil || null,
    ...(lockedUntil ? { accountStatus: "locked" } : expiredLock ? { accountStatus: account?.role === "super-admin" || account?.approved === true ? "active" : account?.accountStatus || "pending" } : {}),
  };
  if (account) await upsertCanonicalUser(account.uid || account.id || email, { ...account, ...update });
  await writeLoginActivity({ email, role: account?.role || null, status: "denied", reason, req });
  return { attempts, locked: attempts >= MAX_FAILED_LOGINS, lockedUntil };
}

export async function clearFailedLogin(email) {
  const account = (await findIdentityCandidates({ email })).find((item) => item.role);
  if (!account) return;
  await clearFailedLoginForAccount(email, account);
}

export async function clearFailedLoginForAccount(email, account) {
  if (!account?.role) return;
  await upsertCanonicalUser(account.uid || account.id || email, {
    ...account,
    failedLoginAttempts: 0,
    lockedUntil: null,
    accountStatus: account.role === "super-admin" || account.approved === true ? "active" : account.accountStatus || "pending",
  });
}

export async function clearTransientLoginLock(email, account = {}) {
  if (!account?.role) return account;
  if (!account.lockedUntil && !account.failedLoginAttempts && account.accountStatus !== "locked") return account;
  return {
    ...account,
    failedLoginAttempts: 0,
    lockedUntil: null,
    accountStatus: account.role === "super-admin" || account.approved === true ? "active" : account.accountStatus || "pending",
  };
}

export async function revokeUserSessions(email, reason = "admin-revoked") {
  const now = new Date().toISOString();
  const sessions = (await findRecordsByField("userSessions", "email", email, 25)).filter((session) => session.revoked !== true);
  await Promise.all(sessions.map((session) => updateRecord("userSessions", session.id, {
    revoked: true,
    revokedAt: now,
    revokedReason: reason,
  }).catch(() => null)));
  const account = (await findIdentityCandidates({ email })).find((item) => item.role);
  sessions.forEach((session) => clearIdentityCaches({ email, uid: account?.uid || account?.id || "", sessionId: session.id }));
  if (account) await upsertCanonicalUser(account.uid || account.id || email, { ...account, sessionRevokedAt: now });
}

export async function createPendingGoogleAccount({ decoded, portal, reason }) {
  const email = String(decoded.email || "").toLowerCase();
  const existing = (await findRecordsByField("pendingGoogleAccounts", "email", email, 5)).find((item) => item.status === "pending");
  if (existing) return existing;
  return createRecord("pendingGoogleAccounts", {
    email,
    name: decoded.name || decoded.email || "",
    photoURL: decoded.picture || "",
    requestedPortal: portal || "",
    requestedRole: portal === "admin" ? "super-admin" : "",
    requestedAt: new Date().toISOString(),
    status: "pending",
    reason,
  });
}
