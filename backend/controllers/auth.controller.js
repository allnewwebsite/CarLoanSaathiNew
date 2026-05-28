import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { jwtSecret, superAdminEmail } from "../config/env.js";
import { firebaseAdmin } from "../firebase/admin.js";
import { createRecord, getRecord, listRecords, updateRecord, upsertRecord } from "../services/firestore.service.js";
import { writeAuditLog } from "../services/audit.service.js";

const ROLE_ROUTES = {
  "finance-desk": "/finance/dashboard",
  "gm-sm": "/gm/dashboard",
  "bank-manager": "/bank-manager/dashboard",
  "loan-executive": "/loan-executive/leads",
  "super-admin": "/admin/dashboard",
};
const PORTAL_ROLES = {
  dealer: ["finance-desk", "gm-sm"],
  bank: ["bank-manager", "loan-executive"],
  admin: ["super-admin"],
};
const ROLE_GUIDANCE = {
  "finance-desk": {
    roleLabel: "Finance Head",
    portalLabel: "Dealer Portal",
    redirectTo: "/dealer/login",
    actionLabel: "Go to Dealer Login",
  },
  "gm-sm": {
    roleLabel: "GM / SM",
    portalLabel: "Dealer Portal",
    redirectTo: "/dealer/login",
    actionLabel: "Go to Dealer Login",
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
    redirectTo: "/loan-executive/login",
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
  if (portal === "finance") return "dealer";
  if (portal === "executive") return "bank";
  if (portal === "super-admin") return "admin";
  return PORTAL_ROLES[portal] ? portal : "dealer";
}

function passwordChangeRouteForRole(role) {
  if (role === "loan-executive") return "/loan-executive/change-password";
  if (role === "gm-sm") return "/gm/change-password";
  if (role === "finance-desk") return "/finance/change-password";
  return "/change-password";
}

function authCookieEnabled() {
  return process.env.ENABLE_AUTH_COOKIES === "true";
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
  await upsertRecord("users", email, {
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
  const activeSessions = (await listRecords("userSessions")).filter((session) => session.email === user.email && session.revoked !== true);
  const sorted = activeSessions.sort((left, right) => String(right.loginAt || "").localeCompare(String(left.loginAt || "")));
  const revoke = sorted.slice(Math.max(MAX_CONCURRENT_SESSIONS - 1, 0));
  await Promise.all(revoke.map((session) => updateRecord("userSessions", session.id, {
    revoked: true,
    revokedAt: now,
    revokedReason: "concurrent-session-limit",
  }).catch(() => null)));
  await createRecord("userSessions", {
    id: sessionId,
    sessionId,
    email: user.email,
    role: user.role,
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
  return sessionId;
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
  const account = await getRecord("users", email);
  const attempts = Number(account?.failedLoginAttempts || 0) + 1;
  const lockedUntil = attempts >= MAX_FAILED_LOGINS ? lockUntilDate() : null;
  const update = {
    failedLoginAttempts: attempts,
    lastFailedLoginAt: new Date().toISOString(),
    ...(lockedUntil ? { lockedUntil, accountStatus: "locked" } : {}),
  };
  if (account) await upsertRecord("users", email, update);
  await writeLoginActivity({ email, role: account?.role || null, status: "denied", reason, req });
  return { attempts, locked: attempts >= MAX_FAILED_LOGINS, lockedUntil };
}

async function clearFailedLogin(email) {
  const account = await getRecord("users", email);
  if (!account) return;
  await upsertRecord("users", email, {
    failedLoginAttempts: 0,
    lockedUntil: null,
    accountStatus: account.role === "super-admin" || account.approved === true ? "active" : account.accountStatus || "pending",
  });
}

export async function revokeUserSessions(email, reason = "admin-revoked") {
  const now = new Date().toISOString();
  const sessions = (await listRecords("userSessions")).filter((session) => session.email === email && session.revoked !== true);
  await Promise.all(sessions.map((session) => updateRecord("userSessions", session.id, {
    revoked: true,
    revokedAt: now,
    revokedReason: reason,
  }).catch(() => null)));
  const account = await getRecord("users", email).catch(() => null);
  if (account) await upsertRecord("users", email, { sessionRevokedAt: now });
}

async function createPendingGoogleAccount({ decoded, portal, reason }) {
  const email = String(decoded.email || "").toLowerCase();
  const existing = (await listRecords("pendingGoogleAccounts")).find((item) => item.email === email && item.status === "pending");
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

async function accountForEmail(email, portal) {
  const adminEmail = superAdminEmail();
  if (portal === "admin" || email === adminEmail) {
    if (email !== adminEmail) return null;
    const adminUser = await getRecord("users", email);
    return adminUser?.role === "super-admin" ? adminUser : null;
  }
  const allowed = PORTAL_ROLES[portal] || [];
  const users = await listRecords("users");
  const approvedUser = users.find((item) => item.email === email && allowed.includes(item.role) && accountActive(item));
  if (approvedUser) return approvedUser;
  const candidates = [];
  if (allowed.includes("finance-desk")) {
    const financeDesks = await listRecords("financeDesks");
    const desk = financeDesks.find((item) => item.officialEmail === email || item.email === email || item.dealershipEmail === email || item.id === email);
    if (desk) candidates.push({
      role: "finance-desk",
      dealershipId: desk.dealershipEmail || desk.dealershipId || desk.id,
      status: desk.status || "active",
      active: desk.active !== false,
      approved: desk.approved !== false,
      accountApproved: desk.accountApproved !== false,
      accountActive: desk.accountActive !== false,
      firstLoginRequired: desk.firstLoginRequired === true,
    });
    const directDealership = await getRecord("dealerships", email) || await getRecord("approvedDealerships", email);
    const dealerships = directDealership ? [] : await listRecords("dealerships");
    const dealership = directDealership || dealerships.find((item) =>
      item.loginEmail === email
      || item.primaryGoogleEmail === email
      || item.officialDealershipEmail === email
      || item.id === email
    );
    if (dealership?.active !== false && dealership?.accountActive !== false && !["pending", "rejected", "suspended"].includes(String(dealership.status || "").toLowerCase())) {
      candidates.push({
        role: "finance-desk",
        dealershipId: dealership.loginEmail || dealership.id || email,
        status: "active",
        active: true,
        approved: true,
        accountApproved: true,
        accountActive: true,
      });
    }
  }
  if (allowed.includes("gm-sm")) {
    const managers = await listRecords("dealershipManagers");
    const manager = managers.find((item) => item.email === email && /gm|showroom|manager/i.test(item.role || ""));
    if (manager) candidates.push({
      role: "gm-sm",
      dealershipId: manager.dealershipEmail || manager.dealershipId,
      status: manager.status || "active",
      active: manager.active !== false,
      approved: manager.approved !== false,
      accountApproved: manager.accountApproved !== false,
      accountActive: manager.accountActive !== false,
      firstLoginRequired: manager.firstLoginRequired === true,
    });
  }
  if (allowed.includes("bank-manager")) {
    const managers = await listRecords("branchManagers");
    const manager = managers.find((item) => item.email === email || item.officialEmail === email || item.id === email);
    if (manager) candidates.push({
      role: "bank-manager",
      bankId: manager.bankPartnerId || manager.bankId || manager.bankName,
      branchId: manager.branchId || manager.branchCity || manager.bankBranchLocation,
      status: manager.status || "active",
      active: manager.active !== false,
      approved: manager.approved !== false,
      accountApproved: manager.accountApproved !== false,
      accountActive: manager.accountActive !== false,
    });

    const bankAccounts = await listRecords("pendingBankAccounts");
    const approvedBankAccount = bankAccounts.find((item) =>
      item.email === email
      && item.approvalStatus === "approved"
      && item.accountApproved === true
      && item.accountActive === true
    );
    if (approvedBankAccount) candidates.push({
      role: "bank-manager",
      bankId: approvedBankAccount.bankId || approvedBankAccount.bankData?.bankId || approvedBankAccount.email,
      branchId: approvedBankAccount.branchId || approvedBankAccount.bankData?.bankBranchLocation || approvedBankAccount.bankData?.branchLocation,
      status: "active",
      accountStatus: "active",
      active: true,
      approved: true,
      accountApproved: true,
      accountActive: true,
    });

    const bankApprovals = await listRecords("pendingBankApprovals");
    const approvedBankRequest = bankApprovals.find((item) =>
      (item.email === email || item.officialEmail === email || item.primaryGoogleEmail === email)
      && item.status === "approved"
    );
    if (approvedBankRequest) candidates.push({
      role: "bank-manager",
      bankId: approvedBankRequest.bankId || approvedBankRequest.email || approvedBankRequest.officialEmail || email,
      branchId: approvedBankRequest.bankBranchLocation || approvedBankRequest.branchLocation || approvedBankRequest.city,
      status: "active",
      accountStatus: "active",
      active: true,
      approved: true,
      accountApproved: true,
      accountActive: true,
    });
  }
  if (allowed.includes("loan-executive")) {
    const executives = await listRecords("loanExecutives");
    const executive = executives.find((item) => item.email === email || item.officialEmail === email || item.id === email);
    if (executive) candidates.push({
      role: "loan-executive",
      bankId: executive.bankPartnerId || executive.bankId || executive.bankName,
      branchId: executive.branchId || executive.branchCity || executive.bankBranchLocation,
      status: executive.status || "active",
      active: executive.active !== false,
      approved: executive.approved !== false,
      accountApproved: executive.accountApproved !== false,
      accountActive: executive.accountActive !== false,
      firstLoginRequired: executive.firstLoginRequired === true,
    });
  }
  return candidates[0] || null;
}

function portalForRole(role) {
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

async function accountForAnyPortal(email) {
  const [dealerAccount, bankAccount, adminAccount] = await Promise.all([
    accountForEmail(email, "dealer").catch(() => null),
    accountForEmail(email, "bank").catch(() => null),
    accountForEmail(email, "admin").catch(() => null),
  ]);
  if (dealerAccount || bankAccount || adminAccount) return dealerAccount || bankAccount || adminAccount;
  const directUser = await getRecord("users", email).catch(() => null);
  return directUser?.role ? directUser : null;
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

async function accountPresentation(email, account = {}) {
  const result = {};
  if (["finance-desk", "gm-sm"].includes(account.role)) {
    const dealershipId = account.dealershipId || email;
    const dealership = await getRecord("dealerships", dealershipId) || await getRecord("approvedDealerships", dealershipId);
    result.dealershipName = dealership?.dealershipName || dealership?.name || dealership?.dealershipBrand || "";
    result.dealerCity = dealership?.city || dealership?.dealershipCity || "";
  }
  if (["bank-manager", "loan-executive"].includes(account.role)) {
    const bankId = account.bankId || email;
    const [branchManager, bankPartner, bankApproval, executive] = await Promise.all([
      getRecord("branchManagers", email).catch(() => null),
      getRecord("bankPartners", bankId).catch(() => null),
      getRecord("pendingBankApprovals", bankId).catch(() => null),
      account.role === "loan-executive" ? getRecord("loanExecutives", email).catch(() => null) : Promise.resolve(null),
    ]);
    const profile = branchManager || executive || bankPartner || bankApproval || {};
    result.bankName = profile.bankName || profile.companyName || bankPartner?.bankName || bankPartner?.companyName || account.bankName || "";
    result.bankIfsc = profile.ifsc || profile.bankIfsc || profile.ifscCode || bankPartner?.ifsc || "";
    result.bankBranchLocation = profile.bankBranchLocation || profile.branchLocation || profile.branchCity || profile.city || account.branchId || "";
  }
  return result;
}

async function dealerRegistrationStatus(email) {
  const registrations = await listRecords("pendingDealerAccounts");
  const registration = registrations.find((item) => item.email === email);
  if (!registration) return null;
  const [onboardingRequests, approvalRequests] = await Promise.all([
    listRecords("onboardingRequests"),
    listRecords("pendingDealershipApprovals"),
  ]);
  const linkedOnboarding = onboardingRequests.find((item) =>
    item.id === registration.onboardingRequestId
    || item.loginEmail === email
    || item.primaryGoogleEmail === email
  );
  const linkedApproval = approvalRequests.find((item) =>
    item.id === registration.approvalRequestId
    || item.onboardingRequestId === registration.onboardingRequestId
    || item.loginEmail === email
    || item.primaryGoogleEmail === email
  );
  const dealership = await getRecord("dealerships", email) || await getRecord("approvedDealerships", email);
  return linkedOnboarding || linkedApproval || dealership ? registration : null;
}

async function bankRegistrationStatus(email) {
  const registrations = await listRecords("pendingBankAccounts");
  const registration = registrations.find((item) => item.email === email);
  if (!registration) {
    const approvals = await listRecords("pendingBankApprovals");
    const approval = approvals.find((item) => item.email === email || item.officialEmail === email || item.primaryGoogleEmail === email);
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
  const approvals = await listRecords("pendingBankApprovals");
  const approval = approvals.find((item) => item.id === registration.approvalRequestId || item.email === email || item.officialEmail === email || item.primaryGoogleEmail === email);
  const bankPartner = (await listRecords("bankPartners")).find((item) => item.email === email || item.officialEmail === email || item.id === email);
  const branchManager = (await listRecords("branchManagers")).find((item) => item.email === email || item.officialEmail === email || item.id === email);
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
  const registrations = await listRecords("pendingDealerAccounts");
  const registration = registrations.find((item) => item.email === dealershipEmail || item.email === email);
  const dealership = await getRecord("dealerships", dealershipEmail);
  const activeApprovedAccount = account?.approved === true
    && account?.active === true
    && account?.accountApproved === true
    && account?.accountActive === true;
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
    && !accountLocked(account)
    && account?.active !== false
    && account?.accountActive !== false
    && account?.approved !== false
    && !["pending", "rejected", "suspended", "inactive", "paused", "disabled", "removed"].includes(String(account?.accountStatus || "").toLowerCase())
    && !["pending", "rejected", "suspended", "inactive", "paused", "disabled", "removed"].includes(String(account?.status || "").toLowerCase());
}

async function setFirebaseClaims(email, user) {
  if (!firebaseAdmin) return;
  try {
    const firebaseUser = await firebaseAdmin.auth().getUserByEmail(email);
    await firebaseAdmin.auth().setCustomUserClaims(firebaseUser.uid, {
      role: user.role,
      approved: user.approved === true,
      active: user.active === true,
      dealershipId: user.dealershipId || null,
      bankId: user.bankId || null,
      branchId: user.branchId || null,
    });
  } catch {
    // Firebase user may not exist yet; claims will be applied after the account is activated.
  }
}

export async function login(req, res, next) {
  try {
    const { idToken } = req.body;
    const portal = normalizePortal(req.body.portal);
    if (!idToken) return res.status(400).json({ message: "Firebase authentication token is required" });
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });
    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    const normalizedEmail = String(decoded.email || "").trim().toLowerCase();
    if (!normalizedEmail) return res.status(400).json({ message: "Account email is required" });
    if (decoded.email_verified !== true) {
      await writeLoginActivity({ email: normalizedEmail, status: "denied", reason: "email-not-verified", req });
      return res.status(403).json({ message: "Please verify your email address before logging in.", code: "EMAIL_NOT_VERIFIED" });
    }
    const account = await accountForEmail(normalizedEmail, portal);
    if (accountLocked(account)) {
      await writeLoginActivity({ email: normalizedEmail, role: account?.role, status: "denied", reason: "account-locked", req });
      return res.status(423).json(accountLockedPayload(account));
    }
    if (!account || !ROLE_ROUTES[account.role]) {
      const knownAccount = await accountForAnyPortal(normalizedEmail);
      const knownPortal = portalForRole(knownAccount?.role);
      if (knownAccount?.role && knownPortal && knownPortal !== portal) {
        await writeLoginActivity({ email: normalizedEmail, role: knownAccount.role, status: "denied", reason: "wrong-portal", req });
        return res.status(403).json(wrongPortalPayload(knownAccount));
      }
      if (knownAccount?.role && knownPortal === portal && !accountActive(knownAccount)) {
        const inactive = inactiveAccountMessage(knownAccount);
        await writeLoginActivity({ email: normalizedEmail, role: knownAccount.role, status: "denied", reason: inactive.code.toLowerCase(), req });
        return res.status(inactive.code === "ACCOUNT_LOCKED" ? 423 : 403).json(inactive);
      }
      if (portal === "dealer") {
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
      if (portal === "bank") {
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
    if (!accountActive(account)) {
      const inactive = inactiveAccountMessage(account);
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: "inactive", req });
      return res.status(inactive.code === "ACCOUNT_LOCKED" ? 423 : 403).json(inactive);
    }
    if (portal === "dealer" && !account.dealershipId && account.role !== "super-admin") {
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: "dealership-id-missing", req });
      return res.status(403).json({ message: "Your dealership account is pending Super Admin approval." });
    }
    if (portal === "bank" && !account.bankId) {
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: "bank-id-missing", req });
      return res.status(403).json({ message: "Your bank account is pending Super Admin approval." });
    }
    if (portal === "dealer" && !(await approvedDealerAccess(normalizedEmail, account))) {
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
    const lifecycle = passwordLifecyclePatch(account);
    await persistPasswordLifecycleIfMissing(normalizedEmail, account, lifecycle);
    const user = {
      uid: normalizedEmail,
      email: normalizedEmail,
      role: account.role,
      approved: true,
      active: true,
      accountStatus: "active",
      emailVerified: true,
      accountApproved: ["dealer", "bank"].includes(portal) ? true : account.accountApproved === true,
      accountActive: true,
      dealershipId: account.dealershipId || null,
      bankId: account.bankId || null,
      branchId: account.branchId || null,
      status: account.status || "active",
      firstLoginRequired: firstLoginRequiredFor(account),
      passwordChangedAt: lifecycle.passwordChangedAt,
      passwordExpiresAt: lifecycle.passwordExpiresAt,
      passwordExpired: lifecycle.passwordExpired,
      passwordDaysRemaining: lifecycle.passwordDaysRemaining,
      lastLoginAt: new Date().toISOString(),
    };
    await upsertRecord("users", normalizedEmail, user);
    await clearFailedLogin(normalizedEmail);
    await setFirebaseClaims(normalizedEmail, user);
    const sessionId = await createUserSession({ req, user });
    user.sessionId = sessionId;
    const presentation = await accountPresentation(normalizedEmail, user);
    Object.assign(user, presentation);
    const token = jwt.sign(user, jwtSecret(), { expiresIn: "7d" });
    await writeLoginActivity({ email: normalizedEmail, role: user.role, status: "success", req });
    setAuthCookie(res, token);
    const forcedPasswordPath = passwordChangeRouteForRole(user.role);
    const redirectTo = user.firstLoginRequired === true || user.passwordExpired === true ? forcedPasswordPath : ROLE_ROUTES[user.role];
    res.json({
      token,
      user,
      redirectTo,
    });
  } catch (error) {
    next(error);
  }
}

export async function restoreSession(req, res, next) {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: "Firebase authentication token is required" });
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });
    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    const normalizedEmail = String(decoded.email || "").trim().toLowerCase();
    if (!normalizedEmail) return res.status(400).json({ message: "Account email is required" });
    if (decoded.email_verified !== true) {
      await writeLoginActivity({ email: normalizedEmail, status: "denied", reason: "restore-email-not-verified", req });
      return res.status(403).json({ message: "Please verify your email address before logging in.", code: "EMAIL_NOT_VERIFIED" });
    }

    const account = await accountForAnyPortal(normalizedEmail);
    if (!account?.role || !ROLE_ROUTES[account.role]) {
      await writeLoginActivity({ email: normalizedEmail, status: "denied", reason: "restore-account-not-approved", req });
      return res.status(403).json({ message: "Your account is awaiting approval.", code: "APPROVAL_PENDING" });
    }
    if (!accountActive(account)) {
      const inactive = inactiveAccountMessage(account);
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: `restore-${inactive.code.toLowerCase()}`, req });
      return res.status(inactive.code === "ACCOUNT_LOCKED" ? 423 : 403).json(inactive);
    }
    if (["finance-desk", "gm-sm"].includes(account.role) && !(await approvedDealerAccess(normalizedEmail, account))) {
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: "restore-dealer-approval-pending", req });
      return res.status(403).json({ message: "Your account is awaiting approval.", code: "APPROVAL_PENDING" });
    }
    if (["bank-manager", "loan-executive"].includes(account.role) && !account.bankId) {
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: "restore-bank-id-missing", req });
      return res.status(403).json({ message: "Your account is awaiting approval.", code: "APPROVAL_PENDING" });
    }

    const lifecycle = passwordLifecyclePatch(account);
    await persistPasswordLifecycleIfMissing(normalizedEmail, account, lifecycle);
    const user = {
      uid: normalizedEmail,
      email: normalizedEmail,
      role: account.role,
      approved: true,
      active: true,
      accountStatus: "active",
      emailVerified: true,
      accountApproved: true,
      accountActive: true,
      dealershipId: account.dealershipId || null,
      bankId: account.bankId || null,
      branchId: account.branchId || null,
      status: account.status || "active",
      firstLoginRequired: firstLoginRequiredFor(account),
      passwordChangedAt: lifecycle.passwordChangedAt,
      passwordExpiresAt: lifecycle.passwordExpiresAt,
      passwordExpired: lifecycle.passwordExpired,
      passwordDaysRemaining: lifecycle.passwordDaysRemaining,
      lastLoginAt: new Date().toISOString(),
    };
    await upsertRecord("users", normalizedEmail, user);
    await clearFailedLogin(normalizedEmail);
    await setFirebaseClaims(normalizedEmail, user);
    const sessionId = await createUserSession({ req, user });
    user.sessionId = sessionId;
    Object.assign(user, await accountPresentation(normalizedEmail, user));
    const token = jwt.sign(user, jwtSecret(), { expiresIn: "7d" });
    await writeLoginActivity({ email: normalizedEmail, role: user.role, status: "session-restored", req });
    setAuthCookie(res, token);
    const forcedPasswordPath = passwordChangeRouteForRole(user.role);
    res.json({
      token,
      user,
      redirectTo: user.firstLoginRequired === true || user.passwordExpired === true ? forcedPasswordPath : ROLE_ROUTES[user.role],
    });
  } catch (error) {
    next(error);
  }
}

