import {
  ACTIVE_EXPORT_SENTINEL,
  addTimelineEvent,
  anyMatch,
  applyFilters,
  assertBankRegistrationEmailVerified,
  assertLeadMutable,
  assertNoActiveIdentityCollision,
  assertValidStatusTransition,
  attachExecutiveMobile,
  AUDIT_ACTIONS,
  bankEmailPendingPayload,
  bankIdentity,
  bankManagerCanAccessLead,
  bankStatuses,
  cached,
  cleanText,
  clearBankSummaryCaches,
  clearCachedValue,
  clearExecutiveLeadAssignments,
  clearLeadDetailCaches,
  collectExecutiveLeads,
  countCanonicalBankExecutives,
  createNotification,
  createRecord,
  createShortLivedDocumentUrl,
  crypto,
  currentPartner,
  dealershipIdentityFromLead,
  deleteExecutiveSummaryProjection,
  deleteLeadDocument,
  deleteMatchingRecords,
  deleteRecord,
  deleteRecordsByQuery,
  documentBelongsToBank,
  documentBelongsToBranch,
  documentBelongsToExecutive,
  documentBelongsToLead,
  emitBankLeadAccessDenied,
  emitOperationalAlert,
  ensureCommissionForLead,
  EXECUTIVE_ACTIVE_LEAD_STATUSES,
  executiveBelongsToBank,
  executiveLeadSpecs,
  existingBranchForIfsc,
  firebaseAdmin,
  firebaseUserVerified,
  findRecordsByField,
  generateTemporaryPassword,
  getLeadDetailProjection,
  getRecord,
  getTimelineForLead,
  groupDealershipsFromLeads,
  hasMatchingScopeValues,
  hashTemporaryPassword,
  LEAD_DOCUMENT_FIELDS,
  LEAD_STATUSES,
  leadBankValues,
  leadBranchValues,
  leadDetailResponseFromProjection,
  leadText,
  listRecords,
  liveBankRegistrationForAccount,
  loanCapacityUpperBound,
  loanExecutiveCanAccessLead,
  logError,
  logInfo,
  logProjectionRead,
  logReadMetric,
  normalizeIfsc,
  normalizeLoanCapacity,
  normalizeStatus,
  pageResponse,
  paginationParams,
  partnerBankValues,
  partnerBranchValues,
  partnerCanAccessLead,
  projectedLeadHasRequiredBankScope,
  publishRealtimeEvent,
  queryBankDealershipProjection,
  queryBankLeads,
  queryExecutiveLeads,
  queryExecutiveSummaryProjection,
  queryLeadProjectionForUser,
  queryNotificationProjectionForUser,
  queryRecords,
  queryTimelineProjection,
  queueDocumentsRequiredWhatsApp,
  queueLeadAssignedWhatsApp,
  queueStatusUpdatedWhatsApp,
  reassignLeadToNextBranchExecutive,
  REALTIME_EVENTS,
  recordMonitoringSignal,
  recordOperationalEvent,
  requireAssignedLead,
  resolveBankExecutiveForMutation,
  revokeUserSessions,
  safeProjectionDocId,
  sameText,
  STATUS_LABELS,
  syncExecutiveSummaryProjection,
  syncExecutiveSummaryProjectionSoon,
  syncLeadDetailProjection,
  syncLeadProjection,
  syncLeadProjectionSoon,
  TIMELINE_EVENTS,
  updateRecord,
  uploadLeadDocument,
  upsertCanonicalUser,
  upsertRecord,
  userEmail,
  validateBankLocation,
  writeAuditLog,
} from './bankShared.controller.js';

