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
export async function getDealerSalespersons(req, res, next) {
  try {
    const { dealershipEmail } = await financeDeskContext(req);
    const includeInactive = String(req.query.includeInactive || "") === "true";
    const salespersons = (await findRecordsByField("salespersons", "dealershipId", dealershipEmail, 100))
      .filter((person) => includeInactive || person.active !== false)
      .map((person) => ({
        id: person.id,
        name: person.name,
        mobile: person.mobile,
        jobId: person.jobId,
        email: person.email,
        dealershipId: person.dealershipId,
        dealershipName: person.dealershipName,
        dealershipLocation: person.dealershipLocation,
        active: person.active !== false,
      }));
    res.json(salespersons);
  } catch (error) {
    next(error);
  }
}

export async function createDealerSalesperson(req, res, next) {
  try {
    const { dealershipEmail, dealership } = await financeDeskContext(req);
    const name = required(req.body.name || req.body.salespersonName, "Salesperson name");
    const mobile = required(req.body.mobile, "Mobile number");
    const jobId = required(req.body.jobId || req.body.employeeId, "Job ID");
    const email = required(req.body.email || req.body.mailId, "Mail ID").toLowerCase();
    if (!/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ message: "Enter a valid 10-digit mobile number" });

    const existing = (await findRecordsByField("salespersons", "dealershipId", dealershipEmail, 100)).filter((person) => person.active !== false);
    if (existing.some((person) => person.mobile === mobile)) return res.status(409).json({ message: "Mobile number already exists for this dealership" });
    if (existing.some((person) => String(person.jobId || "").toLowerCase() === jobId.toLowerCase())) return res.status(409).json({ message: "Job ID already exists for this dealership" });
    if (existing.some((person) => String(person.email || "").toLowerCase() === email)) return res.status(409).json({ message: "Mail ID already exists for this dealership" });

    const salesperson = await createRecord("salespersons", {
      name,
      mobile,
      jobId,
      email,
      dealershipId: dealershipEmail,
      dealershipName: dealership.dealershipName || dealership.name || "",
      dealershipLocation: dealership.city || dealership.registeredCity || "",
      active: true,
      status: "active",
    });
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.SALESPERSON_CHANGED,
      actor: req.user,
      data: { dealershipId: dealershipEmail, salespersonId: salesperson.id, action: "created" },
    });
    res.status(201).json(salesperson);
  } catch (error) {
    next(error);
  }
}

export async function removeDealerSalesperson(req, res, next) {
  try {
    const { dealershipEmail } = await financeDeskContext(req);
    const salesperson = await getRecord("salespersons", req.params.id);
    if (!salesperson || salesperson.dealershipId !== dealershipEmail) return res.status(404).json({ message: "Salesperson not found" });
    await deleteRecord("salespersons", salesperson.id);
    await deleteRecordsByQuery("salespersonSummaryProjection", {
      where: [{ field: "dealershipId", value: dealershipEmail }, { field: "salespersonId", value: salesperson.id }],
    }).catch(() => 0);
    clearCachedValue("gm:salespersons:");
    clearCachedValue("dealer:leads:");
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.SALESPERSON_CHANGED,
      actor: req.user,
      data: { dealershipId: dealershipEmail, salespersonId: salesperson.id, action: "deleted" },
    });
    await writeAuditLog({
      req,
      actionType: "SALESPERSON_PERMANENT_DELETE",
      targetEntity: "salespersons",
      targetId: salesperson.id,
      oldValue: salesperson,
      meta: { dealershipId: dealershipEmail, email: salesperson.email || "" },
    });
    res.json({ message: "Salesperson permanently deleted", salespersonId: salesperson.id });
  } catch (error) {
    next(error);
  }
}