export async function refreshSession(req, res, next) {
  try {
    const email = String(req.user?.email || req.user?.uid || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ message: "Invalid session", code: "INVALID_SESSION" });
    const account = await getRecord("users", email);
    if (!account?.role || !ROLE_ROUTES[account.role]) {
      return res.status(403).json({ message: "Account no longer exists", code: "ACCOUNT_DELETED" });
    }
    if (!accountActive(account)) {
      const inactive = inactiveAccountMessage(account);
      return res.status(inactive.code === "ACCOUNT_LOCKED" ? 423 : 403).json(inactive);
    }
    if (req.user.sessionId) {
      const sessionRecord = await getRecord("userSessions", req.user.sessionId).catch(() => null);
      if (!sessionRecord || sessionRecord.revoked === true || String(sessionRecord.email || "").toLowerCase() !== email || sessionRecord.role !== account.role) {
        return res.status(401).json({ message: "Session expired. Please login again.", code: "SESSION_EXPIRED" });
      }
    }
    const lifecycle = passwordLifecyclePatch(account);
    await persistPasswordLifecycleIfMissing(email, account, lifecycle);
    const user = {
      uid: account.uid || account.email || email,
      email,
      role: account.role,
      approved: account.approved === true,
      active: account.active !== false,
      accountStatus: account.accountStatus || account.status || "active",
      emailVerified: true,
      accountApproved: ["bank-manager", "loan-executive"].includes(account.role) ? account.accountApproved !== false : account.accountApproved === true || account.role === "super-admin",
      accountActive: account.accountActive !== false,
      dealershipId: account.dealershipId || null,
      bankId: account.bankId || null,
      branchId: account.branchId || null,
      status: account.status || "active",
      firstLoginRequired: firstLoginRequiredFor(account),
      passwordChangedAt: lifecycle.passwordChangedAt,
      passwordExpiresAt: lifecycle.passwordExpiresAt,
      passwordExpired: lifecycle.passwordExpired,
      passwordDaysRemaining: lifecycle.passwordDaysRemaining,
      sessionId: req.user.sessionId || null,
      lastLoginAt: account.lastLoginAt || null,
    };
    Object.assign(user, await accountPresentation(email, user));
    const token = jwt.sign(user, jwtSecret(), { expiresIn: "7d" });
    setAuthCookie(res, token);
    const forcedPasswordPath = passwordChangeRouteForRole(user.role);
    res.json({
      token,
      user,
      redirectTo: user.firstLoginRequired === true || user.passwordExpired === true ? forcedPasswordPath : ROLE_ROUTES[user.role],
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
    const portal = normalizePortal(req.body.portal);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter a valid email address." });
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });

    let firebaseUser = null;
    try {
      firebaseUser = await firebaseAdmin.auth().getUserByEmail(email);
    } catch (error) {
      if (error.code === "auth/user-not-found") return res.json({ exists: false, code: "NO_ACCOUNT", message: "No account found for this email." });
      throw error;
    }

    const account = await accountForAnyPortal(email);
    if (!account?.role) {
      return res.json({ exists: true, code: "ACCOUNT_NOT_APPROVED", message: "Your account exists but is awaiting approval from Super Admin." });
    }

    const accountPortal = portalForRole(account.role);
    if (accountPortal && accountPortal !== portal) return res.json({ exists: true, ...wrongPortalPayload(account) });
    if (firebaseUser.disabled === true) {
      return res.json({ exists: true, code: "ACCOUNT_DISABLED", message: "Your account has been temporarily disabled. Contact support." });
    }
    if (!accountActive(account)) return res.json({ exists: true, ...inactiveAccountMessage(account) });
    return res.json({ exists: true, code: "ACCOUNT_FOUND", role: account.role, correctPortal: accountPortal });
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
    const account = await getRecord("users", email);
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
    const email = String(req.user?.email || req.user?.uid || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ message: "Invalid session" });
    if (req.user?.role === "super-admin") return res.json({ user: req.user });

    const account = await getRecord("users", email);
    if (!account) {
      return res.status(403).json({ message: "Account no longer exists", code: "ACCOUNT_DELETED" });
    }

    if (["finance-desk", "gm-sm"].includes(account.role)) {
      const dealershipId = account.dealershipId || email;
      const dealership = await getRecord("dealerships", dealershipId) || await getRecord("approvedDealerships", dealershipId);
      const active = account.approved === true
        && account.active === true
        && account.accountApproved === true
        && account.accountActive === true
        && dealership
        && dealership.active !== false
        && dealership.accountActive !== false
        && !["pending", "rejected", "suspended", "deleted", "inactive"].includes(String(dealership.status || "").toLowerCase());
      if (!active) {
        return res.status(403).json({ message: "Dealer account is inactive or deleted", code: "DEALER_ACCOUNT_INACTIVE" });
      }
    }

    if (["bank-manager", "loan-executive"].includes(account.role)) {
      const active = account.approved === true
        && account.active === true
        && account.accountActive !== false
        && !["pending", "rejected", "suspended", "deleted", "inactive"].includes(String(account.status || "").toLowerCase());
      if (!active) {
        return res.status(403).json({ message: "Bank account is inactive or deleted", code: "BANK_ACCOUNT_INACTIVE" });
      }
    }

    const presentation = await accountPresentation(email, account);
    const lifecycle = passwordLifecyclePatch(account);
    await persistPasswordLifecycleIfMissing(email, account, lifecycle);
    res.json({
      user: {
        uid: account.uid || account.email,
        email: account.email,
        role: account.role,
        approved: account.approved === true,
        active: account.active !== false,
        accountApproved: ["bank-manager", "loan-executive"].includes(account.role) ? account.accountApproved !== false : account.accountApproved === true,
        accountActive: account.accountActive !== false,
        dealershipId: account.dealershipId || null,
        bankId: account.bankId || null,
        branchId: account.branchId || null,
        status: account.status || "active",
        firstLoginRequired: firstLoginRequiredFor(account),
        passwordChangedAt: lifecycle.passwordChangedAt,
        passwordExpiresAt: lifecycle.passwordExpiresAt,
        passwordExpired: lifecycle.passwordExpired,
        passwordDaysRemaining: lifecycle.passwordDaysRemaining,
        emailVerified: true,
        ...presentation,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function completeForcedPasswordChange(req, res, next) {
  try {
    const email = String(req.user?.email || req.user?.uid || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ message: "Invalid session" });
    const account = await getRecord("users", email);
    if (!account || !["loan-executive", "finance-desk", "gm-sm"].includes(account.role)) return res.status(403).json({ message: "This account cannot complete forced password change" });
    const now = new Date().toISOString();
    const passwordExpiresAt = addDays(new Date(now), PASSWORD_VALID_DAYS).toISOString();
    await upsertRecord("users", email, {
      ...account,
      firstLoginRequired: false,
      passwordChangedAt: now,
      passwordExpiresAt,
    });
    const linkedCollections = account.role === "loan-executive"
      ? ["loanExecutives"]
      : account.role === "finance-desk"
        ? ["financeDesks", "dealerStaff"]
        : ["dealershipManagers", "dealerStaff"];
    for (const collection of linkedCollections) {
      const record = await getRecord(collection, email).catch(() => null);
      if (record) {
        await upsertRecord(collection, email, {
          ...record,
          firstLoginRequired: false,
          passwordChangedAt: now,
          passwordExpiresAt,
        });
      }
    }
    await writeLoginActivity({ email, role: account.role, status: "password-changed", req });
    const user = {
      ...account,
      uid: account.uid || account.email || email,
      email,
      firstLoginRequired: false,
      passwordChangedAt: now,
      passwordExpiresAt,
      passwordExpired: false,
      passwordDaysRemaining: PASSWORD_VALID_DAYS,
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
    const activities = (await listRecords("loginActivity"))
      .filter((item) => item.email === email)
      .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
      .slice(0, 100);
    const sessions = (await listRecords("userSessions"))
      .filter((item) => item.email === email)
      .sort((left, right) => String(right.loginAt || "").localeCompare(String(left.loginAt || "")))
      .slice(0, 50);
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
    const request = (await listRecords("pendingGoogleAccounts")).find((item) => item.id === req.params.id);
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
    await upsertRecord("users", request.email, user);
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
    const request = (await listRecords("pendingGoogleAccounts")).find((item) => item.id === req.params.id);
    if (!request) return res.status(404).json({ message: "Pending account not found" });
    const updated = await updateRecord("pendingGoogleAccounts", request.id, { status: "rejected", rejectionReason: reason, rejectedBy: req.user?.email, rejectedAt: new Date().toISOString() });
    res.json({ message: "Account rejected", request: updated });
  } catch (error) {
    next(error);
  }
}
