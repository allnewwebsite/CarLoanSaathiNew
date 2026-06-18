import {
  activateApprovedBankUsers,
  activateDealerAccessFromRequest,
  addTimelineEvent,
  ADMIN_SHARED_SENTINEL,
  approvalLog,
  approvalStatusOf,
  approveBankBackrefs,
  approveBankBranchAdmin,
  approveDealershipBackrefs,
  assertNoActiveIdentityCollision,
  assertValidStatusTransition,
  boundedList,
  cached,
  candidateRecordsByQueries,
  clearAdminApprovalCaches,
  clearCachedValue,
  clearLeadMutationCaches,
  computeLeadMetrics,
  countRecords,
  createNotification,
  createRecord,
  deactivateBankBranchAdmin,
  dealerEventPayload,
  dealerIdentityProfile,
  deleteFirebaseAuthByEmail,
  deleteMatchingRecords,
  deleteRecord,
  deleteRecordsByQuery,
  ecosystemLimit,
  ensureCommissionForLead,
  enrichAdminLeadRows,
  filterLeads,
  finalApprovalStatus,
  findRecordsByField,
  firebaseAdmin,
  firebaseUidForEmail,
  firestoreNotFound,
  freezePartner,
  getAdminBankBranches,
  getAuditLogs,
  getBankBranchDetailsAdmin,
  getLeadDetailProjection,
  getRecord,
  getWorkflowSettings,
  incrementPlatformCounters,
  incrementRecord,
  initializeDealershipTrial,
  initializeProfessionalSubscriptionPending,
  isProfessionalPlan,
  leadDetailResponseFromProjection,
  LEAD_STATUSES,
  listRecords,
  listRecentRecords,
  logError,
  logInfo,
  materializeApprovedBank,
  materializeApprovedDealership,
  normalizeEmail,
  normalizeIfsc,
  normalizeOnboardingPlan,
  normalizeStatus,
  pendingApprovalStatus,
  publishDealerEvent,
  publishRealtimeEvent,
  queryAllLeads,
  queryLeadProjectionForUser,
  queryRecords,
  queueDocumentsRequiredWhatsApp,
  queueStatusUpdatedWhatsApp,
  REALTIME_EVENTS,
  recordDealerSignal,
  recordMonitoringSignal,
  registerBankBranchAdmin,
  rejectBankBranchAdmin,
  requestLoginEmail,
  resolveDealershipApprovalRequest,
  revokeUserSessions,
  runAdminSideEffects,
  safeAdminUser,
  safeDealershipApprovalRecord,
  safeDocument,
  safeLoginActivity,
  STATUS_LABELS,
  syncLeadProjectionSoon,
  TIMELINE_EVENTS,
  today,
  updateBankBranchAdmin,
  updateRecord,
  updateRecordIfExists,
  updateWorkflowSettings,
  upsertCanonicalUser,
  upsertRecord,
  validateBankLocation,
  writeAuditLog,
} from './adminShared.controller.js';
import {
  bankApprovalListPayload,
  dealershipApprovalListPayload,
} from "./adminApprovalLists.controller.js";

void ADMIN_SHARED_SENTINEL;
export async function getPendingDealershipApprovals(req, res, next) {
  try {
    const status = String(req.query.status || "pending").trim().toLowerCase();
    const search = String(req.query.search || "").trim().toLowerCase();
    const payload = await cached(`admin:approvals:dealerships:${JSON.stringify({ status, search, cursor: req.query.cursor || "", limit: req.query.limit || 100 })}`, 10000, () => dealershipApprovalListPayload({ status, search, query: req.query }));
    res.json(payload);
  } catch (error) {
    next(error);
  }
}

export async function getPendingBankApprovals(req, res, next) {
  try {
    const status = String(req.query.status || "pending").trim().toLowerCase();
    const search = String(req.query.search || "").trim().toLowerCase();
    const payload = await cached(`admin:approvals:banks:${JSON.stringify({ status, search, cursor: req.query.cursor || "", limit: req.query.limit || 100 })}`, 10000, () => bankApprovalListPayload({ status, search, query: req.query }));
    res.json(payload);
  } catch (error) {
    next(error);
  }
}

