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
  createRecord,
  dealerCanReadProjectedLead,
  dealerEmail,
  dealerEmailPendingPayload,
  deleteDealerStaffCollectionRecords,
  deleteMatchingRecords,
  deleteRecord,
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
import { createNotification } from "../services/notification.service.js";
import { syncMemberViewProjection, syncSalespersonSummaryProjection } from "../services/projection.service.js";

void DEALER_SHARED_SENTINEL;

function salespersonProjectionId(dealershipEmail = "", value = "") {
  return String(`salesperson_${dealershipEmail}_${value}`).trim().replace(/[^\w.@-]/g, "_").slice(0, 420);
}

async function deleteSalespersonSummaryProjectionRecords({ dealershipEmail = "", salesperson = {} } = {}) {
  const candidateValues = [...new Set([
    salesperson.id,
    salesperson.sourceId,
    salesperson.salespersonId,
    salesperson.jobId,
    salesperson.email,
    salesperson.mobile,
    salesperson.name,
  ].map((value) => String(value || "").trim()).filter(Boolean))];
  const directIds = candidateValues.map((value) => salespersonProjectionId(dealershipEmail, value));
  const directResults = await Promise.all(directIds.map((id) => deleteRecord("salespersonSummaryProjection", id).then(() => 1).catch(() => 0)));
  const indexedDeleted = await deleteMatchingRecords("salespersonSummaryProjection", () => true, [
    ...candidateValues.map((value) => [{ field: "dealershipId", value: dealershipEmail }, { field: "salespersonId", value }]),
    ...candidateValues.map((value) => [{ field: "dealershipId", value: dealershipEmail }, { field: "sourceId", value }]),
    ...candidateValues.map((value) => [{ field: "dealershipId", value: dealershipEmail }, { field: "email", value }]),
    ...candidateValues.map((value) => [{ field: "dealershipId", value: dealershipEmail }, { field: "mobile", value }]),
    ...candidateValues.map((value) => [{ field: "dealershipId", value: dealershipEmail }, { field: "jobId", value }]),
  ]).catch(() => 0);
  return directResults.reduce((sum, count) => sum + count, 0) + indexedDeleted;
}

async function deleteSalespersonMemberProjectionRecords({ dealershipEmail = "", salesperson = {} } = {}) {
  const candidateValues = [...new Set([
    salesperson.id,
    salesperson.sourceId,
    salesperson.salespersonId,
    salesperson.jobId,
    salesperson.email,
    salesperson.mobile,
  ].map((value) => String(value || "").trim()).filter(Boolean))];
  const directIds = candidateValues.map((value) => String(`member_${dealershipEmail}_salesperson_${value}`).trim().replace(/[^\w.@-]/g, "_").slice(0, 420));
  const directResults = await Promise.all(directIds.map((id) => deleteRecord("memberViewProjection", id).then(() => 1).catch(() => 0)));
  const indexedDeleted = await deleteMatchingRecords("memberViewProjection", () => true, [
    ...candidateValues.map((value) => [{ field: "dealershipId", value: dealershipEmail }, { field: "sourceId", value }]),
    ...candidateValues.map((value) => [{ field: "dealershipId", value: dealershipEmail }, { field: "memberId", value }]),
    ...candidateValues.map((value) => [{ field: "dealershipId", value: dealershipEmail }, { field: "email", value }]),
  ]).catch(() => 0);
  return directResults.reduce((sum, count) => sum + count, 0) + indexedDeleted;
}

function clearSalespersonRuntimeCaches(dealershipEmail = "") {
  clearCachedValue("gm:salespersons:");
  clearCachedValue(`gm:salespersons:staff:${dealershipEmail}`);
  clearCachedValue(`gm:salespersons:leads:${dealershipEmail}`);
  clearCachedValue("dealer:leads:");
  clearCachedValue(`dealer:active-members:${dealershipEmail}:`);
}

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
    await syncSalespersonSummaryProjection({ ...salesperson, dealershipId: dealershipEmail }, {
      totalCases: 0,
      disbursedCases: 0,
      rejectedCases: 0,
      pendingCases: 0,
    });
    await syncMemberViewProjection({
      ...salesperson,
      dealershipId: dealershipEmail,
      sourceCollection: "salespersons",
      role: "salesperson",
      roleLabel: "Salesperson",
    });
    clearSalespersonRuntimeCaches(dealershipEmail);
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.SALESPERSON_CHANGED,
      actor: req.user,
      data: { dealershipId: dealershipEmail, salespersonId: salesperson.id, action: "created" },
    });
    runDealerLeadSideEffects("salesperson-created-notification", [
      () => createNotification({
        type: "USER_CREATED",
        title: "Welcome to CarLoanSaathi",
        message: "Congratulations!\n\nYour account has been created successfully.",
        recipientRole: "salesperson",
        recipientId: email,
        recipientEmail: email,
        priority: "success",
        entityType: "user",
        entityId: email,
        dealershipId: dealershipEmail,
        createdBy: dealerEmail(req),
        meta: {
          memberName: name,
          roleLabel: "Salesperson",
          dealershipId: dealershipEmail,
          dedupeKey: "salesperson-created",
        },
      }),
    ]);
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
    await deleteSalespersonSummaryProjectionRecords({ dealershipEmail, salesperson });
    await deleteSalespersonMemberProjectionRecords({ dealershipEmail, salesperson });
    clearSalespersonRuntimeCaches(dealershipEmail);
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.SALESPERSON_CHANGED,
      actor: req.user,
      data: { dealershipId: dealershipEmail, salespersonId: salesperson.id, action: "deleted" },
    });
    runDealerLeadSideEffects("salesperson-deleted-notification", [
      () => createNotification({
        type: "USER_DELETED",
        title: "User Removed",
        message: `Salesperson ${salesperson.name || salesperson.email || salesperson.id} has been removed.`,
        recipientRole: "finance-desk",
        recipientId: dealershipEmail,
        priority: "medium",
        entityType: "user",
        entityId: salesperson.email || salesperson.id,
        actionUrl: "/finance/active-members",
        dealershipId: dealershipEmail,
        createdBy: dealerEmail(req),
        meta: {
          memberName: salesperson.name || salesperson.email || salesperson.id,
          roleLabel: "Salesperson",
          removedEmail: salesperson.email || "",
          dealershipId: dealershipEmail,
          dedupeKey: "salesperson-deleted",
        },
      }),
    ]);
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
