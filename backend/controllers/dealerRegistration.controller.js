import {
  addBankTieUp,
  addTimelineEvent,
  assertDealerRegistrationEmailVerified,
  assertNoActiveIdentityCollision,
  AUDIT_ACTIONS,
  branchIdsFromRequest,
  buildDealerStaffRows,
  cached,
  clearCachedValue,
  clearLeadSyncCaches,
  createRecord,
  dealerCanReadProjectedLead,
  dealerEmail,
  dealerEmailPendingPayload,
  deleteDealerStaffCollectionRecords,
  deleteMatchingRecords,
  deleteRecord,
  deleteRecordsByQuery,
  DEALER_SHARED_SENTINEL,
  financeDeskContext,
  financeDeskLeadSchema,
  financeManagerIdFrom,
  financeManagerRow,
  findDealerStaffEmployee,
  findRecordsByField,
  firebaseAdmin,
  firebaseUserVerified,
  generateLeadCaseId,
  generateTemporaryPassword,
  getAvailableBankBranches,
  getDealershipBankTieUps,
  getLeadDetailProjection,
  getRecord,
  hashTemporaryPassword,
  incrementDealerCounters,
  incrementRecord,
  leadDetailResponseFromProjection,
  LEAD_STATUSES,
  listRecords,
  liveDealerRegistrationForAccount,
  logError,
  logInfo,
  logProjectionRead,
  logReadMetric,
  mergeStaffRows,
  normalizeBankLocation,
  normalizeBankState,
  normalizeDealershipBrand,
  normalizeFinanceDeskLead,
  normalizeFinanceStatus,
  normalizeOnboardingPlan,
  normalizeStatus,
  normalizeStaffRole,
  optionalEmail,
  optionalText,
  owned,
  paginationParams,
  publishRealtimeEvent,
  queryDealershipLeads,
  queryLeadProjectionForUser,
  queryRecords,
  queryStaffViewProjection,
  queueLeadAssignedWhatsApp,
  readableLeadError,
  reassignLeadToNextBranchExecutive,
  REALTIME_EVENTS,
  recordMonitoringSignal,
  removeBankTieUp,
  required,
  requiredGstin,
  revokeUserSessions,
  runDealerLeadSideEffects,
  salespersonIdFrom,
  sanitizeFirestoreData,
  staffEmail,
  staffIdentifierMatches,
  staffListRow,
  staffRoleLabel,
  stripRemovedDealershipFields,
  syncLeadProjectionSoon,
  syncStaffViewProjectionSoon,
  TIMELINE_EVENTS,
  uniqueRecords,
  updateDealershipBankTieUps,
  updateRecord,
  upsertCanonicalUser,
  upsertRecord,
  validateBranchTieUp,
  validateDealerLeadAssignees,
  writeAuditLog,
} from './dealerShared.controller.js';

