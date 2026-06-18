import {
  dealershipEntitlement,
  firstLoginRequiredFor,
  loginPortalForRole,
  onboardingStatusForUser,
  organizationIdForAccount,
  portalForRole,
  registrationProfile,
} from "./authShared.controller.js";

export async function buildSessionUserFromAccount({
  account,
  email,
  firebaseUid = "",
  portal = "",
  lifecycle,
  accountApproved = undefined,
  includeAccountSource = false,
}) {
  const user = {
    uid: firebaseUid || account.uid || email,
    email,
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
    accountApproved: accountApproved ?? account.accountApproved === true,
    accountActive: true,
    dealershipId: account.dealershipId || null,
    bankId: account.bankId || null,
    branchId: account.branchId || null,
    portalType: account.portalType || (includeAccountSource ? portal : null),
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

  if (includeAccountSource) {
    user.accountSource = account.accountSource || "users";
    user.accountSourceId = account.accountSourceId || null;
  }

  Object.assign(user, await dealershipEntitlement(account, email));
  Object.assign(user, onboardingStatusForUser(user, account));
  return user;
}
