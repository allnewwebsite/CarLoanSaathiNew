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
export async function deleteBankPermanently(req, res, next) {
  try {
    const id = String(req.params.id || "").trim();
    const request = await getRecord("pendingBankApprovals", id).catch(() => null)
      || await getRecord("bankPartners", id).catch(() => null)
      || await getRecord("banks", id).catch(() => null);
    if (!request) return res.status(404).json({ message: "Bank record not found" });

    const bankEmail = normalizeEmail(request.email || request.officialEmail || id);
    const bankName = String(request.bankName || request.companyName || request.name || "").trim().toLowerCase();
    const ifsc = String(request.ifsc || request.ifscCode || "").trim().toLowerCase();
    const deleted = {};
    const authEmails = new Set([bankEmail].filter(Boolean));
    const matchesBank = (item) => {
      const values = [
        item.id,
        item.email,
        item.officialEmail,
        item.managerEmail,
        item.bankId,
        item.branchManagerId,
        item.approvalRequestId,
      ].map(normalizeEmail);
      const names = [item.bankName, item.companyName, item.name].map((value) => String(value || "").trim().toLowerCase());
      const ifscValues = [item.ifsc, item.ifscCode].map((value) => String(value || "").trim().toLowerCase());
      return (bankEmail && values.includes(bankEmail)) || (bankName && names.includes(bankName)) || (ifsc && ifscValues.includes(ifsc));
    };

    const indexedBankQueries = [
      bankEmail ? [{ field: "email", value: bankEmail }] : null,
      bankEmail ? [{ field: "officialEmail", value: bankEmail }] : null,
      bankEmail ? [{ field: "managerEmail", value: bankEmail }] : null,
      bankEmail ? [{ field: "branchManagerId", value: bankEmail }] : null,
      id ? [{ field: "approvalRequestId", value: id }] : null,
      ifsc ? [{ field: "ifsc", value: ifsc.toUpperCase() }] : null,
      ifsc ? [{ field: "ifscCode", value: ifsc.toUpperCase() }] : null,
      bankName ? [{ field: "bankName", value: request.bankName || request.companyName || request.name }] : null,
      bankName ? [{ field: "companyName", value: request.bankName || request.companyName || request.name }] : null,
      bankName ? [{ field: "name", value: request.bankName || request.companyName || request.name }] : null,
      id ? [{ field: "bankId", value: id }] : null,
      id ? [{ field: "bankPartnerId", value: id }] : null,
    ].filter(Boolean);

    for (const collection of ["pendingBankApprovals", "pendingBankAccounts", "bankPartners", "banks", "branches", "branchManagers", "loanExecutives", "users", "dealershipBankTieUps"]) {
      const records = await candidateRecordsByQueries(collection, [id, bankEmail, ifsc].filter(Boolean), indexedBankQueries);
      const matches = records.filter(matchesBank);
      for (const record of matches) {
        const email = normalizeEmail(record.email || record.officialEmail || record.managerEmail || record.id);
        if (email && email.includes("@")) authEmails.add(email);
      }
      for (const record of matches) {
        await deleteRecord(collection, record.id);
      }
      deleted[collection] = matches.length;
    }

    const authDeleted = {};
    for (const email of authEmails) {
      await revokeUserSessions(email, "bank-permanent-delete").catch(() => {});
      authDeleted[email] = await deleteFirebaseAuthByEmail(email);
    }

    await writeAuditLog({ req, actionType: "BANK_DELETED", oldValue: request.status, newValue: "deleted", meta: { bankEmail, bankName, ifsc, deleted, authDeleted } });
    await incrementPlatformCounters({ bankPartners: -1, activeBanks: -1 });
    clearAdminApprovalCaches();
    res.json({ message: "Bank permanently deleted", deleted, authDeleted });
  } catch (error) {
    next(error);
  }
}