export async function getApprovalLogs(req, res, next) {
  try {
    const status = String(req.query.status || "").trim().toLowerCase();
    const entityType = String(req.query.entityType || "").trim().toLowerCase();
    const page = await queryRecords("approvalLogs", {
      ...(entityType ? { where: [{ field: "entityType", value: entityType }] } : {}),
      orderBy: "createdAt",
      direction: "desc",
      limit: req.query.limit || 100,
      maxLimit: 100,
    });
    const logs = page.data.filter((item) => {
      const statusOk = !status || String(item.newStatus || "").toLowerCase() === status;
      const typeOk = !entityType || String(item.entityType || "").toLowerCase() === entityType;
      return statusOk && typeOk;
    });
    res.json({ data: logs, nextCursor: page.nextCursor, hasMore: page.hasMore });
  } catch (error) {
    next(error);
  }
}

export async function approveDealershipApproval(req, res, next) {
  try {
    const request = await resolveDealershipApprovalRequest(req.params.id);
    if (!request) return res.status(404).json({ message: "Dealership approval request not found" });
    const requestStatus = String(request.status || request.approvalStatus || "pending").toLowerCase();
    if (requestStatus === "approved") return res.status(409).json({ message: "Dealership is already approved" });
    if (requestStatus !== "pending") return res.status(400).json({ message: "Application is not pending" });
    const now = new Date().toISOString();
    const loginEmail = requestLoginEmail(request);
    if (!loginEmail) return res.status(400).json({ message: "Dealership login email is missing" });
    const selectedPlan = normalizeOnboardingPlan(request.selectedPlan || request.dealership?.selectedPlan);
    const dealership = {
      ...stripRemovedDealershipFields(request.dealership || {}),
      loginEmail,
      primaryGoogleEmail: request.primaryGoogleEmail || loginEmail,
      status: "approved",
      active: true,
      approved: true,
      accountActive: true,
      verified: true,
      dealershipVerified: true,
      approvedAt: now,
      approvedBy: req.user?.email || "super-admin",
      onboardingRequestId: request.onboardingRequestId || request.id,
      selectedPlan,
      subscriptionAccessStatus: isProfessionalPlan(selectedPlan) ? "PAYMENT_REQUIRED" : "TRIAL_ACTIVE",
    };
    const approvedBy = req.user?.email || "super-admin";
    await materializeApprovedDealership({ request, loginEmail, dealership });
    const subscription = isProfessionalPlan(selectedPlan)
      ? await initializeProfessionalSubscriptionPending({
          dealershipId: loginEmail,
          dealership,
          approvedAt: now,
          actor: req.user,
        })
      : await initializeDealershipTrial({
          dealershipId: loginEmail,
          dealership,
          approvedAt: now,
          actor: req.user,
        });
    const updated = await approveDealershipBackrefs({ request, loginEmail, now, approvedBy });
    await approvalLog({ req, entityType: "dealership", entityId: request.id, previousStatus: request.status, newStatus: "approved" });
    await incrementPlatformCounters({ activeDealerships: 1, approvedDealerships: 1, pendingDealerships: -1 });
    const dealerPayload = dealerEventPayload({ loginEmail, dealership, status: "approved" });
    recordDealerSignal("DEALER-APPROVED", dealerPayload);
    publishDealerEvent(REALTIME_EVENTS.DEALER_APPROVED, req, dealerPayload);
    const approvalMessage = isProfessionalPlan(selectedPlan)
      ? `${request.dealershipName} approved. Complete Professional Plan payment to activate dashboard access.`
      : `${request.dealershipName} approved. Your 60-day trial is active.`;
    await createNotification({ type: "dealership-approved", title: "Dealership approved", message: approvalMessage, recipientRole: "finance-desk", recipientId: loginEmail, dealerEmail: loginEmail, phoneNumber: request.dealership?.officialDealershipMobile || request.owner?.mobile, meta: { dealershipName: request.dealershipName, selectedPlan } });
    await writeAuditLog({ req, actionType: "ADMIN_APPROVAL", oldValue: request.status, newValue: "approved", meta: { approvalId: request.id, loginEmail, selectedPlan } });
    clearAdminApprovalCaches();
    res.json({
      message: "Dealership approved",
      subscription,
      request: safeDealershipApprovalRecord(updated || { ...request, status: "approved", approvalStatus: "approved", approvedAt: now }),
    });
  } catch (error) {
    next(error);
  }
}

