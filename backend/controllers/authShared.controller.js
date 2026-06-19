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
import { verifyTemporaryPassword } from "../services/temporaryPassword.service.js";
import { cached } from "../services/ttlCache.service.js";
import { onboardingStatusForUser } from "../services/onboarding.service.js";
import {
  accountEntitlementSnapshot,
  AUTH_ENTITLEMENT_CACHE_TTL_MS,
  dealershipEntitlement,
  entitlementRedirect,
  LOGIN_PORTAL_ROLES,
  loginPortalAllowsRole,
  loginPortalForRole,
  normalizeLoginPortal,
  normalizePortal,
  organizationIdForAccount,
  passwordChangeRouteForRole,
  PORTAL_ROLES,
  portalAllowsRole,
  portalForRole,
  ROLE_GUIDANCE,
  roleGuidance,
  ROLE_LOGIN_PORTALS,
  ROLE_ROUTES,
  wrongLoginPortalPayload,
  wrongPortalPayload,
} from "./authPortalShared.controller.js";
import {
  ACCOUNT_LOCK_MINUTES,
  accountLocked,
  accountLockedPayload,
  addDays,
  authCookieEnabled,
  authCookieOptions,
  browserFromAgent,
  clearAuthCookie,
  clearFailedLogin,
  clearFailedLoginForAccount,
  clearTransientLoginLock,
  createPendingGoogleAccount,
  createUserSession,
  deviceFromAgent,
  effectiveLockedUntil,
  enforceConcurrentSessionLimit,
  firstLoginRequiredFor,
  incrementFailedLogin,
  lockUntilDate,
  MAX_CONCURRENT_SESSIONS,
  MAX_FAILED_LOGINS,
  PASSWORD_VALID_DAYS,
  passwordLifecyclePatch,
  persistPasswordLifecycleIfMissing,
  revokeUserSessions,
  scheduleLoginMaintenance,
  SESSION_COOKIE_NAME,
  SESSION_TIMEOUT_HOURS,
  setAuthCookie,
  writeLoginActivity,
} from "./authSessionShared.controller.js";

export {
  jwt,
  crypto,
  jwtSecret,
  superAdminEmail,
  firebaseAdmin,
  createRecord,
  findRecordsByField,
  getRecord,
  queryRecords,
  updateRecord,
  upsertRecord,
  writeAuditLog,
  logError,
  logInfo,
  logWarn,
  activeIdentity,
  assertNoActiveIdentityCollision,
  clearIdentityCaches,
  findIdentityCandidates,
  resolveCanonicalIdentity,
  upsertCanonicalUser,
  getDealershipSubscription,
  verifyTemporaryPassword,
  cached,
  onboardingStatusForUser,
  accountEntitlementSnapshot,
  AUTH_ENTITLEMENT_CACHE_TTL_MS,
  dealershipEntitlement,
  entitlementRedirect,
  LOGIN_PORTAL_ROLES,
  loginPortalAllowsRole,
  loginPortalForRole,
  normalizeLoginPortal,
  normalizePortal,
  organizationIdForAccount,
  passwordChangeRouteForRole,
  PORTAL_ROLES,
  portalAllowsRole,
  portalForRole,
  ROLE_GUIDANCE,
  roleGuidance,
  ROLE_LOGIN_PORTALS,
  ROLE_ROUTES,
  wrongLoginPortalPayload,
  wrongPortalPayload,
  ACCOUNT_LOCK_MINUTES,
  accountLocked,
  accountLockedPayload,
  addDays,
  authCookieEnabled,
  authCookieOptions,
  browserFromAgent,
  clearAuthCookie,
  clearFailedLogin,
  clearFailedLoginForAccount,
  clearTransientLoginLock,
  createPendingGoogleAccount,
  createUserSession,
  deviceFromAgent,
  effectiveLockedUntil,
  enforceConcurrentSessionLimit,
  firstLoginRequiredFor,
  incrementFailedLogin,
  lockUntilDate,
  MAX_CONCURRENT_SESSIONS,
  MAX_FAILED_LOGINS,
  PASSWORD_VALID_DAYS,
  passwordLifecyclePatch,
  persistPasswordLifecycleIfMissing,
  revokeUserSessions,
  scheduleLoginMaintenance,
  SESSION_COOKIE_NAME,
  SESSION_TIMEOUT_HOURS,
  setAuthCookie,
  writeLoginActivity,
};

