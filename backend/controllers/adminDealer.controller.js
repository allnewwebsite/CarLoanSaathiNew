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

void ADMIN_SHARED_SENTINEL;
export async function deleteDealershipPermanently(req, res, next) {
  try {
    const id = String(req.params.id || "").trim();
    const [onboardingRequest, pendingCandidates] = await Promise.all([
      getRecord("onboardingRequests", id).catch(() => null),
      candidateRecordsByQueries("pendingDealershipApprovals", [id], [[{ field: "onboardingRequestId", value: id }]]),
    ]);
    const approvalRequest = pendingCandidates.find((item) => item.id === id || item.onboardingRequestId === id);
    const request = onboardingRequest || approvalRequest || await getRecord("dealerships", id) || await getRecord("approvedDealerships", id);
    if (!request) return res.status(404).json({ message: "Dealership record not found" });

    const loginEmail = requestLoginEmail(request) || normalizeEmail(id);
    const gmEmail = normalizeEmail(request.generalManager?.email);
    const ownerEmail = normalizeEmail(request.owner?.email);
    const financeEmail = normalizeEmail(request.financeDesk?.officialEmail);
    const emails = new Set([loginEmail, gmEmail, ownerEmail, financeEmail].filter(Boolean));
    const now = new Date().toISOString();
    const deleted = {};
    const matchesDealer = (item) => {
      const values = [
        item.id,
        item.email,
        item.uid,
        item.loginEmail,
        item.primaryGoogleEmail,
        item.dealerEmail,
        item.dealershipEmail,
        item.officialEmail,
        item.officialDealershipEmail,
        item.createdBy,
        item.dealershipId,
        item.pendingDealerAccountId,
        item.pendingDealerRegistrationId,
        item.pendingDealershipApprovalId,
        item.approvalRequestId,
        item.onboardingRequestId,
      ].map(normalizeEmail);
      return values.some((value) => emails.has(value) || value === id || value === onboardingRequest?.id || value === approvalRequest?.id);
    };

    const directIds = [
      ["onboardingRequests", onboardingRequest?.id || id],
      ["pendingDealershipApprovals", approvalRequest?.id],
      ["dealerships", loginEmail],
      ["approvedDealerships", loginEmail],
      ["dealers", loginEmail],
      ["users", loginEmail],
      ["users", gmEmail],
      ["financeDesk", loginEmail],
      ["financeDesks", loginEmail],
      ["dealershipManagers", `${loginEmail}:owner`],
      ["dealershipManagers", `${loginEmail}:gm`],
      ["dealerRegistrations", loginEmail],
    ].filter(([, docId]) => docId);

    for (const [collection, docId] of directIds) {
      await deleteRecord(collection, docId);
      deleted[collection] = (deleted[collection] || 0) + 1;
    }

    const indexedDealerQueries = [
      ...[...emails].flatMap((email) => [
        [{ field: "email", value: email }],
        [{ field: "uid", value: email }],
        [{ field: "loginEmail", value: email }],
        [{ field: "primaryGoogleEmail", value: email }],
        [{ field: "dealerEmail", value: email }],
        [{ field: "dealershipEmail", value: email }],
        [{ field: "officialEmail", value: email }],
        [{ field: "officialDealershipEmail", value: email }],
        [{ field: "createdBy", value: email }],
        [{ field: "dealershipId", value: email }],
      ]),
      onboardingRequest?.id ? [{ field: "onboardingRequestId", value: onboardingRequest.id }] : null,
      approvalRequest?.id ? [{ field: "pendingDealershipApprovalId", value: approvalRequest.id }] : null,
      approvalRequest?.id ? [{ field: "approvalRequestId", value: approvalRequest.id }] : null,
      id ? [{ field: "pendingDealerAccountId", value: id }] : null,
      id ? [{ field: "pendingDealerRegistrationId", value: id }] : null,
    ].filter(Boolean);

    for (const collection of [
      "pendingDealerAccounts",
      "pendingGoogleAccounts",
      "dealerApprovalQueue",
      "dealerRegistrations",
      "dealerRegistrationDocuments",
      "dealerDocuments",
      "dealershipManagers",
      "financeDesk",
      "financeDesks",
      "users",
      "notifications",
      "cityMappings",
    ]) {
      deleted[collection] = (deleted[collection] || 0) + await deleteMatchingRecords(collection, matchesDealer, indexedDealerQueries);
    }

    const authDeleted = {};
    for (const email of emails) {
      await revokeUserSessions(email, "dealership-permanent-delete").catch(() => {});
      authDeleted[email] = await deleteFirebaseAuthByEmail(email);
    }

    await approvalLog({ req, entityType: "dealership", entityId: id, previousStatus: request.status || "unknown", newStatus: "deleted", rejectionReason: "Permanently deleted by Super Admin" });
    await incrementPlatformCounters({ activeDealerships: -1, disabledDealerships: 1 });
    const dealerPayload = dealerEventPayload({ loginEmail, dealership: request.dealership || request, status: "deleted" });
    recordDealerSignal("DEALER-DISABLED", dealerPayload);
    publishDealerEvent(REALTIME_EVENTS.DEALER_DISABLED, req, dealerPayload);
    await writeAuditLog({ req, actionType: "DEALERSHIP_DELETED_PERMANENTLY", oldValue: request.status || "", newValue: "deleted", meta: { id, loginEmail, deleted, authDeleted, deletedAt: now } });
    clearAdminApprovalCaches();
    res.json({ message: "Dealership permanently deleted", id, loginEmail, deleted, authDeleted });
  } catch (error) {
    next(error);
  }
}