export async function rejectDealershipApproval(req, res, next) {
  try {
    const reason = String(req.body.reason || "").trim();
    if (!reason) return res.status(400).json({ message: "Rejection reason is required" });
    const request = await resolveDealershipApprovalRequest(req.params.id);
    if (!request) return res.status(404).json({ message: "Dealership approval request not found" });
    const now = new Date().toISOString();
    const updated = await updateRecordIfExists("pendingDealershipApprovals", request.id, { status: "rejected", rejectedAt: now, rejectedBy: req.user?.email || "super-admin", rejectionReason: reason });
    if (request.onboardingRequestId) await updateRecordIfExists("onboardingRequests", request.onboardingRequestId, { status: "Rejected", active: false, rejectionReason: reason });
    if (request.pendingDealerAccountId || request.pendingDealerRegistrationId) await updateRecordIfExists("pendingDealerAccounts", request.pendingDealerAccountId || request.pendingDealerRegistrationId, { registrationSubmitted: true, approvalStatus: "rejected", accountApproved: false, accountActive: false, rejectionReason: reason, rejectedAt: now, rejectedBy: req.user?.email || "super-admin" });
    const queueItem = await firstAdminLookup([
      () => findRecordsByField("dealerApprovalQueue", "pendingDealershipApprovalId", request.id, 5),
      () => findRecordsByField("dealerApprovalQueue", "pendingDealerAccountId", request.pendingDealerAccountId || request.pendingDealerRegistrationId, 5),
    ]);
    if (queueItem) await updateRecordIfExists("dealerApprovalQueue", queueItem.id, { status: "rejected", approvalStatus: "rejected", rejectionReason: reason, rejectedAt: now, rejectedBy: req.user?.email || "super-admin" });
    await approvalLog({ req, entityType: "dealership", entityId: request.id, previousStatus: request.status, newStatus: "rejected", rejectionReason: reason });
    await incrementPlatformCounters({ pendingDealerships: -1 });
    await createNotification({ type: "dealership-rejected", title: "Dealership rejected", message: reason, recipientRole: "finance-desk", recipientId: request.loginEmail, dealerEmail: request.loginEmail, phoneNumber: request.dealership?.officialDealershipMobile || request.owner?.mobile, priority: "high", meta: { dealershipName: request.dealershipName, reason } });
    await writeAuditLog({ req, actionType: "DEALERSHIP_REJECTED", oldValue: request.status, newValue: "rejected", meta: { approvalId: request.id, reason } });
    clearAdminApprovalCaches();
    res.json({ message: "Dealership rejected", request: safeDealershipApprovalRecord(updated || { ...request, status: "rejected", rejectionReason: reason, rejectedAt: now }) });
  } catch (error) {
    next(error);
  }
}