void ACTIVE_EXPORT_SENTINEL;
export async function registerBankPartner(req, res, next) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Email is required" });
    const now = new Date().toISOString();
    await assertBankRegistrationEmailVerified({ uid: req.body.bankUid, email });
    let pendingAccount = await getRecord("pendingBankAccounts", email).catch(() => null)
      || (await findRecordsByField("pendingBankAccounts", "email", email, 3))[0]
      || null;
    if (!pendingAccount) {
      pendingAccount = await createRecord("pendingBankAccounts", {
        uid: req.body.bankUid || email,
        email,
        authProvider: "password",
        onboardingStarted: true,
        registrationSubmitted: false,
        approvalStatus: "not-submitted",
        accountState: "EMAIL_VERIFIED",
        emailVerified: true,
        accountApproved: false,
        accountActive: false,
      });
    }
    const live = await liveBankRegistrationForAccount(pendingAccount);
    if (!live.live && (pendingAccount.registrationSubmitted === true || pendingAccount.approvalStatus === "pending" || pendingAccount.approvalStatus === "approved")) {
      pendingAccount = await updateRecord("pendingBankAccounts", pendingAccount.id, {
        registrationSubmitted: false,
        approvalStatus: "not-submitted",
        accountApproved: false,
        accountActive: false,
        approvalRequestId: null,
        resetAfterRemovalAt: now,
      });
    }
    if (pendingAccount.approvalStatus === "approved" || pendingAccount.accountActive === true) {
      return res.status(400).json({ message: "This bank account is already approved." });
    }
    if (pendingAccount.registrationSubmitted === true || pendingAccount.approvalStatus === "pending") {
      return res.status(409).json({ message: "Your bank registration is already submitted and pending approval." });
    }

    const supportedBanks = Array.isArray(req.body.supportedBanks)
      ? req.body.supportedBanks
      : String(req.body.supportedBanks || "").split(",").map((item) => item.trim()).filter(Boolean);
    const bankBranchLocation = String(req.body.bankBranchLocation || req.body.branchLocation || req.body.city || "").trim();
    const ifsc = normalizeIfsc(req.body.branchIfsc || req.body.ifsc || req.body.ifscCode);
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
      return res.status(400).json({ message: "Valid IFSC code is required for branch registration" });
    }
    const location = validateBankLocation({ state: req.body.state || "Haryana", location: bankBranchLocation });
    if (!location.valid) {
      return res.status(400).json({ message: "Supported state and bank branch location are required" });
    }
    const monthlyLoanCapacity = normalizeLoanCapacity(req.body.monthlyLoanCapacity || req.body.approvalLimit);
    if (!monthlyLoanCapacity) {
      return res.status(400).json({ message: "Monthly loan capacity is required", code: "INVALID_LOAN_CAPACITY" });
    }
    const duplicate = await existingBranchForIfsc(ifsc);
    if (duplicate && !["rejected", "deleted", "removed"].includes(String(duplicate.status || duplicate.approvalStatus || "").toLowerCase())) {
      recordMonitoringSignal("IFSC-DUPLICATE", {
        collection: "branches",
        projectionId: ifsc,
        branchId: ifsc,
        state: location.state,
        location: location.location,
        reason: "registration_duplicate_ifsc",
      });
      return res.status(409).json({ message: "This IFSC is already registered or pending approval.", code: "DUPLICATE_IFSC" });
    }

    const request = await upsertRecord("pendingBankApprovals", ifsc, {
      id: ifsc,
      email,
      type: "bank",
      accountType: "bank",
      status: "pending",
      approvalStatus: "pending",
      companyName: String(req.body.companyName || "").trim(),
      bankName: String(req.body.bankName || req.body.companyName || req.body.supportedBanks?.[0] || "").trim(),
      ifsc,
      branchIfsc: ifsc,
      ifscCode: ifsc,
      bankIfsc: ifsc,
      branchLocation: location.location,
      bankBranchLocation: location.location,
      contactPerson: String(req.body.contactPerson || "").trim(),
      managerName: String(req.body.managerName || req.body.contactPerson || "").trim(),
      mobile: String(req.body.mobile || "").trim(),
      officialEmail: String(req.body.officialEmail || email).trim().toLowerCase(),
      state: location.state,
      executiveCount: String(req.body.executiveCount || "").trim(),
      monthlyLoanCapacity,
      supportedBanks,
      operatingCity: location.location,
      serviceArea: location.location,
      branchId: ifsc,
      bankId: ifsc,
      bankPartnerId: ifsc,
      approvalLimit: loanCapacityUpperBound(monthlyLoanCapacity),
      assignedManagers: Array.isArray(req.body.assignedManagers) ? req.body.assignedManagers : [],
      executives: Array.isArray(req.body.executives) ? req.body.executives : [],
      documents: Array.isArray(req.body.documents) ? req.body.documents : [],
      supportedBrands: ["All"],
      role: "bank-manager",
      createdAt: now,
      submittedAt: now,
    });
    await updateRecord("pendingBankAccounts", pendingAccount.id, {
      registrationSubmitted: true,
      approvalStatus: "pending",
      accountState: "PENDING_APPROVAL",
      emailVerified: true,
      accountApproved: false,
      accountActive: false,
      submittedAt: now,
      approvalRequestId: request.id,
      bankData: request,
    });

    res.status(201).json({ message: "Bank branch approval request submitted successfully.", status: "pending", approvalId: request.id });
  } catch (error) {
    next(error);
  }
}