export const AUTH_DEALERSHIP_ACCESS_CACHE_TTL_MS = Number(process.env.AUTH_DEALERSHIP_ACCESS_CACHE_TTL_MS || 120_000);
export function lifecycleOverlay(base = {}, userRecord = {}) {
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

export async function identityContextFor(email, uid = "") {
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

export function canonicalFromContext(context = {}, { uid = "", portal = "" } = {}) {
  const normalizedUid = String(uid || "").trim();
  const activeCandidates = context.activeCandidates || [];
  if (!activeCandidates.length) return null;
  return activeCandidates.find((record) => normalizedUid && String(record.uid || "").trim() === normalizedUid)
    || activeCandidates.find((record) => portal && record.portalType === portal)
    || activeCandidates[0];
}

export async function accountWithUserLifecycle(email, account, identityContext = null) {
  if (!account) return null;
  const candidates = identityContext?.candidates || await findIdentityCandidates({ uid: account.uid, email }).catch(() => []);
  const userRecord = candidates
    .find((item) => item.role === account.role);
  return userRecord ? lifecycleOverlay(account, userRecord) : account;
}

export function emailMatchesRecord(record = {}, email) {
  const normalized = String(email || "").trim().toLowerCase();
  return [
    record.id,
    record.email,
    record.officialEmail,
    record.loginEmail,
    record.dealershipEmail,
  ].some((value) => String(value || "").trim().toLowerCase() === normalized);
}

export function uniqueAuthRecords(records = []) {
  const seen = new Set();
  return records.filter((record) => {
    const key = record?.id || `${record?.uid || ""}:${record?.email || ""}:${record?.role || ""}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function firstLookup(lookups = []) {
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

export function uidMatchesRecord(record = {}, email, uid) {
  if (!uid) return true;
  const recordUid = String(record.uid || record.authUid || "").trim();
  if (!recordUid) return true;
  return recordUid === uid || recordUid === email;
}

export async function updatePasswordLifecycleRecords(email, role, patch) {
  const linkedCollections = role === "loan-executive"
    ? ["loanExecutives"]
    : role === "bank-manager"
      ? ["branchManagers", "bankPartners", "banks"]
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

export async function accountForEmail(email, portal, uid = "", identityContext = null) {
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

export function inactiveAccountMessage(account = {}) {
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

export async function accountForAnyPortal(email, uid = "", { identityContext = null, skipPortals = [] } = {}) {
  const context = identityContext || await identityContextFor(email, uid);
  const skipped = new Set(skipPortals.filter(Boolean));
  const lookups = await Promise.all(["dealer", "bank", "admin"]
    .filter((portal) => !skipped.has(portal))
    .map((portal) => accountForEmail(email, portal, uid, context).catch(() => null)));
  const account = lookups.find(Boolean);
  if (account) return account;
  return context.candidates.find((item) => item.role && uidMatchesRecord(item, email, uid)) || null;
}

export function registrationProfile(account = {}) {
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

export function sessionUserFromAuthenticatedRequest(req, account = req.authAccount || {}, claims = req.authTokenClaims || {}) {
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

export async function dealerRegistrationStatus(email) {
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

export async function bankRegistrationStatus(email) {
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

export function bankLoginGate(registration) {
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

export async function approvedDealerAccess(email, account) {
  const dealershipEmail = String(account?.dealershipId || "").trim().toLowerCase();
  const loginEmail = String(email || "").trim().toLowerCase();
  const dealershipKeys = [...new Set([dealershipEmail, loginEmail].filter(Boolean))];
  const activeApprovedAccount = account?.approved === true
    && account?.active === true
    && account?.accountApproved === true
    && account?.accountActive === true;
  const [dealership, registration] = await Promise.all([
    cached(
      `auth:approved-dealership:${dealershipKeys.join("|")}`,
      AUTH_DEALERSHIP_ACCESS_CACHE_TTL_MS,
      async () => {
        for (const key of dealershipKeys) {
          const direct = await getRecord("dealerships", key).catch(() => null)
            || await getRecord("approvedDealerships", key).catch(() => null);
          if (direct) return direct;
        }
        for (const key of dealershipKeys) {
          const discovered = await firstLookup([
            () => findRecordsByField("dealerships", "loginEmail", key, 5),
            () => findRecordsByField("dealerships", "email", key, 5),
            () => findRecordsByField("approvedDealerships", "loginEmail", key, 5),
            () => findRecordsByField("approvedDealerships", "email", key, 5),
            () => findRecordsByField("approvedDealerships", "officialEmail", key, 5),
          ]).catch(() => null);
          if (discovered) return discovered;
        }
        return false;
      }
    ),
    activeApprovedAccount
      ? Promise.resolve(null)
      : firstLookup([
        () => getRecord("pendingDealerAccounts", dealershipEmail || loginEmail),
        () => findRecordsByField("pendingDealerAccounts", "email", dealershipEmail || loginEmail, 5),
        () => findRecordsByField("pendingDealerAccounts", "email", loginEmail, 5),
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

export function accountActive(account) {
  return Boolean(account?.role)
    && account?.active !== false
    && account?.accountActive !== false
    && account?.approved !== false
    && !["pending", "rejected", "suspended", "inactive", "paused", "disabled", "removed"].includes(String(account?.accountStatus || "").toLowerCase())
    && !["pending", "rejected", "suspended", "inactive", "paused", "disabled", "removed"].includes(String(account?.status || "").toLowerCase());
}

export function firebaseClaimsMatch(decoded = {}, user = {}) {
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

export async function setFirebaseClaims(identifier, user, { decoded = null } = {}) {
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

export function firebasePasswordErrorPayload(code = "") {
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

export function firebaseAuthReferers() {
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

export function isFirebaseRefererBlocked(data = {}) {
  const message = String(data?.error?.message || "").toUpperCase();
  const details = Array.isArray(data?.error?.details) ? data.error.details : [];
  const reason = details
    .map((detail) => String(detail?.reason || detail?.message || "").toUpperCase())
    .find(Boolean) || "";
  return message.includes("REFERER") || reason.includes("API_KEY_HTTP_REFERRER_BLOCKED");
}

export async function signInWithFirebasePassword(email, password) {
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

export async function signInWithTemporaryPasswordFallback(email, password) {
  if (!firebaseAdmin) return null;
  const candidates = await findIdentityCandidates({ email });
  const activeCandidates = candidates.filter(activeIdentity);
  if (activeCandidates.length > 1) {
    const error = new Error("Multiple active identities exist for this email. Contact support.");
    error.status = 409;
    error.code = "IDENTITY_COLLISION";
    throw error;
  }
  const account = activeCandidates.find((item) => (
    ["finance-desk", "gm", "loan-executive"].includes(item.role)
    && item.firstLoginRequired === true
    && !item.passwordChangedAt
    && item.temporaryPasswordHash
  ));
  if (!account || !verifyTemporaryPassword(password, account.temporaryPasswordHash)) return null;
  const firebaseUser = await firebaseAdmin.auth().getUserByEmail(email).catch(() => null);
  if (!firebaseUser || firebaseUser.disabled === true) return null;
  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email || email,
    email_verified: firebaseUser.emailVerified === true,
    temporaryPasswordFallback: true,
  };
}

export const AUTH_SHARED_SENTINEL = true;
