import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { jwtSecret, superAdminEmail } from "../config/env.js";
import { firebaseAdmin } from "../firebase/admin.js";
import { createRecord, findRecordsByField, getRecord, queryRecords, updateRecord, upsertRecord } from "../services/firestore.service.js";
import { writeAuditLog } from "../services/audit.service.js";
import { logError, logInfo, logWarn } from "../services/logger.service.js";
import {
  activeIdentity,
  assertNoActiveIdentityCollision,
  clearIdentityCaches,
  findIdentityCandidates,
  resolveCanonicalIdentity,
  upsertCanonicalUser,
} from "../services/identity.service.js";
import { getDealershipSubscription } from "../services/subscription.service.js";
import { cached } from "../services/ttlCache.service.js";
import { onboardingStatusForUser } from "../services/onboarding.service.js";

const ROLE_ROUTES = {
  "finance-desk": "/finance/dashboard",
  "gm": "/gm/dashboard",
  "bank-manager": "/bank-manager/dashboard",
  "loan-executive": "/loan-executive/leads",
  "super-admin": "/admin/dashboard",
};
const PORTAL_ROLES = {
  finance: ["finance-desk", "gm"],
  dealer: ["finance-desk", "gm"],
  bank: ["bank-manager", "loan-executive"],
  admin: ["super-admin"],
};
const LOGIN_PORTAL_ROLES = {
  finance: ["finance-desk"],
  gm: ["gm"],
  "bank-manager": ["bank-manager"],
  "loan-executive": ["loan-executive"],
  admin: ["super-admin"],
};
const AUTH_ENTITLEMENT_CACHE_TTL_MS = Number(process.env.AUTH_ENTITLEMENT_CACHE_TTL_MS || 60_000);
const AUTH_DEALERSHIP_ACCESS_CACHE_TTL_MS = Number(process.env.AUTH_DEALERSHIP_ACCESS_CACHE_TTL_MS || 120_000);

function accountEntitlementSnapshot(account = {}) {
  if (!["finance-desk", "gm"].includes(account?.role)) return null;
  if (typeof account.dashboardAccessAllowed !== "boolean" || !account.subscriptionStatus) return null;
  return {
    selectedPlan: account.selectedPlan || "TRIAL",
    subscriptionStatus: account.subscriptionStatus,
    dashboardAccessAllowed: account.dashboardAccessAllowed === true,
  };
}

async function dealershipEntitlement(account, fallbackEmail = "") {
  if (!["finance-desk", "gm"].includes(account?.role)) return {};
  const dealershipId = account.dealershipId || fallbackEmail;
  const accountSnapshot = accountEntitlementSnapshot(account);
  if (accountSnapshot) return accountSnapshot;
  const subscription = await cached(
    `auth:dealership-entitlement:${dealershipId}`,
    AUTH_ENTITLEMENT_CACHE_TTL_MS,
    async () => await getDealershipSubscription(dealershipId, { initialize: false }).catch(() => null) || false
  );
  return {
    selectedPlan: subscription?.selectedPlan || account.selectedPlan || "TRIAL",
    subscriptionStatus: subscription?.subscriptionStatus || account.subscriptionStatus || "EXPIRED",
    dashboardAccessAllowed: subscription?.dashboardAccessAllowed ?? account.dashboardAccessAllowed === true,
  };
}

function entitlementRedirect(user, fallback) {
  if (["finance-desk", "gm"].includes(user?.role) && user.dashboardAccessAllowed === false) {
    return "/subscription-activation";
  }
  return fallback;
}
const ROLE_LOGIN_PORTALS = {
  "finance-desk": "finance",
  "gm": "gm",
  "bank-manager": "bank-manager",
  "loan-executive": "loan-executive",
  "super-admin": "admin",
};
const ROLE_GUIDANCE = {
  "finance-desk": {
    roleLabel: "Finance Desk",
    portalLabel: "Finance Desk Portal",
    redirectTo: "/finance/login",
    actionLabel: "Go to Finance Login",
  },
  "gm": {
    roleLabel: "General Manager",
    portalLabel: "GM Portal",
    redirectTo: "/gm/login",
    actionLabel: "Go to GM Login",
  },
  "bank-manager": {
    roleLabel: "Bank Manager",
    portalLabel: "Bank Portal",
    redirectTo: "/bank/login",
    actionLabel: "Go to Bank Manager Login",
  },
  "loan-executive": {
    roleLabel: "Loan Executive",
    portalLabel: "Executive Portal",
    redirectTo: "/executive/login",
    actionLabel: "Go to Executive Login",
  },
  "super-admin": {
    roleLabel: "Super Admin",
    portalLabel: "Super Admin Portal",
    redirectTo: "/admin/login",
    actionLabel: "Go to Super Admin Login",
  },
};
const MAX_FAILED_LOGINS = Number(process.env.MAX_FAILED_LOGINS || 5);
const ACCOUNT_LOCK_MINUTES = Number(process.env.ACCOUNT_LOCK_MINUTES || 2);
const SESSION_TIMEOUT_HOURS = Number(process.env.SESSION_TIMEOUT_HOURS || 8);
const MAX_CONCURRENT_SESSIONS = Number(process.env.MAX_CONCURRENT_SESSIONS || 3);
const PASSWORD_VALID_DAYS = Number(process.env.PASSWORD_VALID_DAYS || 90);
const SESSION_COOKIE_NAME = "cls_session";

