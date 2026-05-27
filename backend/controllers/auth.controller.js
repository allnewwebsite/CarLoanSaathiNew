import jwt from "jsonwebtoken";
import { firebaseAdmin } from "../firebase/admin.js";
import { createRecord, getRecord, listRecords, updateRecord, upsertRecord } from "../services/firestore.service.js";

const ADMIN_EMAIL = "hydarkdevil@gmail.com";
const ROLE_ROUTES = {
  "finance-desk": "/finance/total-leads",
  "gm-sm": "/gm/total-leads",
  "bank-manager": "/bank-manager/dashboard",
  "loan-executive": "/loan-executive/dashboard",
  "super-admin": "/admin/dashboard",
};
const PORTAL_ROLES = {
  dealer: ["finance-desk", "gm-sm"],
  bank: ["bank-manager", "loan-executive"],
  admin: ["super-admin"],
};
const MAX_FAILED_LOGINS = Number(process.env.MAX_FAILED_LOGINS || 5);
const ACCOUNT_LOCK_MINUTES = Number(process.env.ACCOUNT_LOCK_MINUTES || 30);
const SESSION_COOKIE_NAME = "cls_session";

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

async function writeLoginActivity({ email, role = null, status, reason = "", req }) {
  return createRecord("loginActivity", {
    email,
    role,
    status,
    reason,
    ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
    userAgent: req.headers["user-agent"] || "",
  });
}

function lockUntilDate() {
  return new Date(Date.now() + ACCOUNT_LOCK_MINUTES * 60 * 1000).toISOString();
}

function accountLocked(account) {
  return account?.lockedUntil && new Date(account.lockedUntil).getTime() > Date.now();
}

async function incrementFailedLogin(email, req, reason = "firebase-auth-failed") {
  const account = await getRecord("users", email);
  const attempts = Number(account?.failedLoginAttempts || 0) + 1;
  const update = {
    failedLoginAttempts: attempts,
    lastFailedLoginAt: new Date().toISOString(),
    ...(attempts >= MAX_FAILED_LOGINS ? { lockedUntil: lockUntilDate(), accountStatus: "locked" } : {}),
  };
  if (account) await upsertRecord("users", email, update);
  await writeLoginActivity({ email, role: account?.role || null, status: "denied", reason, req });
  return { attempts, locked: attempts >= MAX_FAILED_LOGINS };
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
  if (portal === "admin" || email === ADMIN_EMAIL) {
    if (email !== ADMIN_EMAIL) return null;
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
    if (desk) candidates.push({ role: "finance-desk", dealershipId: desk.dealershipEmail || desk.id, status: desk.status || "active", active: desk.active !== false });
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
    if (manager) candidates.push({ role: "gm-sm", dealershipId: manager.dealershipEmail, status: manager.status || "active", active: manager.active !== false });
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
    });
  }
  return candidates[0] || null;
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
    && !["pending", "rejected", "suspended", "inactive", "paused"].includes(String(account?.accountStatus || "").toLowerCase())
    && !["pending", "rejected", "suspended", "inactive", "paused"].includes(String(account?.status || "").toLowerCase());
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
    const { idToken, portal = "dealer" } = req.body;
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
      return res.status(423).json({ message: "Account locked after repeated failed attempts. Try again later.", code: "ACCOUNT_LOCKED" });
    }
    if (!account || !ROLE_ROUTES[account.role]) {
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
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: "inactive", req });
      return res.status(403).json({
        message: portal === "dealer" ? "Please create your dealership account from Dealer Registration before using Dealer Login." : portal === "bank" ? "Please create your bank account from Bank Registration before using Bank Login." : "Your account is pending approval or inactive.",
        redirectTo: portal === "dealer" ? "/dealer-registration" : portal === "bank" ? "/bank-registration" : undefined,
        actionLabel: portal === "dealer" ? "Create Dealer Account" : portal === "bank" ? "Create Bank Account" : undefined,
      });
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
    if (account.role === "super-admin" && normalizedEmail !== ADMIN_EMAIL) {
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: "super-admin-restricted", req });
      return res.status(403).json({ message: "ACCESS DENIED" });
    }
    if (portal === "admin" && account.role !== "super-admin") {
      await writeLoginActivity({ email: normalizedEmail, role: account.role, status: "denied", reason: "admin-role-required", req });
      return res.status(403).json({ message: "ACCESS DENIED" });
    }
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
      lastLoginAt: new Date().toISOString(),
    };
    await upsertRecord("users", normalizedEmail, user);
    await clearFailedLogin(normalizedEmail);
    await setFirebaseClaims(normalizedEmail, user);
    const token = jwt.sign(user, process.env.JWT_SECRET || "development-secret", { expiresIn: "7d" });
    await writeLoginActivity({ email: normalizedEmail, role: user.role, status: "success", req });
    setAuthCookie(res, token);
    res.json({ token, user, redirectTo: ROLE_ROUTES[user.role] });
  } catch (error) {
    next(error);
  }
}

export async function recordLoginFailure(req, res, next) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter a valid email address." });
    const result = await incrementFailedLogin(email, req, req.body.reason || "firebase-auth-failed");
    res.json({ recorded: true, locked: result.locked });
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
    if (!accountActive(account)) return res.status(403).json({ message: "Your account is not active. Contact Super Admin.", code: "ACCOUNT_NOT_ACTIVE" });
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
        emailVerified: true,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function logout(req, res, next) {
  try {
    await writeLoginActivity({ email: req.user?.email || req.user?.uid, role: req.user?.role, status: "logout", req });
    clearAuthCookie(res);
    res.json({ message: "Logged out" });
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