void DEALER_SHARED_SENTINEL;
export async function startDealerRegistration(req, res, next) {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: "Firebase authentication token is required" });
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });

    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    const email = String(decoded.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Account email is required" });
    const emailVerified = await firebaseUserVerified(decoded, email);

    const now = new Date().toISOString();
    const requestedPlan = normalizeOnboardingPlan(req.body.selectedPlan);
    let existing = await getRecord("pendingDealerAccounts", email).catch(() => null)
      || (await findRecordsByField("pendingDealerAccounts", "email", email, 3))[0]
      || null;
    const existingLive = existing ? await liveDealerRegistrationForAccount(existing) : { live: false };
    if (existing && !existingLive.live) {
      existing = await updateRecord("pendingDealerAccounts", existing.id, {
        uid: decoded.uid || email,
        email,
        name: decoded.name || email,
        photoURL: decoded.picture || "",
        authProvider: "password",
        onboardingStarted: true,
        registrationSubmitted: false,
        registrationCompleted: false,
        approvalStatus: "not-submitted",
        accountState: emailVerified ? "REGISTRATION_STARTED" : "EMAIL_PENDING",
        emailVerified,
        accountApproved: false,
        accountActive: false,
        submittedAt: null,
        dealershipData: {},
        documents: [],
        onboardingRequestId: null,
        approvalRequestId: null,
        dealerApprovalQueueId: null,
        selectedPlan: existing.selectedPlan || requestedPlan,
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
        registrationCompleted: false,
        approvalStatus: "email-pending",
        accountState: "EMAIL_PENDING",
        emailVerified: false,
        accountApproved: false,
        accountActive: false,
        submittedAt: null,
        dealershipData: existing?.dealershipData || {},
        documents: existing?.documents || [],
        onboardingRequestId: existing?.onboardingRequestId || null,
        approvalRequestId: existing?.approvalRequestId || null,
        dealerApprovalQueueId: existing?.dealerApprovalQueueId || null,
        selectedPlan: existing?.selectedPlan || requestedPlan,
        startedAt: existing?.startedAt || now,
        lastAuthAt: now,
      };
      const registration = existing
        ? await updateRecord("pendingDealerAccounts", existing.id, pendingPayload)
        : await createRecord("pendingDealerAccounts", pendingPayload);
      await upsertCanonicalUser(decoded.uid || email, {
        uid: decoded.uid || email,
        email,
        role: "finance-desk",
        approved: false,
        active: false,
        accountStatus: "email-pending",
        accountState: "EMAIL_PENDING",
        accountApproved: false,
        accountActive: false,
        emailVerified: false,
        dealershipId: null,
        bankId: null,
        createdAt: existing?.createdAt || now,
        lastLoginAt: null,
      });
      return res.json(dealerEmailPendingPayload({
        registrationId: registration.id,
        email,
        selectedPlan: registration.selectedPlan || requestedPlan,
      }));
    }

    if (existing?.approvalStatus === "approved" && existingLive.live) {
      return res.json({
        status: "approved",
        approvalStatus: "approved",
        accountState: "APPROVED",
        registrationSubmitted: true,
        emailVerified: true,
        registrationId: existing.id,
        email,
        message: "Account already exists.",
        redirectTo: "/dealer-registration/approved",
      });
    }

    if ((existing?.approvalStatus === "rejected" || existing?.approvalStatus === "suspended") && existingLive.live) {
      await updateRecord("pendingDealerAccounts", existing.id, { lastAuthAt: now });
      return res.json({
        status: existing.approvalStatus,
        approvalStatus: existing.approvalStatus,
        accountState: String(existing.approvalStatus).toUpperCase(),
        emailVerified: true,
        registrationId: existing.id,
        email,
        message: existing.rejectionReason || existing.suspensionReason || "Your dealership onboarding request cannot continue.",
        redirectTo: existing.approvalStatus === "rejected" ? "/dealer-registration/rejected" : "/dealer-registration/suspended",
      });
    }

    if (existing?.approvalStatus === "pending" && existingLive.live) {
      await updateRecord("pendingDealerAccounts", existing.id, { lastAuthAt: now });
      return res.json({
        status: "submitted",
        approvalStatus: "pending",
        accountState: "PENDING_APPROVAL",
        registrationSubmitted: true,
        emailVerified: true,
        registrationId: existing.id,
        email,
        message: "Your dealership onboarding request is pending Super Admin approval.",
        redirectTo: "/dealer-registration/pending",
      });
    }

    const payload = {
      uid: decoded.uid || email,
      email,
      name: decoded.name || email,
      photoURL: decoded.picture || "",
      authProvider: "password",
      onboardingStarted: true,
      registrationSubmitted: false,
      registrationCompleted: false,
      approvalStatus: "not-submitted",
      accountState: "EMAIL_VERIFIED",
      emailVerified: true,
      accountApproved: false,
      accountActive: false,
      submittedAt: null,
      startedAt: existing?.startedAt || now,
      lastAuthAt: now,
      dealershipData: {},
      documents: [],
      onboardingRequestId: null,
      approvalRequestId: null,
      dealerApprovalQueueId: null,
      selectedPlan: existing?.selectedPlan || requestedPlan,
    };
    const registration = existing
      ? await updateRecord("pendingDealerAccounts", existing.id, payload)
      : await createRecord("pendingDealerAccounts", payload);
    await assertNoActiveIdentityCollision({ uid: decoded.uid || email, email, role: "finance-desk", excludeIds: [] });
    await upsertCanonicalUser(decoded.uid || email, {
      uid: decoded.uid || email,
      email,
      role: "finance-desk",
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

    res.json({
      status: "account-created",
      approvalStatus: "not-submitted",
      accountState: "EMAIL_VERIFIED",
      registrationSubmitted: false,
      emailVerified: true,
      registrationId: registration.id,
      email,
      message: "Account created successfully. Continue dealership registration.",
      redirectTo: "/dealer-registration/form",
      selectedPlan: registration.selectedPlan || requestedPlan,
    });
  } catch (error) {
    next(error);
  }
}

export async function getDealerRegistrationStatus(req, res, next) {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: "Firebase authentication token is required" });
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });

    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    const email = String(decoded.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Account email is required" });

    const user = await getRecord("users", email).catch(() => null)
      || (await findRecordsByField("users", "email", email, 3))[0]
      || null;
    const dealershipEmail = user?.dealershipId || email;
    const account = await getRecord("pendingDealerAccounts", dealershipEmail).catch(() => null)
      || await getRecord("pendingDealerAccounts", email).catch(() => null)
      || (await findRecordsByField("pendingDealerAccounts", "email", dealershipEmail, 3))[0]
      || (await findRecordsByField("pendingDealerAccounts", "email", email, 3))[0]
      || null;

    if (!emailVerified) {
      return res.json(dealerEmailPendingPayload({
        registrationId: account?.id || null,
        email,
        selectedPlan: account?.selectedPlan || normalizeOnboardingPlan(),
      }));
    }

    if (account && (account.emailVerified !== true || account.accountState === "EMAIL_PENDING" || account.approvalStatus === "email-pending")) {
      const nextApprovalStatus = account.registrationSubmitted === true ? "pending" : "not-submitted";
      await updateRecord("pendingDealerAccounts", account.id, {
        emailVerified: true,
        accountState: "EMAIL_VERIFIED",
        approvalStatus: nextApprovalStatus,
        lastVerifiedAt: new Date().toISOString(),
      }).catch(() => null);
      account.emailVerified = true;
      account.accountState = "EMAIL_VERIFIED";
      account.approvalStatus = nextApprovalStatus;
    }

    const linkedOnboarding = account ? await getRecord("onboardingRequests", account.onboardingRequestId || "").catch(() => null)
      || (await findRecordsByField("onboardingRequests", "loginEmail", account.email, 3))[0]
      || (await findRecordsByField("onboardingRequests", "primaryGoogleEmail", account.email, 3))[0]
      || null : null;
    const linkedApproval = account ? await getRecord("pendingDealershipApprovals", account.approvalRequestId || "").catch(() => null)
      || (account.onboardingRequestId ? (await findRecordsByField("pendingDealershipApprovals", "onboardingRequestId", account.onboardingRequestId, 3))[0] : null)
      || (await findRecordsByField("pendingDealershipApprovals", "loginEmail", account.email, 3))[0]
      || (await findRecordsByField("pendingDealershipApprovals", "primaryGoogleEmail", account.email, 3))[0]
      || null : null;
    const dealership = await getRecord("dealerships", dealershipEmail) || await getRecord("approvedDealerships", dealershipEmail);
    const activeApprovedUser = user?.approved === true
      && user?.active === true
      && user?.accountApproved === true
      && user?.accountActive === true;
    const activeDealership = dealership
      && dealership.accountActive !== false
      && dealership.active !== false
      && !["pending", "rejected", "suspended", "deleted", "inactive"].includes(String(dealership.status || "").toLowerCase());
    const dealershipApprovedByAdmin = activeDealership
      && (dealership.approved === true || String(dealership.status || "").toLowerCase() === "approved");

    if (activeDealership && (account?.approvalStatus === "approved" || activeApprovedUser || dealershipApprovedByAdmin)) {
      if (account && account.approvalStatus !== "approved") {
        await updateRecord("pendingDealerAccounts", account.id, {
          approvalStatus: "approved",
          accountApproved: true,
          accountActive: true,
          registrationSubmitted: true,
          registrationCompleted: true,
        });
      }
      return res.json({
        status: "approved",
        approvalStatus: "approved",
        accountState: "APPROVED",
        registrationSubmitted: true,
        accountApproved: true,
        accountActive: true,
        emailVerified: true,
        email,
        dealershipEmail,
        message: "Your dealership account has been approved successfully by CarLoanSaathi.",
        redirectTo: "/dealer-registration/approved",
      });
    }

    if (account?.registrationSubmitted === false || account?.approvalStatus === "not-submitted") {
      return res.json({
        status: "not-submitted",
        approvalStatus: "not-submitted",
        accountState: "EMAIL_VERIFIED",
        registrationSubmitted: false,
        accountApproved: false,
        accountActive: false,
        emailVerified: true,
        email,
        registrationId: account.id,
        message: "Complete your dealership registration form.",
        redirectTo: "/dealer-registration/form",
      });
    }

    const hasLiveRegistrationRecord = Boolean(linkedOnboarding || linkedApproval || dealership);

    if (!hasLiveRegistrationRecord) {
      return res.json({
        status: "not-registered",
        approvalStatus: "not-registered",
        accountState: "REGISTRATION_STARTED",
        registrationSubmitted: false,
        accountApproved: false,
        accountActive: false,
        emailVerified: true,
        email,
        registrationId: null,
        message: "No active dealership registration was found for this account.",
        redirectTo: "/dealer-registration",
      });
    }

    if (!activeDealership && (user || dealership) && !account) {
      return res.json({
        status: "inactive",
        approvalStatus: "inactive",
        accountState: "DEACTIVATED",
        registrationSubmitted: false,
        accountApproved: false,
        accountActive: false,
        emailVerified: true,
        email,
        registrationId: null,
        message: "This dealership account is inactive or deleted.",
        redirectTo: "/dealer-registration",
      });
    }

    return res.json({
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
      message: account?.approvalStatus === "rejected"
        ? account.rejectionReason || "Your dealership registration was rejected."
        : account?.approvalStatus === "suspended"
          ? account.suspensionReason || "Your dealership account is suspended."
          : "Your dealership account is still pending approval from CarLoanSaathi.",
      redirectTo: account?.approvalStatus === "rejected"
        ? "/dealer-registration/rejected"
        : account?.approvalStatus === "suspended"
          ? "/dealer-registration/suspended"
          : "/dealer-registration/pending",
    });
  } catch (error) {
    next(error);
  }
}