function normalizePortal(portal = "dealer") {
  if (portal === "gm") return "finance";
  if (["bank-manager", "loan-executive", "executive"].includes(portal)) return "bank";
  if (portal === "super-admin") return "admin";
  return PORTAL_ROLES[portal] ? portal : "dealer";
}

function normalizeLoginPortal(portal = "") {
  const normalized = String(portal || "").trim().toLowerCase();
  if (normalized === "dealer") return "finance";
  if (normalized === "bank") return "bank-manager";
  if (normalized === "executive") return "loan-executive";
  if (normalized === "super-admin") return "admin";
  return LOGIN_PORTAL_ROLES[normalized] ? normalized : "";
}

function loginPortalForRole(role) {
  return ROLE_LOGIN_PORTALS[String(role || "").trim().toLowerCase()] || "";
}

function loginPortalAllowsRole(portal, role) {
  return Boolean((LOGIN_PORTAL_ROLES[portal] || []).includes(role));
}

function organizationIdForAccount(account = {}) {
  if (account.role === "super-admin") return account.uid || account.id || account.email || "platform";
  return account.dealershipId || account.bankId || null;
}

function wrongLoginPortalPayload() {
  return {
    code: "WRONG_PORTAL",
    message: "You are not authorized to access this portal.",
  };
}

function passwordChangeRouteForRole(role) {
  if (role === "loan-executive") return "/loan-executive/change-password";
  if (role === "gm") return "/gm/change-password";
  if (role === "finance-desk") return "/finance/change-password";
  return "/change-password";
}

function authCookieEnabled() {
  return false;
}

function authCookieOptions() {
  const production = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  };
}

function setAuthCookie(res, token) {
  if (authCookieEnabled() && token) res.cookie(SESSION_COOKIE_NAME, token, authCookieOptions());
  else clearAuthCookie(res);
}

function clearAuthCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, { ...authCookieOptions(), maxAge: undefined });
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function firstLoginRequiredFor(account = {}) {
  return account.firstLoginRequired === true && !account.passwordChangedAt;
}

