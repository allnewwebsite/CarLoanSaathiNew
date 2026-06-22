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
import { syncMemberViewProjection } from "../services/projection.service.js";

void DEALER_SHARED_SENTINEL;

async function deleteFinanceManagerMemberProjectionRecords({ dealershipEmail = "", manager = {} } = {}) {
  const candidateValues = [...new Set([
    manager.id,
    manager.sourceId,
    manager.employeeId,
    manager.email,
    manager.mobile,
  ].map((value) => String(value || "").trim()).filter(Boolean))];
  const directIds = candidateValues.map((value) => String(`member_${dealershipEmail}_finance-manager_${value}`).trim().replace(/[^\w.@-]/g, "_").slice(0, 420));
  const directResults = await Promise.all(directIds.map((id) => deleteRecord("memberViewProjection", id).then(() => 1).catch(() => 0)));
  const indexedDeleted = await deleteMatchingRecords("memberViewProjection", () => true, [
    ...candidateValues.map((value) => [{ field: "dealershipId", value: dealershipEmail }, { field: "sourceId", value }]),
    ...candidateValues.map((value) => [{ field: "dealershipId", value: dealershipEmail }, { field: "memberId", value }]),
    ...candidateValues.map((value) => [{ field: "dealershipId", value: dealershipEmail }, { field: "email", value }]),
  ]).catch(() => 0);
  return directResults.reduce((sum, count) => sum + count, 0) + indexedDeleted;
}
export async function getDealerFinanceManagers(req, res, next) {
  try {
    const { dealershipEmail } = await financeDeskContext(req);
    const includeInactive = String(req.query.includeInactive || "") === "true";
    const page = await queryRecords("financeManagers", {
      where: [{ field: "dealershipId", value: dealershipEmail }],
      orderBy: "createdAt",
      direction: "desc",
      limit: 100,
      maxLimit: 100,
      search: req.query.search,
      searchFields: ["name", "email", "mobile", "employeeId"],
    });
    const managers = page.data
      .filter((manager) => includeInactive || manager.active !== false)
      .map(financeManagerRow);
    res.json(managers);
  } catch (error) {
    next(error);
  }
}

export async function createDealerFinanceManager(req, res, next) {
  try {
    const { dealershipEmail, dealership } = await financeDeskContext(req);
    const name = required(req.body.name || req.body.financeManagerName, "Finance Manager name");
    const mobile = required(req.body.mobile, "Mobile number").replace(/\D/g, "");
    const email = required(req.body.email, "Email ID").toLowerCase();
    const employeeId = required(req.body.employeeId, "Employee ID");
    if (!/^\d{10}$/.test(mobile)) return res.status(400).json({ message: "Enter valid 10-digit mobile number" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter valid email address" });
    const existing = await queryRecords("financeManagers", {
      where: [{ field: "dealershipId", value: dealershipEmail }],
      limit: 100,
      maxLimit: 100,
    });
    const duplicate = existing.data.find((manager) =>
      manager.active !== false
      && (String(manager.email || "").toLowerCase() === email || String(manager.employeeId || "").toLowerCase() === employeeId.toLowerCase())
    );
    if (duplicate) return res.status(409).json({ message: "Active Finance Manager with this email or employee ID already exists" });
    const now = new Date().toISOString();
    const manager = await createRecord("financeManagers", {
      name,
      mobile,
      email,
      employeeId,
      dealershipId: dealershipEmail,
      dealershipEmail,
      dealershipName: dealership.dealershipName || dealership.name || "",
      active: req.body.active === false ? false : true,
      status: req.body.active === false ? "Inactive" : "Active",
      createdBy: dealerEmail(req),
      createdAt: now,
      updatedAt: now,
    });
    await syncMemberViewProjection({
      ...manager,
      dealershipId: dealershipEmail,
      sourceCollection: "financeManagers",
      role: "finance-manager",
      roleLabel: "Finance Manager",
    });
    clearCachedValue("dealer:finance-managers:");
    clearCachedValue(`dealer:active-members:${dealershipEmail}:`);
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.FINANCE_MANAGER_CHANGED,
      actor: req.user,
      data: { dealershipId: dealershipEmail, financeManagerId: manager.id, action: "created" },
    });
    res.status(201).json(financeManagerRow(manager));
  } catch (error) {
    next(error);
  }
}

export async function updateDealerFinanceManager(req, res, next) {
  try {
    const { dealershipEmail } = await financeDeskContext(req);
    const manager = await getRecord("financeManagers", req.params.id);
    if (!manager || manager.dealershipId !== dealershipEmail) return res.status(404).json({ message: "Finance Manager not found" });
    const nextActive = req.body.active !== undefined ? req.body.active === true : String(req.body.status || "").toLowerCase() !== "inactive";
    const updated = await updateRecord("financeManagers", manager.id, {
      active: nextActive,
      status: nextActive ? "Active" : "Inactive",
      updatedAt: new Date().toISOString(),
    });
    if (nextActive) {
      await syncMemberViewProjection({
        ...updated,
        dealershipId: dealershipEmail,
        sourceCollection: "financeManagers",
        role: "finance-manager",
        roleLabel: "Finance Manager",
      });
    } else {
      await deleteFinanceManagerMemberProjectionRecords({ dealershipEmail, manager: updated });
    }
    clearCachedValue("dealer:finance-managers:");
    clearCachedValue(`dealer:active-members:${dealershipEmail}:`);
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.FINANCE_MANAGER_CHANGED,
      actor: req.user,
      data: { dealershipId: dealershipEmail, financeManagerId: updated.id, action: nextActive ? "activated" : "deactivated" },
    });
    res.json(financeManagerRow(updated));
  } catch (error) {
    next(error);
  }
}

export async function deleteDealerFinanceManager(req, res, next) {
  try {
    const { dealershipEmail } = await financeDeskContext(req);
    const manager = await getRecord("financeManagers", req.params.id);
    if (!manager || manager.dealershipId !== dealershipEmail) return res.status(404).json({ message: "Finance Manager not found" });

    await deleteRecord("financeManagers", manager.id);
    await deleteFinanceManagerMemberProjectionRecords({ dealershipEmail, manager });
    clearCachedValue("dealer:finance-managers:");
    clearCachedValue(`dealer:active-members:${dealershipEmail}:`);
    clearCachedValue("dealer:leads:");
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.FINANCE_MANAGER_CHANGED,
      actor: req.user,
      data: { dealershipId: dealershipEmail, financeManagerId: manager.id, action: "deleted" },
    });
    await writeAuditLog({
      req,
      actionType: "FINANCE_MANAGER_PERMANENT_DELETE",
      targetEntity: "financeManagers",
      targetId: manager.id,
      oldValue: manager,
      meta: { dealershipId: dealershipEmail, email: manager.email || "" },
    });
    res.json({ message: "Finance Manager permanently deleted", financeManagerId: manager.id });
  } catch (error) {
    next(error);
  }
}
