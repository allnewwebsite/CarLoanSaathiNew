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
export async function getDealerProfile(req, res, next) {
  try {
    const { email, dealershipEmail, desk, dealership } = await financeDeskContext(req);
    if (dealership?.dealershipName || dealership?.dealershipBrand) {
      const safeDealership = stripRemovedDealershipFields(dealership);
      return res.json({
        email,
        dealershipId: dealershipEmail,
        dealershipCity: safeDealership.city || safeDealership.registeredCity || desk?.city || "",
        dealershipBrand: safeDealership.dealershipBrand || safeDealership.brand || "",
        ...safeDealership,
        dealershipBankPartners: safeDealership.dealershipBankPartners || [],
        financeDesk: desk || null,
      });
    }
    const profile = await getRecord("dealerProfiles", email).catch(() => null)
      || (await findRecordsByField("dealerProfiles", "email", email, 3))[0]
      || {
      email,
      dealershipId: dealershipEmail,
      dealershipCity: desk?.city || "",
      dealershipName: "",
      contactPerson: "",
      city: "",
      mobile: "",
    };
    res.json(profile);
  } catch (error) {
    next(error);
  }
}

export async function updateDealerProfile(req, res, next) {
  try {
    const { email, dealershipEmail, dealership } = await financeDeskContext(req);
    const existing = await getRecord("dealerProfiles", email).catch(() => null)
      || (await findRecordsByField("dealerProfiles", "email", email, 3))[0]
      || null;
    const bankPartners = branchIdsFromRequest(req.body.dealershipBankPartners || req.body.bankBranchIds || req.body.bankBranchId || []);
    const payload = {
      email,
      dealershipEmail,
      dealershipName: String(req.body.dealershipName || "").trim(),
      contactPerson: String(req.body.contactPerson || "").trim(),
      city: String(req.body.city || "").trim(),
      mobile: String(req.body.mobile || "").trim(),
      dealershipBankPartners: bankPartners,
    };
    const profile = existing
      ? await updateRecord("dealerProfiles", existing.id, payload)
      : await createRecord("dealerProfiles", payload);
    await upsertRecord("dealers", dealershipEmail, { ...stripRemovedDealershipFields(dealership || {}), ...payload });
    await upsertRecord("dealerships", dealershipEmail, { ...stripRemovedDealershipFields(dealership || {}), ...payload });
    res.json({ message: "Dealer profile saved", profile });
  } catch (error) {
    next(error);
  }
}