export async function suspendDealershipApproval(req, res, next) {
  try {
    const reason = String(req.body.reason || "Suspended by Super Admin").trim();
    const request = await resolveDealershipApprovalRequest(req.params.id);
    if (!request) return res.status(404).json({ message: "Dealership approval request not found" });
    const loginEmail = requestLoginEmail(request);
    const now = new Date().toISOString();

    const updated = await updateRecordIfExists("pendingDealershipApprovals", request.id, {
      status: "suspended",
      approvalStatus: "suspended",
      suspensionReason: reason,
      suspendedAt: now,
      suspendedBy: req.user?.email || "super-admin",
    });

    if (loginEmail) {
      await upsertRecord("dealerships", loginEmail, { status: "suspended", active: false, approved: true, accountActive: false, suspensionReason: reason, suspendedAt: now });
      await upsertRecord("dealers", loginEmail, { status: "suspended", active: false, accountActive: false, suspensionReason: reason, suspendedAt: now });
      await upsertRecord("users", loginEmail, { uid: loginEmail, email: loginEmail, role: "finance-desk", approved: true, active: false, accountActive: false, dealershipId: loginEmail, status: "suspended" });
    }
    if (request.generalManager?.email) {
      await upsertRecord("users", request.generalManager.email, { uid: request.generalManager.email, email: request.generalManager.email, role: "gm", approved: true, active: false, accountActive: false, dealershipId: loginEmail, status: "suspended" });
    }
    if (request.onboardingRequestId) await updateRecordIfExists("onboardingRequests", request.onboardingRequestId, { status: "Suspended", active: false, accountActive: false, suspensionReason: reason });
    const pendingAccountId = request.pendingDealerAccountId || request.pendingDealerRegistrationId;
    if (pendingAccountId) await updateRecordIfExists("pendingDealerAccounts", pendingAccountId, { approvalStatus: "suspended", accountApproved: false, accountActive: false, suspensionReason: reason, suspendedAt: now, suspendedBy: req.user?.email || "super-admin" });
    const queueItem = await firstAdminLookup([
      () => findRecordsByField("dealerApprovalQueue", "pendingDealershipApprovalId", request.id, 5),
      () => findRecordsByField("dealerApprovalQueue", "pendingDealerAccountId", pendingAccountId, 5),
    ]);
    if (queueItem) await updateRecordIfExists("dealerApprovalQueue", queueItem.id, { status: "suspended", approvalStatus: "suspended", suspensionReason: reason, suspendedAt: now, suspendedBy: req.user?.email || "super-admin" });
    await approvalLog({ req, entityType: "dealership", entityId: request.id, previousStatus: request.status, newStatus: "suspended", rejectionReason: reason });
    await incrementPlatformCounters({ activeDealerships: -1, disabledDealerships: 1 });
    const dealerPayload = dealerEventPayload({ loginEmail, dealership: request.dealership || request, status: "disabled" });
    recordDealerSignal("DEALER-DISABLED", dealerPayload);
    publishDealerEvent(REALTIME_EVENTS.DEALER_DISABLED, req, dealerPayload);
    await writeAuditLog({ req, actionType: "DEALERSHIP_SUSPENDED", oldValue: request.status, newValue: "suspended", meta: { approvalId: request.id, reason } });
    clearAdminApprovalCaches();
    res.json({ message: "Dealership suspended", request: safeDealershipApprovalRecord(updated || { ...request, status: "suspended", suspensionReason: reason, suspendedAt: now }) });
  } catch (error) {
    next(error);
  }
}

