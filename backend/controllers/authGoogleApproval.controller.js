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

void AUTH_SHARED_SENTINEL;
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