export async function registerDealerOnboarding(req, res, next) {
  try {
    const loginEmail = required(req.body.primaryGoogleEmail || req.body.loginEmail, "Official login email").toLowerCase();
    const now = new Date().toISOString();
    await assertDealerRegistrationEmailVerified({ uid: req.body.dealerUid, email: loginEmail });
    const state = normalizeBankState(req.body.state || "Haryana");
    const city = normalizeBankLocation(state, req.body.city || req.body.dealerLocation || req.body.location);
    if (!state || !city) {
      return res.status(400).json({ message: "Dealer location is not supported for onboarding" });
    }
    const dealershipBrand = normalizeDealershipBrand(req.body.dealershipBrand);
    if (!dealershipBrand) {
      return res.status(400).json({ message: "Dealership brand is not supported" });
    }
    let pendingAccount = await getRecord("pendingDealerAccounts", req.body.registrationId || loginEmail).catch(() => null)
      || await getRecord("pendingDealerAccounts", req.body.dealerUid || "").catch(() => null)
      || (await findRecordsByField("pendingDealerAccounts", "email", loginEmail, 3))[0]
      || (req.body.dealerUid ? (await findRecordsByField("pendingDealerAccounts", "uid", req.body.dealerUid, 3))[0] : null)
      || null;
    if (!pendingAccount) {
      pendingAccount = await createRecord("pendingDealerAccounts", {
        uid: req.body.dealerUid || loginEmail,
        email: loginEmail,
        authProvider: "google",
        onboardingStarted: true,
        registrationSubmitted: false,
        approvalStatus: "not-submitted",
        accountState: "EMAIL_VERIFIED",
        emailVerified: true,
        accountApproved: false,
        accountActive: false,
        createdFromRegistrationSubmit: true,
        selectedPlan: normalizeOnboardingPlan(req.body.selectedPlan),
      });
    }
    const pendingAccountLive = await liveDealerRegistrationForAccount(pendingAccount);
    if (!pendingAccountLive.live && (pendingAccount.registrationSubmitted === true || pendingAccount.approvalStatus === "pending" || pendingAccount.approvalStatus === "approved")) {
      pendingAccount = await updateRecord("pendingDealerAccounts", pendingAccount.id, {
        registrationSubmitted: false,
        registrationCompleted: false,
        approvalStatus: "not-submitted",
        accountApproved: false,
        accountActive: false,
        submittedAt: null,
        dealershipData: {},
        documents: [],
        onboardingRequestId: null,
        approvalRequestId: null,
        dealerApprovalQueueId: null,
        resetAfterRemovalAt: now,
      });
    }
    if (pendingAccount.approvalStatus === "approved" || pendingAccount.accountActive === true) {
      return res.status(400).json({ message: "This dealership account is already approved." });
    }
    if (pendingAccount.registrationSubmitted === true || pendingAccount.approvalStatus === "pending") {
      return res.status(409).json({ message: "Your dealership registration is already submitted and pending approval." });
    }
    await assertNoActiveIdentityCollision({ uid: req.body.dealerUid || loginEmail, email: loginEmail, role: "finance-desk", excludeIds: [] });
    const selectedPlan = normalizeOnboardingPlan(pendingAccount.selectedPlan || req.body.selectedPlan);
    const dealership = {
      dealershipName: required(req.body.dealershipName, "Dealership name"),
      dealershipBrand,
      authorizedDealerCode: required(req.body.authorizedDealerCode, "Authorized dealer code"),
      gstinNumber: requiredGstin(req.body.gstinNumber || req.body.gstin || req.body.gstNumber),
      officialDealershipMobile: required(req.body.officialDealershipMobile, "Official dealership mobile"),
      state,
      city,
      location: city,
      pincode: required(req.body.pincode, "Pincode"),
      address: required(req.body.address, "Full dealership address"),
      landmark: String(req.body.landmark || "").trim(),
      monthlyCarSalesCapacity: required(req.body.monthlyCarSalesCapacity, "Monthly car sales capacity"),
      ...(optionalText(req.body.expectedMonthlyLoanApplications) ? { expectedMonthlyLoanApplications: optionalText(req.body.expectedMonthlyLoanApplications) } : {}),
      status: "Pending Approval",
      dealerId: loginEmail,
      dealerName: required(req.body.dealershipName, "Dealership name"),
      dealerBrand: dealershipBrand,
      dealerState: state,
      dealerLocation: city,
      dealerStatus: "pending",
      monthlySalesCapacity: required(req.body.monthlyCarSalesCapacity, "Monthly car sales capacity"),
      active: false,
      accountActive: false,
      approved: false,
      loginEmail,
      primaryGoogleEmail: loginEmail,
      createdAt: now,
      selectedPlan,
    };

    const documents = Array.isArray(req.body.documents) ? req.body.documents : [];
    const generalManager = [req.body.gmName, req.body.gmMobile, req.body.gmEmail].some((value) => optionalText(value))
      ? {
          name: optionalText(req.body.gmName),
          mobile: optionalText(req.body.gmMobile),
          email: optionalEmail(req.body.gmEmail),
        }
      : null;
    const financeDesk = [req.body.financeHeadName, req.body.financeHeadMobile, req.body.financeDeskEmail, req.body.financeTeamSize].some((value) => optionalText(value))
      ? {
          headName: optionalText(req.body.financeHeadName),
          headMobile: optionalText(req.body.financeHeadMobile),
          officialEmail: optionalEmail(req.body.financeDeskEmail) || loginEmail,
          teamSize: optionalText(req.body.financeTeamSize),
        }
      : null;
    const owner = {
      fullName: optionalText(req.body.ownerFullName) || dealership.dealershipName,
      mobile: optionalText(req.body.ownerMobile) || dealership.officialDealershipMobile,
      email: optionalEmail(req.body.ownerEmail) || loginEmail,
    };
    const registrationPayload = {
      type: "dealership",
      status: "Pending Approval",
      state,
      city,
      location: city,
      dealershipName: dealership.dealershipName,
      dealershipBrand: dealership.dealershipBrand,
      gstinNumber: dealership.gstinNumber,
      loginEmail,
      submittedAt: now,
      documents,
      dealership,
      owner,
      ...(generalManager ? { generalManager } : {}),
      ...(financeDesk ? { financeDesk } : {}),
      verification: {
        dealershipVerified: false,
      },
      selectedPlan,
    };

    const onboardingRequest = await createRecord("onboardingRequests", registrationPayload);

    const approval = await createRecord("pendingDealershipApprovals", {
      onboardingRequestId: onboardingRequest.id,
      pendingDealerAccountId: req.body.registrationId || null,
      type: "dealership",
      accountType: "dealership",
      status: "pending",
      state,
      city,
      location: city,
      dealershipName: dealership.dealershipName,
      dealershipBrand: dealership.dealershipBrand,
      gstinNumber: dealership.gstinNumber,
      loginEmail,
      primaryGoogleEmail: loginEmail,
      submittedAt: now,
      documents,
      dealership,
      owner: onboardingRequest.owner,
      ...(onboardingRequest.generalManager ? { generalManager: onboardingRequest.generalManager } : {}),
      ...(onboardingRequest.financeDesk ? { financeDesk: onboardingRequest.financeDesk } : {}),
      verification: registrationPayload.verification,
      selectedPlan,
    });

    const approvalQueue = await createRecord("dealerApprovalQueue", {
      ...registrationPayload,
      accountType: "dealership",
      pendingDealerAccountId: req.body.registrationId || null,
      pendingDealershipApprovalId: approval.id,
      approvalStatus: "pending",
      status: "pending",
      selectedPlan,
    });

    await updateRecord("pendingDealerAccounts", pendingAccount.id, {
      registrationSubmitted: true,
      approvalStatus: "pending",
      accountState: "PENDING_APPROVAL",
      emailVerified: true,
      accountApproved: false,
      accountActive: false,
      registrationCompleted: true,
      submittedAt: now,
      dealershipData: registrationPayload,
      documents,
      onboardingRequestId: onboardingRequest.id,
      approvalRequestId: approval.id,
      dealerApprovalQueueId: approvalQueue.id,
      selectedPlan,
    }, { readback: false });

    await upsertRecord("dealerRegistrations", req.body.dealerUid || loginEmail, {
      dealerUid: req.body.dealerUid || pendingAccount.uid || loginEmail,
      email: loginEmail,
      dealershipName: dealership.dealershipName,
      dealerBrand: dealership.dealershipBrand,
      state,
      city,
      dealerState: state,
      dealerLocation: city,
      mobile: dealership.officialDealershipMobile,
      registrationStatus: "pending-approval",
      submittedAt: now,
      selectedPlan,
    }, { readback: false });

    await upsertCanonicalUser(req.body.dealerUid || loginEmail, {
      uid: req.body.dealerUid || loginEmail,
      email: loginEmail,
      role: "finance-desk",
      approvalStatus: "pending",
      registrationCompleted: true,
      approved: false,
      active: false,
      accountApproved: false,
      accountActive: false,
      accountState: "PENDING_APPROVAL",
      emailVerified: true,
      dealershipId: loginEmail,
      status: "pending",
      selectedPlan,
    });

    await Promise.all(documents.map(async (document) => {
      const writes = [createRecord("dealerDocuments", {
        dealerEmail: loginEmail,
        approvalRequestId: approval.id,
        onboardingRequestId: onboardingRequest.id,
        type: document.type,
        fileName: document.fileName,
        size: document.size,
        status: "pending-verification",
      })];
      if (document.documentType || document.storagePath || document.fileUrl) {
        writes.push(upsertRecord("dealerRegistrationDocuments", `${req.body.dealerUid || loginEmail}:${document.documentType || document.type}`, {
          dealerUid: req.body.dealerUid || pendingAccount.uid || loginEmail,
          documentType: document.documentType || document.type,
          fileName: document.fileName,
          fileUrl: document.fileUrl || "",
          storagePath: document.storagePath || "",
          uploadedAt: now,
          verified: false,
        }, { readback: false }));
      }
      await Promise.all(writes);
    }));

    await incrementDealerCounters({ totalDealerships: 1, pendingDealerships: 1 });
    const dealerEvent = {
      dealerId: loginEmail,
      dealerName: dealership.dealershipName,
      dealerBrand: dealership.dealershipBrand,
      dealerState: state,
      dealerLocation: city,
      dealerStatus: "pending",
      monthlySalesCapacity: dealership.monthlyCarSalesCapacity,
    };
    recordMonitoringSignal("DEALER-CREATED", {
      dealerId: loginEmail,
      dealerBrand: dealership.dealershipBrand,
      state,
      location: city,
      monthlySalesCapacity: dealership.monthlyCarSalesCapacity,
    });
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.DEALER_CREATED,
      actor: req.user || null,
      data: {
        dealershipId: loginEmail,
        publicDealerCatalog: true,
        dealerEvent,
      },
    });
    await writeAuditLog({
      req,
      actionType: AUDIT_ACTIONS.REGISTRATION_COMPLETED,
      targetEntity: "dealershipRegistration",
      targetId: approval.id,
      newValue: { status: "pending", selectedPlan },
      meta: { dealershipId: loginEmail, onboardingRequestId: onboardingRequest.id, selectedPlan },
    });

    res.status(201).json({
      message: "Your dealership onboarding request has been submitted successfully. CarLoanSaathi verification team will review your application shortly.",
      status: "pending",
      onboardingRequestId: onboardingRequest.id,
      approvalRequestId: approval.id,
      selectedPlan,
    });
  } catch (error) {
    next(error);
  }
}