export async function approveBankApproval(req, res, next) {
  try {
    const request = await getRecord("pendingBankApprovals", req.params.id);
    if (!request) return res.status(404).json({ message: "Bank approval request not found" });
    const requestStatus = approvalStatusOf(request);
    if (requestStatus === "approved") return res.status(409).json({ message: "Bank branch is already approved" });
    if (!pendingApprovalStatus(request)) return res.status(400).json({ message: "Application is not pending" });
    const now = new Date().toISOString();
    const bankEmail = normalizeEmail(request.email || request.officialEmail || request.primaryGoogleEmail || request.managerEmail);
    if (!bankEmail) return res.status(400).json({ message: "Bank manager email is missing on this approval request" });
    const bankName = String(request.bankName || request.companyName || request.name || "Bank Branch").trim();
    const branchLocationInput = String(request.bankBranchLocation || request.branchLocation || request.branchName || request.city || "").trim();
    const ifsc = normalizeIfsc(request.branchIfsc || request.ifsc || request.ifscCode || request.bankIfsc);
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return res.status(400).json({ message: "Valid IFSC code is required before bank approval" });
    const location = validateBankLocation({ state: request.state || "Haryana", location: branchLocationInput });
    if (!location.valid) return res.status(400).json({ message: "Supported state and bank branch location are required before approval" });
    const existingBranch = await getRecord("branches", ifsc).catch(() => null)
      || await getRecord("banks", ifsc).catch(() => null)
      || await getRecord("bankPartners", ifsc).catch(() => null);
    if (existingBranch && String(existingBranch.id || existingBranch.bankId || "") !== ifsc) {
      return res.status(409).json({ message: "This IFSC is already registered to another branch.", code: "DUPLICATE_IFSC" });
    }
    const branchLocation = location.location;
    const branchId = ifsc || `${bankEmail}:${branchLocation}`;
    const partnerId = branchId;
    const approvedBy = req.user?.email || "super-admin";
    await materializeApprovedBank({ request, bankEmail, bankName, branchLocation, state: location.state, ifsc, branchId, partnerId, now, approvedBy });
    await activateApprovedBankUsers({ request, bankEmail, bankName, branchLocation, state: location.state, ifsc, partnerId });
    const updated = await approveBankBackrefs({ request, bankEmail, bankName, branchLocation, partnerId, now, approvedBy });
    await approvalLog({ req, entityType: "bank", entityId: request.id, previousStatus: request.status, newStatus: "approved" });
    await incrementPlatformCounters({ bankPartners: 1, activeBanks: 1, totalBranches: 1 });
    recordMonitoringSignal("BRANCH-CREATED", {
      collection: "branches",
      projectionId: ifsc,
      bankId: partnerId,
      branchId: ifsc,
      state: location.state,
      location: branchLocation,
      capacityRange: request.monthlyLoanCapacity || null,
    });
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.BRANCH_CREATED,
      actor: req.user,
      data: {
        publicCatalog: true,
        bankEvent: {
          bankId: partnerId,
          bankName,
          branchIfsc: ifsc,
          branchLocation,
          state: location.state,
          status: "active",
        },
        bankId: partnerId,
        branchId: ifsc,
        ifscCode: ifsc,
      },
    });
    await createNotification({ type: "bank-approved", title: "Bank branch approved", message: `${bankName} ${branchLocation} branch approved. Login access is active.`, recipientRole: "bank-manager", recipientId: bankEmail, partnerId: partnerId, phoneNumber: request.mobile, meta: { bankName, city: branchLocation, bankBranchLocation: branchLocation } });
    await writeAuditLog({ req, actionType: "BANK_APPROVED", oldValue: request.status, newValue: "approved", meta: { approvalId: request.id, bankId: partnerId } });
    clearAdminApprovalCaches();
    res.json({ message: "Bank approved", request: updated || { ...request, status: "approved", approvedAt: now } });
  } catch (error) {
    next(error);
  }
}

export async function rejectBankApproval(req, res, next) {
  try {
    const reason = String(req.body.reason || "").trim();
    if (!reason) return res.status(400).json({ message: "Rejection reason is required" });
    const request = await getRecord("pendingBankApprovals", req.params.id);
    if (!request) return res.status(404).json({ message: "Bank approval request not found" });
    const bankEmail = normalizeEmail(request.email || request.officialEmail || request.primaryGoogleEmail || request.managerEmail);
    const now = new Date().toISOString();
    const updated = await updateRecordIfExists("pendingBankApprovals", request.id, { status: "rejected", rejectedAt: now, rejectedBy: req.user?.email || "super-admin", rejectionReason: reason });
    const pendingBankAccount = await firstAdminLookup([
      () => getRecord("pendingBankAccounts", bankEmail),
      () => findRecordsByField("pendingBankAccounts", "email", bankEmail, 5),
      () => findRecordsByField("pendingBankAccounts", "approvalRequestId", request.id, 5),
    ]);
    if (pendingBankAccount) await updateRecordIfExists("pendingBankAccounts", pendingBankAccount.id, { approvalStatus: "rejected", accountApproved: false, accountActive: false, rejectionReason: reason, rejectedAt: now, rejectedBy: req.user?.email || "super-admin" });
    await approvalLog({ req, entityType: "bank", entityId: request.id, previousStatus: request.status, newStatus: "rejected", rejectionReason: reason });
    await createNotification({ type: "bank-rejected", title: "Bank branch rejected", message: reason, recipientRole: "bank-manager", recipientId: bankEmail, partnerId: bankEmail, phoneNumber: request.mobile, priority: "high", meta: { bankName: request.bankName || request.companyName, reason } });
    await writeAuditLog({ req, actionType: "BANK_REJECTED", oldValue: request.status, newValue: "rejected", meta: { approvalId: request.id, reason } });
    clearAdminApprovalCaches();
    res.json({ message: "Bank rejected", request: updated || { ...request, status: "rejected", rejectedAt: now, rejectionReason: reason } });
  } catch (error) {
    next(error);
  }
}

