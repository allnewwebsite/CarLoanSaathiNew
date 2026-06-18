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
export async function getDealerBankTieUps(req, res, next) {
  try {
    const { dealershipEmail, dealership } = await financeDeskContext(req);

    // Get dealership's current tie-ups
    const currentTieUps = await getDealershipBankTieUps(dealership.id || dealershipEmail);

    // Get all available banks (dynamic - always fresh)
    const availableBanks = await getAvailableBankBranches();

    res.json({
      dealershipId: dealership.id || dealershipEmail,
      currentTieUps: currentTieUps || [],
      branchTieUps: currentTieUps || [],
      availableBanks: availableBanks || [],
      availableBranches: availableBanks || [],
      totalAvailable: availableBanks?.length || 0,
      totalTiedUp: currentTieUps?.length || 0,
    });
  } catch (error) {
    logError("Dealer bank tie-up load failed", {
      requestId: req.requestId,
      userEmail: dealerEmail(req),
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    next(error);
  }
}

export async function updateDealerBankTieUps(req, res, next) {
  try {
    const { dealershipEmail, dealership } = await financeDeskContext(req);
    const dealershipId = dealership.id || dealershipEmail;

    // Get the requested IFSC codes
    const requestedTieUps = req.body.bankTieUps || req.body.dealershipBankPartners || req.body.bankBranchIds || [];
    const ifscCodes = Array.isArray(requestedTieUps)
      ? requestedTieUps.map((item) => (typeof item === "string" ? item : item.ifscCode || item.bankIfsc || item.id))
      : [];

    // Update the bank tie-ups
    const result = await updateDealershipBankTieUps(dealershipId, ifscCodes, req);

    // Audit log
    await writeAuditLog({
      req,
      actionType: "BANK_TIEUPS_UPDATED",
      newValue: { count: ifscCodes.length },
      targetEntity: "dealership",
      targetId: dealershipId,
      dealershipId,
      meta: { ifscCodes },
    });

    res.json({
      success: true,
      message: "Bank tie-ups updated successfully",
      dealershipId,
      bankTieUps: result.bankTieUps,
      branchTieUps: result.bankTieUps,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    logError("Dealer bank tie-up update failed", {
      requestId: req.requestId,
      userEmail: dealerEmail(req),
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    next(error);
  }
}