export async function startBankRegistration(req, res, next) {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: "Firebase authentication token is required" });
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });
    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    const email = String(decoded.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Account email is required" });
    const emailVerified = await firebaseUserVerified(decoded, email);
    const now = new Date().toISOString();
    let existing = await getRecord("pendingBankAccounts", email).catch(() => null)
      || (await findRecordsByField("pendingBankAccounts", "email", email, 3))[0]
      || null;
    const live = existing ? await liveBankRegistrationForAccount(existing) : { live: false };
    if (existing && !live.live) {
      existing = await updateRecord("pendingBankAccounts", existing.id, {
        uid: decoded.uid || email,
        email,
        name: decoded.name || email,
        photoURL: decoded.picture || "",
        authProvider: "password",
        onboardingStarted: true,
        registrationSubmitted: false,
        approvalStatus: "not-submitted",
        accountState: emailVerified ? "REGISTRATION_STARTED" : "EMAIL_PENDING",
        emailVerified,
        accountApproved: false,
        accountActive: false,
        submittedAt: null,
        approvalRequestId: null,
        bankData: {},
        resetAfterRemovalAt: now,
        lastAuthAt: now,
      });
    }
    if (!emailVerified) {
      const pendingPayload = {
        uid: decoded.uid || email,
        email,
        name: decoded.name || email,
        photoURL: decoded.picture || "",
        authProvider: "password",
        onboardingStarted: true,
        registrationSubmitted: false,
        approvalStatus: "email-pending",
        accountState: "EMAIL_PENDING",
        emailVerified: false,
        accountApproved: false,
        accountActive: false,
        submittedAt: null,
        approvalRequestId: existing?.approvalRequestId || null,
        bankData: existing?.bankData || {},
        startedAt: existing?.startedAt || now,
        lastAuthAt: now,
      };
      const registration = existing ? await updateRecord("pendingBankAccounts", existing.id, pendingPayload) : await createRecord("pendingBankAccounts", pendingPayload);
      await upsertCanonicalUser(decoded.uid || email, {
        uid: decoded.uid || email,
        email,
        role: "bank-manager",
        approved: false,
        active: false,
        accountStatus: "email-pending",
        accountState: "EMAIL_PENDING",
        emailVerified: false,
        accountApproved: false,
        accountActive: false,
        dealershipId: null,
        bankId: null,
        createdAt: existing?.createdAt || now,
        lastLoginAt: null,
      });
      return res.json(bankEmailPendingPayload({ registrationId: registration.id, email }));
    }
    if (existing?.approvalStatus === "pending" && live.live) {
      await updateRecord("pendingBankAccounts", existing.id, { lastAuthAt: now });
      return res.json({ status: "submitted", approvalStatus: "pending", accountState: "PENDING_APPROVAL", registrationSubmitted: true, emailVerified: true, registrationId: existing.id, email, message: "Your bank registration is pending Super Admin approval.", redirectTo: "/bank-registration/pending" });
    }
    if (existing?.approvalStatus === "approved" && live.live) {
      return res.json({ status: "approved", approvalStatus: "approved", accountState: "APPROVED", registrationSubmitted: true, emailVerified: true, registrationId: existing.id, email, message: "Bank account already approved.", redirectTo: "/bank-registration/approved" });
    }
    const payload = {
      uid: decoded.uid || email,
      email,
      name: decoded.name || email,
      photoURL: decoded.picture || "",
      authProvider: "password",
      onboardingStarted: true,
      registrationSubmitted: false,
      approvalStatus: "not-submitted",
      accountState: "EMAIL_VERIFIED",
      emailVerified: true,
      accountApproved: false,
      accountActive: false,
      startedAt: existing?.startedAt || now,
      lastAuthAt: now,
      approvalRequestId: null,
      bankData: {},
    };
    const registration = existing ? await updateRecord("pendingBankAccounts", existing.id, payload) : await createRecord("pendingBankAccounts", payload);
    await assertNoActiveIdentityCollision({ uid: decoded.uid || email, email, role: "bank-manager", excludeIds: [] });
    await upsertCanonicalUser(decoded.uid || email, {
      uid: decoded.uid || email,
      email,
      role: "bank-manager",
      approved: false,
      active: false,
      accountStatus: "pending",
      accountState: "EMAIL_VERIFIED",
      emailVerified: true,
      accountApproved: false,
      accountActive: false,
      dealershipId: null,
      bankId: null,
      createdAt: existing?.createdAt || now,
      lastLoginAt: null,
    });
    res.json({ status: "account-created", approvalStatus: "not-submitted", accountState: "EMAIL_VERIFIED", registrationSubmitted: false, emailVerified: true, registrationId: registration.id, email, message: "Account created successfully. Continue bank registration.", redirectTo: "/bank-registration/form" });
  } catch (error) {
    recordOperationalEvent({
      type: "bank_lead_detail_fetch_failed",
      severity: error.status === 403 ? ALERT_SEVERITY.HIGH : ALERT_SEVERITY.MEDIUM,
      component: "bank-documents",
      message: "Bank lead detail fetch failed",
      entityId: req.params.id,
      requestId: req.requestId,
      meta: { status: error.status || 500, actor: userEmail(req), reason: error.message },
    }).catch(() => {});
    next(error);
  }
}