export async function suspendBankApproval(req, res, next) {
  try {
    const reason = String(req.body.reason || "Suspended by Super Admin").trim();
    const request = await getRecord("pendingBankApprovals", req.params.id);
    if (!request) return res.status(404).json({ message: "Bank approval request not found" });
    const now = new Date().toISOString();
    const bankId = normalizeIfsc(request.branchIfsc || request.ifsc || request.ifscCode || request.bankIfsc) || request.email;
    const bankEmail = normalizeEmail(request.email || request.officialEmail || request.primaryGoogleEmail || request.managerEmail);
    const updated = await updateRecordIfExists("pendingBankApprovals", request.id, {
      status: "suspended",
      approvalStatus: "suspended",
      suspensionReason: reason,
      suspendedAt: now,
      suspendedBy: req.user?.email || "super-admin",
    });
    if (bankId) {
      await Promise.all([
        upsertRecord("bankPartners", bankId, { status: "suspended", active: false, accountActive: false, suspensionReason: reason, suspendedAt: now }),
        upsertRecord("banks", bankId, { status: "suspended", active: false, approvalStatus: "suspended", suspensionReason: reason, suspendedAt: now }),
        upsertRecord("branches", bankId, { status: "suspended", active: false, publicStatus: "suspended", suspensionReason: reason, suspendedAt: now }),
        ...(bankEmail ? [
          upsertRecord("branchManagers", bankEmail, { email: bankEmail, bankId, branchId: bankId, status: "suspended", active: false, accountActive: false, suspensionReason: reason, suspendedAt: now }),
          upsertRecord("users", bankEmail, { uid: bankEmail, email: bankEmail, role: "bank-manager", approved: true, active: false, accountActive: false, bankId, branchId: bankId, status: "suspended" }),
        ] : []),
      ]);
    }
    const pendingBankAccount = await firstAdminLookup([
      () => getRecord("pendingBankAccounts", request.email),
      () => findRecordsByField("pendingBankAccounts", "email", request.email, 5),
      () => findRecordsByField("pendingBankAccounts", "approvalRequestId", request.id, 5),
    ]);
    if (pendingBankAccount) await updateRecordIfExists("pendingBankAccounts", pendingBankAccount.id, { approvalStatus: "suspended", accountApproved: false, accountActive: false, suspensionReason: reason, suspendedAt: now, suspendedBy: req.user?.email || "super-admin" });
    recordMonitoringSignal("BRANCH-DISABLED", {
      collection: "branches",
      projectionId: bankId,
      bankId,
      branchId: bankId,
      state: request.state || "",
      location: request.bankBranchLocation || request.branchLocation || "",
    });
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.BRANCH_DISABLED,
      actor: req.user,
      data: {
        publicCatalog: true,
        bankEvent: {
          bankId,
          bankName: request.bankName || request.companyName || "",
          branchIfsc: bankId,
          branchLocation: request.bankBranchLocation || request.branchLocation || "",
          state: request.state || "",
          status: "suspended",
        },
        bankId,
        branchId: bankId,
        ifscCode: bankId,
      },
    });
    clearAdminApprovalCaches();
    res.json({ message: "Bank suspended", request: updated || { ...request, status: "suspended", suspendedAt: now, suspensionReason: reason } });
    runAdminSideEffects("bank-suspended", [
      () => approvalLog({ req, entityType: "bank", entityId: request.id, previousStatus: request.status, newStatus: "suspended", rejectionReason: reason }),
      () => incrementPlatformCounters({ bankPartners: -1, activeBanks: -1, disabledBranches: 1 }),
      () => writeAuditLog({ req, actionType: "BANK_SUSPENDED", oldValue: request.status, newValue: "suspended", meta: { approvalId: request.id, reason } }),
    ]);
  } catch (error) {
    next(error);
  }
}