function passwordLifecyclePatch(account = {}, now = new Date()) {
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

async function persistPasswordLifecycleIfMissing(email, account, lifecycle) {
  if (!email || firstLoginRequiredFor(account)) return;
  if (account.passwordChangedAt && account.passwordExpiresAt) return;
  await upsertCanonicalUser(account.uid || account.id || email, {
    ...account,
    passwordChangedAt: lifecycle.passwordChangedAt,
    passwordExpiresAt: lifecycle.passwordExpiresAt,
  }).catch(() => null);
}

async function writeLoginActivity({ email, role = null, status, reason = "", req }) {
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

function browserFromAgent(agent = "") {
  if (/Edg\//i.test(agent)) return "Edge";
  if (/Chrome\//i.test(agent)) return "Chrome";
  if (/Firefox\//i.test(agent)) return "Firefox";
  if (/Safari\//i.test(agent)) return "Safari";
  return "Unknown";
}

function deviceFromAgent(agent = "") {
  if (/Mobile|Android|iPhone/i.test(agent)) return "Mobile";
  if (/iPad|Tablet/i.test(agent)) return "Tablet";
  if (/Windows/i.test(agent)) return "Windows";
  if (/Macintosh|Mac OS/i.test(agent)) return "Mac";
  if (/Linux/i.test(agent)) return "Linux";
  return "Unknown";
}

async function createUserSession({ req, user }) {
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

async function enforceConcurrentSessionLimit(email) {
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

function scheduleLoginMaintenance(requestId, tasks = []) {
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

function lockUntilDate() {
  return new Date(Date.now() + ACCOUNT_LOCK_MINUTES * 60 * 1000).toISOString();
}

function accountLocked(account) {
  const lockedUntil = effectiveLockedUntil(account);
  return lockedUntil && new Date(lockedUntil).getTime() > Date.now();
}

function effectiveLockedUntil(account = {}) {
  if (!account?.lockedUntil) return null;
  const storedLock = new Date(account.lockedUntil).getTime();
  if (!Number.isFinite(storedLock)) return null;
  const lastFailure = account.lastFailedLoginAt ? new Date(account.lastFailedLoginAt).getTime() : null;
  if (!Number.isFinite(lastFailure)) return account.lockedUntil;
  return new Date(Math.min(storedLock, lastFailure + ACCOUNT_LOCK_MINUTES * 60 * 1000)).toISOString();
}

function accountLockedPayload(account = {}) {
  return {
    code: "ACCOUNT_LOCKED",
    message: "Account locked after repeated failed attempts.",
    lockedUntil: effectiveLockedUntil(account),
    lockMinutes: ACCOUNT_LOCK_MINUTES,
  };
}

async function incrementFailedLogin(email, req, reason = "firebase-auth-failed") {
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

async function clearFailedLogin(email) {
  const account = (await findIdentityCandidates({ email })).find((item) => item.role);
  if (!account) return;
  await clearFailedLoginForAccount(email, account);
}

async function clearFailedLoginForAccount(email, account) {
  if (!account?.role) return;
  await upsertCanonicalUser(account.uid || account.id || email, {
    ...account,
    failedLoginAttempts: 0,
    lockedUntil: null,
    accountStatus: account.role === "super-admin" || account.approved === true ? "active" : account.accountStatus || "pending",
  });
}

async function clearTransientLoginLock(email, account = {}) {
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

async function createPendingGoogleAccount({ decoded, portal, reason }) {
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

function lifecycleOverlay(base = {}, userRecord = {}) {
  if (!userRecord?.role || userRecord.role !== base.role) return base;
  return {
    ...base,
    firstLoginRequired: userRecord.firstLoginRequired === true,
    passwordChangedAt: userRecord.passwordChangedAt || base.passwordChangedAt || null,
    passwordExpiresAt: userRecord.passwordExpiresAt || base.passwordExpiresAt || null,
    passwordExpired: userRecord.passwordExpired === true,
    passwordDaysRemaining: Number.isFinite(Number(userRecord.passwordDaysRemaining)) ? Number(userRecord.passwordDaysRemaining) : base.passwordDaysRemaining,
    accountStatus: userRecord.accountStatus || base.accountStatus,
    active: userRecord.active !== false && base.active !== false,
    approved: userRecord.approved === true || base.approved === true,
    accountApproved: userRecord.accountApproved !== false && base.accountApproved !== false,
    accountActive: userRecord.accountActive !== false && base.accountActive !== false,
  };
}

async function identityContextFor(email, uid = "") {
  const candidates = await findIdentityCandidates({ uid, email });
  const activeCandidates = candidates.filter(activeIdentity);
  if (activeCandidates.length > 1) {
    const error = new Error("Multiple active identities exist for this email. Contact support.");
    error.status = 409;
    error.code = "IDENTITY_COLLISION";
    error.details = activeCandidates.map((record) => ({
      id: record.id,
      uid: record.uid || null,
      email: record.email || null,
      role: record.role || null,
      portalType: record.portalType || null,
    }));
    throw error;
  }
  return { candidates, activeCandidates };
}

function canonicalFromContext(context = {}, { uid = "", portal = "" } = {}) {
  const normalizedUid = String(uid || "").trim();
  const activeCandidates = context.activeCandidates || [];
  if (!activeCandidates.length) return null;
  return activeCandidates.find((record) => normalizedUid && String(record.uid || "").trim() === normalizedUid)
    || activeCandidates.find((record) => portal && record.portalType === portal)
    || activeCandidates[0];
}

async function accountWithUserLifecycle(email, account, identityContext = null) {
  if (!account) return null;
  const candidates = identityContext?.candidates || await findIdentityCandidates({ uid: account.uid, email }).catch(() => []);
  const userRecord = candidates
    .find((item) => item.role === account.role);
  return userRecord ? lifecycleOverlay(account, userRecord) : account;
}

function emailMatchesRecord(record = {}, email) {
  const normalized = String(email || "").trim().toLowerCase();
  return [
    record.id,
    record.email,
    record.officialEmail,
    record.loginEmail,
    record.dealershipEmail,
  ].some((value) => String(value || "").trim().toLowerCase() === normalized);
}

function uniqueAuthRecords(records = []) {
  const seen = new Set();
  return records.filter((record) => {
    const key = record?.id || `${record?.uid || ""}:${record?.email || ""}:${record?.role || ""}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function firstLookup(lookups = []) {
  for (const lookup of lookups) {
    const result = await lookup().catch(() => null);
    if (Array.isArray(result)) {
      if (result[0]) return result[0];
    } else if (result) {
      return result;
    }
  }
  return null;
}

function uidMatchesRecord(record = {}, email, uid) {
  if (!uid) return true;
  const recordUid = String(record.uid || record.authUid || "").trim();
  if (!recordUid) return true;
  return recordUid === uid || recordUid === email;
}

async function updatePasswordLifecycleRecords(email, role, patch) {
  const linkedCollections = role === "loan-executive"
    ? ["loanExecutives"]
    : role === "finance-desk"
      ? ["financeDesks", "dealerStaff"]
      : ["dealershipManagers", "dealerStaff"];

  await Promise.all(linkedCollections.map(async (collection) => {
    const pages = await Promise.all([
      getRecord(collection, email).then((record) => record ? [record] : []).catch(() => []),
      findRecordsByField(collection, "email", email, 10).catch(() => []),
      findRecordsByField(collection, "officialEmail", email, 10).catch(() => []),
      findRecordsByField(collection, "loginEmail", email, 10).catch(() => []),
      findRecordsByField(collection, "dealershipEmail", email, 10).catch(() => []),
    ]);
    const matches = uniqueAuthRecords(pages.flat()).filter((record) => emailMatchesRecord(record, email));
    await Promise.all(matches.map((record) => upsertRecord(collection, record.id || email, {
      ...record,
      ...patch,
    }).catch(() => null)));
  }));
}

async function accountForEmail(email, portal, uid = "", identityContext = null) {
  const adminEmail = superAdminEmail();
  const allowed = PORTAL_ROLES[portal] || [];
  const context = identityContext || await identityContextFor(email, uid);
  if (portal === "admin" || email === adminEmail) {
    if (email !== adminEmail) return null;
    const adminCandidates = context.candidates.filter((item) => item.role === "super-admin" && uidMatchesRecord(item, email, uid));
    const adminUser = adminCandidates.find(activeIdentity) || adminCandidates[0];
    return adminUser?.role === "super-admin" && uidMatchesRecord(adminUser, email, uid) ? { ...adminUser, accountSource: "users", accountSourceId: adminUser.id || email } : null;
  }
  const canonical = canonicalFromContext(context, { uid, portal });
  if (canonical?.role) {
    return allowed.includes(canonical.role)
      ? accountWithUserLifecycle(email, { ...canonical, accountSource: "users", accountSourceId: canonical.id || canonical.uid || email }, context)
      : null;
  }
  const inactiveCanonical = context.candidates.find((item) => allowed.includes(item.role));
  if (inactiveCanonical) {
    return accountWithUserLifecycle(email, { ...inactiveCanonical, accountSource: "users", accountSourceId: inactiveCanonical.id || inactiveCanonical.uid || email }, context);
  }

  return null;
}

function portalAllowsRole(portal, role) {
  return Boolean((PORTAL_ROLES[portal] || []).includes(role));
}

function portalForRole(role) {
  if (["finance-desk", "gm"].includes(role)) return "finance";
  return Object.entries(PORTAL_ROLES).find(([, roles]) => roles.includes(role))?.[0] || null;
}

function roleGuidance(role) {
  return ROLE_GUIDANCE[role] || {
    roleLabel: "registered",
    portalLabel: "assigned",
    redirectTo: "/",
    actionLabel: "Go to Correct Login",
  };
}

function inactiveAccountMessage(account = {}) {
  const status = String(account.accountStatus || account.status || "").toLowerCase();
  if (accountLocked(account)) return accountLockedPayload(account);
  if (account.role === "super-admin" && (account.active === false || account.accountActive === false || account.approved === false || account.accountApproved === false)) {
    return { code: "ACCOUNT_DISABLED", message: "Super Admin profile is inactive. Repair the configured Super Admin account before login." };
  }
  if (["suspended", "disabled", "removed", "inactive", "paused"].includes(status)) {
    return { code: "ACCOUNT_DISABLED", message: "Your account has been temporarily disabled. Contact support." };
  }
  if (status === "rejected") {
    return { code: "ACCOUNT_REJECTED", message: "Your account registration was rejected. Contact support for next steps." };
  }
  if (["pending", "", "not-submitted"].includes(status) || account.approved === false || account.accountApproved === false || account.active === false || account.accountActive === false) {
    return { code: "APPROVAL_PENDING", message: "Your account exists but is awaiting approval from Super Admin." };
  }
  return { code: "APPROVAL_PENDING", message: "Your account exists but is awaiting approval from Super Admin." };
}

async function accountForAnyPortal(email, uid = "", { identityContext = null, skipPortals = [] } = {}) {
  const context = identityContext || await identityContextFor(email, uid);
  const skipped = new Set(skipPortals.filter(Boolean));
  const lookups = await Promise.all(["dealer", "bank", "admin"]
    .filter((portal) => !skipped.has(portal))
    .map((portal) => accountForEmail(email, portal, uid, context).catch(() => null)));
  const account = lookups.find(Boolean);
  if (account) return account;
  return context.candidates.find((item) => item.role && uidMatchesRecord(item, email, uid)) || null;
}

function wrongPortalPayload(account = {}) {
  const guidance = roleGuidance(account.role);
  return {
    code: "WRONG_PORTAL",
    role: account.role,
    roleLabel: guidance.roleLabel,
    correctPortal: portalForRole(account.role),
    portalLabel: guidance.portalLabel,
    redirectTo: guidance.redirectTo,
    actionLabel: guidance.actionLabel,
    message: `This email is registered as a ${guidance.roleLabel} account. Please login through the ${guidance.portalLabel}.`,
  };
}

function registrationProfile(account = {}) {
  return {
    name: account.name || account.fullName || account.displayName || "",
    fullName: account.fullName || account.name || "",
    managerName: account.managerName || account.contactPerson || account.name || "",
    executiveName: account.executiveName || account.name || account.fullName || "",
    employeeId: account.employeeId || account.employeeCode || "",
    email: account.email || account.officialEmail || "",
    officialEmail: account.officialEmail || account.email || "",
    mobile: account.mobile || account.phone || account.officialMobile || account.officialDealershipMobile || "",
    officialMobile: account.officialMobile || account.officialDealershipMobile || account.mobile || account.phone || "",
    dealershipName: account.dealershipName || account.dealerName || "",
    dealerName: account.dealerName || account.dealershipName || "",
    ownerName: account.ownerName || account.ownerFullName || account.owner?.fullName || "",
    ownerMobile: account.ownerMobile || account.owner?.mobile || "",
    bankName: account.bankName || account.companyName || "",
    branchName: account.branchName || account.bankBranchLocation || account.branchLocation || account.branch || "",
    bankBranchLocation: account.bankBranchLocation || account.branchLocation || account.branchCity || account.city || "",
    bankIfsc: account.bankIfsc || account.ifsc || account.ifscCode || account.branchIfsc || "",
    address: account.address || account.fullAddress || "",
    city: account.city || account.dealerCity || account.branchCity || account.bankBranchLocation || "",
    state: account.state || "",
    status: account.status || account.accountStatus || (account.active === false ? "inactive" : "active"),
    createdAt: account.createdAt || account.registeredAt || account.approvedAt || "",
  };
}

function sessionUserFromAuthenticatedRequest(req, account = req.authAccount || {}, claims = req.authTokenClaims || {}) {
  const role = account.role || req.user?.role || claims.role;
  const lifecycle = passwordLifecyclePatch({ ...claims, ...account, role });
  const presentation = claims.profile || req.user?.profile
    ? {
      profile: claims.profile || req.user?.profile,
      dealershipName: claims.dealershipName || req.user?.dealershipName,
      dealerCity: claims.dealerCity || req.user?.dealerCity,
      bankName: claims.bankName || req.user?.bankName,
      bankIfsc: claims.bankIfsc || req.user?.bankIfsc,
      bankBranchLocation: claims.bankBranchLocation || req.user?.bankBranchLocation,
    }
    : { profile: registrationProfile({ ...claims, ...account, ...req.user }) };
  const user = {
    uid: account.uid || req.user?.uid || claims.uid || account.email || req.user?.email,
    email: account.email || req.user?.email || claims.email,
    role,
    approved: account.approved === true || req.user?.approved === true || claims.approved === true,
    active: account.active !== false && req.user?.active !== false && claims.active !== false,
    accountApproved: ["bank-manager", "loan-executive"].includes(role)
      ? account.accountApproved !== false && claims.accountApproved !== false
      : account.accountApproved === true || req.user?.accountApproved === true || claims.accountApproved === true || role === "super-admin",
    accountActive: account.accountActive !== false && req.user?.accountActive !== false && claims.accountActive !== false,
    dealershipId: account.dealershipId || req.user?.dealershipId || claims.dealershipId || null,
    bankId: account.bankId || req.user?.bankId || claims.bankId || null,
    branchId: account.branchId || req.user?.branchId || claims.branchId || null,
    status: account.status || account.accountStatus || req.user?.status || claims.status || "active",
    firstLoginRequired: firstLoginRequiredFor({ ...claims, ...account }),
    passwordChangedAt: lifecycle.passwordChangedAt,
    passwordExpiresAt: lifecycle.passwordExpiresAt,
    passwordExpired: lifecycle.passwordExpired,
    passwordDaysRemaining: lifecycle.passwordDaysRemaining,
    emailVerified: true,
    selectedPlan: claims.selectedPlan || account.selectedPlan || "TRIAL",
    subscriptionStatus: claims.subscriptionStatus || account.subscriptionStatus || undefined,
    dashboardAccessAllowed: claims.dashboardAccessAllowed ?? account.dashboardAccessAllowed,
    ...presentation,
  };
  return {
    ...user,
    ...onboardingStatusForUser(user, account),
  };
}

async function dealerRegistrationStatus(email) {
  const registration = await firstLookup([
    () => getRecord("pendingDealerAccounts", email),
    () => findRecordsByField("pendingDealerAccounts", "email", email, 5),
  ]);
  if (!registration) return null;
  const [linkedOnboarding, linkedApproval] = await Promise.all([
    firstLookup([
      () => getRecord("onboardingRequests", registration.onboardingRequestId),
      () => findRecordsByField("onboardingRequests", "loginEmail", email, 5),
      () => findRecordsByField("onboardingRequests", "primaryGoogleEmail", email, 5),
    ]),
    firstLookup([
      () => getRecord("pendingDealershipApprovals", registration.approvalRequestId),
      () => findRecordsByField("pendingDealershipApprovals", "loginEmail", email, 5),
      () => findRecordsByField("pendingDealershipApprovals", "primaryGoogleEmail", email, 5),
    ]),
  ]);
  const dealership = await getRecord("dealerships", email) || await getRecord("approvedDealerships", email);
  return linkedOnboarding || linkedApproval || dealership ? registration : null;
}

async function bankRegistrationStatus(email) {
  const registration = await firstLookup([
    () => getRecord("pendingBankAccounts", email),
    () => findRecordsByField("pendingBankAccounts", "email", email, 5),
  ]);
  if (!registration) {
    const approval = await firstLookup([
      () => getRecord("pendingBankApprovals", email),
      () => findRecordsByField("pendingBankApprovals", "email", email, 5),
      () => findRecordsByField("pendingBankApprovals", "officialEmail", email, 5),
      () => findRecordsByField("pendingBankApprovals", "primaryGoogleEmail", email, 5),
    ]);
    if (!approval) return null;
    return {
      email,
      registrationSubmitted: true,
      approvalStatus: approval.status || "pending",
      accountApproved: approval.status === "approved",
      accountActive: approval.status === "approved",
      bankId: approval.bankId || approval.email || approval.officialEmail || email,
      branchId: approval.bankBranchLocation || approval.branchLocation || approval.city,
      linkedApprovalFound: true,
      liveBankProfileFound: approval.status === "approved",
    };
  }
  const [approval, bankPartner, branchManager] = await Promise.all([
    firstLookup([
      () => getRecord("pendingBankApprovals", registration.approvalRequestId),
      () => findRecordsByField("pendingBankApprovals", "email", email, 5),
      () => findRecordsByField("pendingBankApprovals", "officialEmail", email, 5),
      () => findRecordsByField("pendingBankApprovals", "primaryGoogleEmail", email, 5),
    ]),
    firstLookup([
      () => getRecord("bankPartners", email),
      () => findRecordsByField("bankPartners", "email", email, 5),
      () => findRecordsByField("bankPartners", "officialEmail", email, 5),
    ]),
    firstLookup([
      () => getRecord("branchManagers", email),
      () => findRecordsByField("branchManagers", "email", email, 5),
      () => findRecordsByField("branchManagers", "officialEmail", email, 5),
    ]),
  ]);
  return {
    ...registration,
    linkedApprovalFound: Boolean(approval),
    liveBankProfileFound: Boolean(bankPartner || branchManager),
  };
}

function bankLoginGate(registration) {
  if (!registration) {
    return {
      reason: "bank-registration-required",
      message: "Please create your bank account from Bank Registration before using Bank Login.",
      redirectTo: "/bank-registration",
      actionLabel: "Go to Bank Registration",
    };
  }

  if (registration.approvalStatus === "rejected") {
    return {
      reason: "bank-registration-rejected",
      message: registration.rejectionReason
        ? `Your bank registration was rejected: ${registration.rejectionReason}`
        : "Your bank registration was rejected. Please contact CarLoanSaathi support.",
      redirectTo: "/bank-registration",
      actionLabel: "Register Again",
    };
  }

  if (registration.registrationSubmitted === true || registration.approvalStatus === "pending") {
    return {
      reason: "bank-approval-pending",
      message: "Your bank registration is submitted and pending Super Admin approval.",
      redirectTo: "/bank-registration/pending",
      actionLabel: "Check Approval Status",
    };
  }

  return {
    reason: "bank-registration-form-required",
    message: "Your email account is verified. Please complete the Bank Registration form before using Bank Login.",
    redirectTo: "/bank-registration/form",
    actionLabel: "Complete Bank Registration",
  };
}

async function approvedDealerAccess(email, account) {
  const dealershipEmail = account?.dealershipId || email;
  const activeApprovedAccount = account?.approved === true
    && account?.active === true
    && account?.accountApproved === true
    && account?.accountActive === true;
  const [dealership, registration] = await Promise.all([
    cached(
      `auth:approved-dealership:${dealershipEmail}`,
      AUTH_DEALERSHIP_ACCESS_CACHE_TTL_MS,
      async () => await getRecord("dealerships", dealershipEmail).catch(() => null)
        || await getRecord("approvedDealerships", dealershipEmail).catch(() => null)
        || false
    ),
    activeApprovedAccount
      ? Promise.resolve(null)
      : firstLookup([
        () => getRecord("pendingDealerAccounts", dealershipEmail),
        () => findRecordsByField("pendingDealerAccounts", "email", dealershipEmail, 5),
        () => findRecordsByField("pendingDealerAccounts", "email", email, 5),
      ]).catch((error) => {
        logWarn("Auth pending dealer account lookup failed", { error: error.message });
        return null;
      }),
  ]);
  const activeDealership = dealership
    && dealership.accountActive !== false
    && dealership.active !== false
    && !["pending", "rejected", "suspended", "deleted", "inactive"].includes(String(dealership.status || "").toLowerCase());
  return Boolean(
    activeDealership
    && (
      registration?.approvalStatus === "approved"
      || activeApprovedAccount
    )
  );
}

function accountActive(account) {
  return Boolean(account?.role)
    && account?.active !== false
    && account?.accountActive !== false
    && account?.approved !== false
    && !["pending", "rejected", "suspended", "inactive", "paused", "disabled", "removed"].includes(String(account?.accountStatus || "").toLowerCase())
    && !["pending", "rejected", "suspended", "inactive", "paused", "disabled", "removed"].includes(String(account?.status || "").toLowerCase());
}

function firebaseClaimsMatch(decoded = {}, user = {}) {
  const same = (left, right) => (left ?? null) === (right ?? null);
  return same(decoded.role, user.role)
    && same(decoded.approved, user.approved === true)
    && same(decoded.active, user.active === true)
    && same(decoded.dealershipId, user.dealershipId || null)
    && same(decoded.portalType, user.portalType || null)
    && same(decoded.accountType, user.accountType || null)
    && same(decoded.bankId, user.bankId || null)
    && same(decoded.branchId, user.branchId || null);
}

async function setFirebaseClaims(identifier, user, { decoded = null } = {}) {
  if (!firebaseAdmin) return;
  if (decoded && firebaseClaimsMatch(decoded, user)) return;
  try {
    const uid = String(identifier || "").includes("@")
      ? (await firebaseAdmin.auth().getUserByEmail(identifier)).uid
      : String(identifier || "").trim();
    if (!uid) return;
    await firebaseAdmin.auth().setCustomUserClaims(uid, {
      role: user.role,
      approved: user.approved === true,
      active: user.active === true,
      dealershipId: user.dealershipId || null,
      portalType: user.portalType || null,
      accountType: user.accountType || null,
      bankId: user.bankId || null,
      branchId: user.branchId || null,
    });
  } catch {
    // Firebase user may not exist yet; claims will be applied after the account is activated.
  }
}

function firebasePasswordErrorPayload(code = "") {
  const normalized = String(code || "").toUpperCase();
  if (["EMAIL_NOT_FOUND", "INVALID_PASSWORD", "INVALID_LOGIN_CREDENTIALS"].includes(normalized)) {
    return { status: 401, code: "auth/invalid-credential", message: "Incorrect email or password." };
  }
  if (normalized === "USER_DISABLED") {
    return { status: 403, code: "ACCOUNT_DISABLED", message: "Your account has been temporarily disabled. Contact support." };
  }
  if (normalized === "TOO_MANY_ATTEMPTS_TRY_LATER") {
    return { status: 429, code: "auth/too-many-requests", message: "Too many attempts. Try again later." };
  }
  if (normalized.includes("API_KEY_HTTP_REFERRER_BLOCKED") || normalized.includes("REFERER")) {
    return { status: 502, code: "FIREBASE_AUTH_REFERER_BLOCKED", message: "Secure login service is not allowed for this domain." };
  }
  return { status: 502, code: "FIREBASE_AUTH_FAILED", message: "Secure login service failed. Try again." };
}

function firebaseAuthReferers() {
  const explicit = String(process.env.FIREBASE_AUTH_REFERER || "").trim().replace(/\/+$/, "");
  const configuredOrigins = String(process.env.CLIENT_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const preferredOrigins = [
    explicit,
    "https://www.carloansaathi.com",
    "https://carloansaathi.com",
    ...configuredOrigins,
  ];
  return [...new Set(preferredOrigins.filter(Boolean))];
}

function isFirebaseRefererBlocked(data = {}) {
  const message = String(data?.error?.message || "").toUpperCase();
  const details = Array.isArray(data?.error?.details) ? data.error.details : [];
  const reason = details
    .map((detail) => String(detail?.reason || detail?.message || "").toUpperCase())
    .find(Boolean) || "";
  return message.includes("REFERER") || reason.includes("API_KEY_HTTP_REFERRER_BLOCKED");
}

async function signInWithFirebasePassword(email, password) {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) {
    const error = new Error("Firebase web API key is not configured");
    error.status = 503;
    error.code = "FIREBASE_WEB_API_KEY_MISSING";
    throw error;
  }

  let lastError = null;
  for (const firebaseReferer of firebaseAuthReferers()) {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Referer: firebaseReferer,
      },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      if (!data.idToken) {
        const error = new Error("Firebase did not return a login token");
        error.status = 502;
        error.code = "FIREBASE_TOKEN_MISSING";
        throw error;
      }
      return data.idToken;
    }

    const firebaseCode = data?.error?.details?.find((detail) => detail?.reason)?.reason || data?.error?.message || "";
    const payload = firebasePasswordErrorPayload(firebaseCode);
    lastError = new Error(payload.message);
    lastError.status = payload.status;
    lastError.code = payload.code;
    lastError.firebaseCode = firebaseCode;
    lastError.firebaseReferer = firebaseReferer;

    if (!isFirebaseRefererBlocked(data)) break;
  }
  throw lastError;
}

export async function login(req, res, next) {
  const loginStartedAt = Date.now();
  const timings = {};
  let authPhase = "start";
  let normalizedEmail = "";
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
        return res.status(error.status || 500).json({ code: error.code, message: error.message });
      }
    }
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });
    authPhase = "verify-firebase-token";
    const verifyStartedAt = Date.now();
    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
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
      return res.status(403).json(wrongLoginPortalPayload());
    }
    if (!account || !ROLE_ROUTES[account.role]) {
      authPhase = "resolve-known-account";
      const knownAccount = await accountForAnyPortal(normalizedEmail, firebaseUid, { identityContext, skipPortals: [portal] });
      if (knownAccount?.role && (!portalAllowsRole(portal, knownAccount.role) || !loginPortalAllowsRole(requestedLoginPortal, knownAccount.role))) {
        await writeLoginActivity({ email: normalizedEmail, role: knownAccount.role, status: "denied", reason: "wrong-portal", req });
        return res.status(403).json(wrongLoginPortalPayload());
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
    const user = {
      uid: firebaseUid || account.uid || normalizedEmail,
      email: normalizedEmail,
      role: account.role,
      portal: portalForRole(account.role),
      scope: portalForRole(account.role),
      loginPortal: loginPortalForRole(account.role),
      organizationId: organizationIdForAccount(account),
      createdAt: new Date().toISOString(),
      approved: true,
      active: true,
      accountStatus: "active",
      emailVerified: true,
      accountApproved: ["dealer", "finance", "bank"].includes(portal) ? true : account.accountApproved === true,
      accountActive: true,
      dealershipId: account.dealershipId || null,
      bankId: account.bankId || null,
      branchId: account.branchId || null,
      portalType: account.portalType || portal,
      accountType: account.accountType || null,
      accountSource: account.accountSource || "users",
      accountSourceId: account.accountSourceId || null,
      status: account.status || "active",
      firstLoginRequired: firstLoginRequiredFor(account),
      passwordChangedAt: lifecycle.passwordChangedAt,
      passwordExpiresAt: lifecycle.passwordExpiresAt,
      passwordExpired: lifecycle.passwordExpired,
      passwordDaysRemaining: lifecycle.passwordDaysRemaining,
      lastLoginAt: new Date().toISOString(),
      dealershipName: account.dealershipName || null,
      dealerCity: account.dealerCity || account.city || null,
      bankName: account.bankName || account.companyName || null,
      bankIfsc: account.bankIfsc || account.ifsc || account.ifscCode || null,
      bankBranchLocation: account.bankBranchLocation || account.branchLocation || account.branchCity || account.city || null,
      profile: registrationProfile(account),
    };
    Object.assign(user, await dealershipEntitlement(account, normalizedEmail));
    Object.assign(user, onboardingStatusForUser(user, account));
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
      return res.status(403).json(wrongLoginPortalPayload());
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
    const user = {
      uid: firebaseUid || account.uid || normalizedEmail,
      email: normalizedEmail,
      role: account.role,
      portal: portalForRole(account.role),
      scope: portalForRole(account.role),
      loginPortal: loginPortalForRole(account.role),
      organizationId: organizationIdForAccount(account),
      createdAt: new Date().toISOString(),
      approved: true,
      active: true,
      accountStatus: "active",
      emailVerified: true,
      accountApproved: true,
      accountActive: true,
      dealershipId: account.dealershipId || null,
      bankId: account.bankId || null,
      branchId: account.branchId || null,
      portalType: account.portalType || null,
      accountType: account.accountType || null,
      status: account.status || "active",
      firstLoginRequired: firstLoginRequiredFor(account),
      passwordChangedAt: lifecycle.passwordChangedAt,
      passwordExpiresAt: lifecycle.passwordExpiresAt,
      passwordExpired: lifecycle.passwordExpired,
      passwordDaysRemaining: lifecycle.passwordDaysRemaining,
      lastLoginAt: new Date().toISOString(),
      dealershipName: account.dealershipName || null,
      dealerCity: account.dealerCity || account.city || null,
      bankName: account.bankName || account.companyName || null,
      bankIfsc: account.bankIfsc || account.ifsc || account.ifscCode || null,
      bankBranchLocation: account.bankBranchLocation || account.branchLocation || account.branchCity || account.city || null,
      profile: registrationProfile(account),
    };
    Object.assign(user, await dealershipEntitlement(account, normalizedEmail));
    Object.assign(user, onboardingStatusForUser(user, account));
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
        return res.json({ exists: true, ...wrongLoginPortalPayload() });
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

export async function session(req, res, next) {
  try {
    const email = String(req.user?.email || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ message: "Invalid session" });
    res.json({ user: sessionUserFromAuthenticatedRequest(req) });
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

export async function approvePendingGoogleAccount(req, res, next) {
  try {
    const request = await getRecord("pendingGoogleAccounts", req.params.id);
    if (!request) return res.status(404).json({ message: "Pending account not found" });
    const role = String(req.body.role || request.requestedRole || "").trim();
    if (!ROLE_ROUTES[role]) return res.status(400).json({ message: "Valid role is required" });
    const user = {
      uid: request.email,
      email: request.email,
      role,
      approved: true,
      active: true,
      dealershipId: req.body.dealershipId || null,
      bankId: req.body.bankId || null,
      branchId: req.body.branchId || null,
      status: "active",
    };
    await assertNoActiveIdentityCollision({ uid: user.uid, email: user.email, role: user.role, excludeIds: [user.uid, user.email] });
    await upsertCanonicalUser(user.uid, user);
    await setFirebaseClaims(request.email, user);
    const updated = await updateRecord("pendingGoogleAccounts", request.id, { status: "approved", assignedRole: role, approvedBy: req.user?.email, approvedAt: new Date().toISOString() });
    res.json({ message: "Account approved", request: updated });
  } catch (error) {
    next(error);
  }
}

export async function rejectPendingGoogleAccount(req, res, next) {
  try {
    const reason = String(req.body.reason || "").trim();
    if (!reason) return res.status(400).json({ message: "Rejection reason is required" });
    const request = await getRecord("pendingGoogleAccounts", req.params.id);
    if (!request) return res.status(404).json({ message: "Pending account not found" });
    const updated = await updateRecord("pendingGoogleAccounts", request.id, { status: "rejected", rejectionReason: reason, rejectedBy: req.user?.email, rejectedAt: new Date().toISOString() });
    res.json({ message: "Account rejected", request: updated });
  } catch (error) {
    next(error);
  }
}