export async function getBankRegistrationStatus(req, res, next) {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: "Firebase authentication token is required" });
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });
    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    const email = String(decoded.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Account email is required" });
    const emailVerified = await firebaseUserVerified(decoded, email);
    const account = await getRecord("pendingBankAccounts", email).catch(() => null)
      || (await findRecordsByField("pendingBankAccounts", "email", email, 3))[0]
      || null;
    if (!emailVerified) {
      return res.json(bankEmailPendingPayload({ registrationId: account?.id || null, email }));
    }
    if (account && (account.emailVerified !== true || account.accountState === "EMAIL_PENDING" || account.approvalStatus === "email-pending")) {
      const nextApprovalStatus = account.registrationSubmitted === true ? "pending" : "not-submitted";
      await updateRecord("pendingBankAccounts", account.id, {
        emailVerified: true,
        accountState: "EMAIL_VERIFIED",
        approvalStatus: nextApprovalStatus,
        lastVerifiedAt: new Date().toISOString(),
      }).catch(() => null);
      account.emailVerified = true;
      account.accountState = "EMAIL_VERIFIED";
      account.approvalStatus = nextApprovalStatus;
    }
    const live = account ? await liveBankRegistrationForAccount(account) : { live: false };
    const active = live.branchManager?.active !== false && live.bankPartner?.active !== false;
    if (account?.approvalStatus === "approved" && account.accountApproved === true && account.accountActive === true && active) {
      return res.json({ status: "approved", approvalStatus: "approved", accountState: "APPROVED", registrationSubmitted: true, accountApproved: true, accountActive: true, emailVerified: true, email, redirectTo: "/bank-registration/approved", message: "Your bank account has been approved successfully by CarLoanSaathi." });
    }
    if (account?.registrationSubmitted === false || account?.approvalStatus === "not-submitted") {
      return res.json({ status: "not-submitted", approvalStatus: "not-submitted", accountState: "EMAIL_VERIFIED", registrationSubmitted: false, accountApproved: false, accountActive: false, emailVerified: true, email, registrationId: account.id, redirectTo: "/bank-registration/form", message: "Complete your bank registration form." });
    }
    if (!live.live) {
      return res.json({ status: "not-registered", approvalStatus: "not-registered", accountState: "REGISTRATION_STARTED", registrationSubmitted: false, accountApproved: false, accountActive: false, emailVerified: true, email, redirectTo: "/bank-registration", message: "No active bank registration was found for this account." });
    }
    res.json({
      status: account?.approvalStatus || "pending",
      approvalStatus: account?.approvalStatus || "pending",
      accountState: account?.approvalStatus === "rejected"
        ? "REJECTED"
        : account?.approvalStatus === "suspended"
          ? "SUSPENDED"
          : "PENDING_APPROVAL",
      registrationSubmitted: account?.registrationSubmitted !== false,
      accountApproved: account?.accountApproved === true,
      accountActive: account?.accountActive === true,
      emailVerified: true,
      email,
      registrationId: account?.id || null,
      redirectTo: account?.approvalStatus === "rejected"
        ? "/bank-registration/rejected"
        : account?.approvalStatus === "suspended"
          ? "/bank-registration/suspended"
          : "/bank-registration/pending",
      message: account?.approvalStatus === "rejected"
        ? account.rejectionReason || "Your bank registration was rejected."
        : account?.approvalStatus === "suspended"
          ? account.suspensionReason || "Your bank account is suspended."
          : "Your bank account is still pending approval from CarLoanSaathi.",
    });
  } catch (error) {
    next(error);
  }
}
