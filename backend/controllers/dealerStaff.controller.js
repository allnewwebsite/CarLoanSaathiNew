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
  clearIdentityCaches,
  clearLeadSyncCaches,
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
  removedStaffRecord,
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

function staffProjectionId(dealershipEmail = "", email = "") {
  return String(`staff_${dealershipEmail}_${email}`).trim().replace(/[^\w.@-]/g, "_").slice(0, 420);
}

async function deleteStaffProjectionRecords({ dealershipEmail = "", email = "", employee = {} } = {}) {
  const candidateValues = [...new Set([
    email,
    employee.email,
    employee.officialEmail,
    employee.sourceId,
    employee.uid,
    employee.authAccountId,
  ].map((value) => String(value || "").trim()).filter(Boolean))];
  const directIds = [...new Set([
    staffProjectionId(dealershipEmail, email),
    ...candidateValues.map((value) => staffProjectionId(dealershipEmail, value)),
  ])];
  const directResults = await Promise.all(directIds.map((id) => deleteRecord("staffViewProjection", id).then(() => 1).catch(() => 0)));
  const indexedDeleted = await deleteMatchingRecords("staffViewProjection", () => true, [
    ...candidateValues.map((value) => [{ field: "email", value }]),
    ...candidateValues.map((value) => [{ field: "officialEmail", value }]),
    ...candidateValues.map((value) => [{ field: "sourceId", value }]),
    ...candidateValues.map((value) => [{ field: "uid", value }]),
  ]).catch(() => 0);
  return directResults.reduce((sum, count) => sum + count, 0) + indexedDeleted;
}

export async function getDealerStaff(req, res, next) {
  try {
    const { email, dealershipEmail, dealership } = await financeDeskContext(req);
    const { limit } = paginationParams({ ...req.query, limit: req.query.limit || 100 }, { defaultLimit: 100, maxLimit: 100 });
    logReadMetric("READS-BEFORE", req, { endpoint: "GET /api/dealer/staff", estimatedReads: 200 });
    const cacheKey = `dealer:staff:${dealershipEmail}:${JSON.stringify({ ...req.query, limit })}`;
    let cacheHit = true;
    const cachedStaff = await cached(cacheKey, 30000, async () => {
      cacheHit = false;
      const projected = await queryStaffViewProjection({ dealershipId: dealershipEmail, query: { ...req.query, limit } }).catch(() => null);
      if (Array.isArray(projected)) {
        const visibleProjected = projected.filter((row) => !removedStaffRecord(row));
        logProjectionRead("PROJECTION-HIT", req, { collection: "staffViewProjection", resultCount: visibleProjected.length });
        return visibleProjected;
      }
      logProjectionRead("PROJECTION-MISS", req, { collection: "staffViewProjection", reason: "missing_staff_projection" });
      const staff = await buildDealerStaffRows(dealershipEmail, dealership, email);
      staff.forEach((row) => syncStaffViewProjectionSoon({ ...row, dealershipId: dealershipEmail, dealershipEmail }));
      return staff.slice(0, limit);
    });
    if (cacheHit) logReadMetric("CACHE-HIT", req, { endpoint: "GET /api/dealer/staff", cacheKey });
    logReadMetric("READS-AFTER", req, { endpoint: "GET /api/dealer/staff", estimatedReads: cacheHit ? 0 : Math.min(limit, cachedStaff.length || limit), limit });
    return res.json(cachedStaff);
  } catch (error) {
    next(error);
  }
}

export async function getDealerStaffDetail(req, res, next) {
  try {
    const { email, dealershipEmail, dealership } = await financeDeskContext(req);
    const staffId = decodeURIComponent(req.params.id || "");
    const employee = await findDealerStaffEmployee({
      dealershipEmail,
      dealership,
      currentEmail: email,
      identifier: staffId,
    });
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    res.json(employee);
  } catch (error) {
    next(error);
  }
}

export async function createDealerStaff(req, res, next) {
  try {
    const { dealershipEmail, dealership } = await financeDeskContext(req);
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });
    const fullName = required(req.body.fullName || req.body.name, "Full name");
    const email = required(req.body.email || req.body.officialEmail, "Official email").toLowerCase();
    const mobile = required(req.body.mobile, "Mobile number");
    const employeeId = required(req.body.employeeId || req.body.jobId, "Employee ID");
    const role = normalizeStaffRole(req.body.role);
    if (role !== "gm") return res.status(400).json({ message: "Only the GM role can be created." });
    if (!/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ message: "Enter a valid 10-digit mobile number" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter a valid official email" });

    const existingStaff = (await findRecordsByField("dealerStaff", "dealershipId", dealershipEmail, 100)).filter((item) => item.active !== false);
    if (existingStaff.some((item) => item.email === email)) return res.status(409).json({ message: "Official email already exists for this dealership" });
    if (existingStaff.some((item) => item.mobile === mobile)) return res.status(409).json({ message: "Mobile number already exists for this dealership" });
    if (existingStaff.some((item) => String(item.employeeId || "").toLowerCase() === employeeId.toLowerCase())) return res.status(409).json({ message: "Employee ID already exists for this dealership" });
    const existingUser = await getRecord("users", email).catch(() => null);
    const existingUserActive = existingUser && existingUser.active !== false && existingUser.accountActive !== false;
    const sameDealershipUser = existingUser
      && (existingUser.dealershipId === dealershipEmail || existingUser.dealershipEmail === dealershipEmail);
    if (existingUserActive && !sameDealershipUser) {
      return res.status(409).json({ message: "This email belongs to another active account" });
    }
    if (existingUserActive && sameDealershipUser && !["finance-desk", "gm"].includes(normalizeStaffRole(existingUser.role))) {
      return res.status(409).json({ message: "This email belongs to another active role" });
    }

    const now = new Date().toISOString();
    const city = String(req.body.city || req.body.branch || dealership.city || dealership.registeredCity || "").trim();
    const branch = String(req.body.branch || city || dealership.dealershipName || "").trim();
    const dealershipName = dealership.dealershipName || dealership.name || "";
    const temporaryPassword = generateTemporaryPassword();
    const temporaryPasswordHash = hashTemporaryPassword(temporaryPassword);
    let firebaseUser;
    try {
      firebaseUser = await firebaseAdmin.auth().createUser({
        email,
        password: temporaryPassword,
        displayName: fullName,
        emailVerified: true,
        disabled: false,
      });
    } catch (firebaseError) {
      if (firebaseError.code === "auth/email-already-exists") {
        firebaseUser = await firebaseAdmin.auth().getUserByEmail(email);
        await assertNoActiveIdentityCollision({ uid: firebaseUser.uid, email, role, excludeIds: [] });
        await firebaseAdmin.auth().updateUser(firebaseUser.uid, {
          password: temporaryPassword,
          displayName: fullName,
          emailVerified: true,
          disabled: false,
        });
      } else {
        throw firebaseError;
      }
    }
    await assertNoActiveIdentityCollision({ uid: firebaseUser.uid, email, role, excludeIds: [] });

    const roleLabel = staffRoleLabel(role);
    const portalType = "finance";
    const accountType = role === "finance-desk" ? "finance-head" : "dealership-management";
    const staffPayload = {
      id: email,
      uid: firebaseUser.uid,
      fullName,
      name: fullName,
      email,
      officialEmail: email,
      mobile,
      employeeId,
      role,
      roleLabel,
      portalType,
      accountType,
      dealershipId: dealershipEmail,
      dealershipEmail,
      dealershipName,
      branch,
      branchId: branch,
      city,
      createdByDealerAdmin: true,
      createdByDealerAdminId: dealerEmail(req),
      firstLoginRequired: true,
      temporaryPasswordRequired: true,
      temporaryPasswordHash,
      temporaryPasswordIssuedAt: now,
      passwordChangedAt: null,
      status: "active",
      active: true,
      approved: true,
      accountApproved: true,
      accountActive: true,
      createdAt: now,
    };
    await upsertRecord("dealerStaff", email, staffPayload);
    if (role === "finance-desk") {
      await upsertRecord("financeDesks", email, {
        ...staffPayload,
        headName: fullName,
        officialEmail: email,
      });
    } else {
      await upsertRecord("dealershipManagers", email, {
        ...staffPayload,
        dealershipEmail,
      });
    }
    await upsertCanonicalUser(firebaseUser.uid, {
      name: fullName,
      fullName,
      uid: firebaseUser.uid,
      email,
      officialEmail: email,
      mobile,
      employeeId,
      role,
      portalType,
      accountType,
      approved: true,
      active: true,
      accountApproved: true,
      accountActive: true,
      dealershipId: dealershipEmail,
      dealershipName,
      branch,
      branchId: branch,
      city,
      state: dealership.state || dealership.dealerState || "",
      address: dealership.address || "",
      createdAt: now,
      firstLoginRequired: true,
      temporaryPasswordRequired: true,
      temporaryPasswordHash,
      temporaryPasswordIssuedAt: now,
      passwordChangedAt: null,
      createdByDealerAdmin: true,
      createdByDealerAdminId: dealerEmail(req),
      status: "active",
    });
    syncStaffViewProjectionSoon(staffPayload);
    clearCachedValue(`dealer:staff:${dealershipEmail}:`);
    runDealerLeadSideEffects("dealer-staff-created", [
      () => firebaseAdmin.auth().setCustomUserClaims(firebaseUser.uid, {
        role,
        approved: true,
        active: true,
        dealershipId: dealershipEmail,
        portalType,
        accountType,
      }),
      () => writeAuditLog({ req, actionType: "DEALER_STAFF_CREATED", newValue: employeeId, meta: { staffEmail: email, role, dealershipId: dealershipEmail } }),
      () => publishRealtimeEvent({
        eventType: REALTIME_EVENTS.STAFF_CHANGED,
        actor: req.user,
        data: {
          action: "created",
          dealershipId: dealershipEmail,
          recipientId: email,
          staffEmail: email,
          role,
        },
      }),
    ]);
    const { temporaryPasswordHash: _temporaryPasswordHash, ...safeStaffPayload } = staffPayload;
    res.status(201).json({
      ...safeStaffPayload,
      portalLogin: `${process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || "https://carloansaathi.com"}/gm/login`,
      temporaryPassword,
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteDealerStaff(req, res, next) {
  try {
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });
    const { email: actorEmail, dealershipEmail, dealership } = await financeDeskContext(req);
    const staffId = decodeURIComponent(req.params.id || "");
    const employee = await findDealerStaffEmployee({
      dealershipEmail,
      dealership,
      currentEmail: actorEmail,
      identifier: staffId,
    });
    if (!employee) return res.status(404).json({ message: "Employee not found" });

    const email = staffEmail(employee.email);
    if (!email) return res.status(409).json({ message: "Employee email mapping is missing. Repair the staff record before deletion." });
    if (email === staffEmail(dealershipEmail) || email === staffEmail(actorEmail) || employee.protected === true) {
      return res.status(400).json({ message: "Primary Finance Desk account cannot be removed from Manage Staff." });
    }
    const emailMatches = (item) => staffEmail(item.email || item.officialEmail || item.id) === email;
    const deleted = {};

    for (const collection of ["dealerStaff", "financeDesks", "financeDesk", "dealershipManagers", "users"]) {
      deleted[collection] = await deleteDealerStaffCollectionRecords(collection, {
        employee,
        dealershipEmail,
        email,
      });
    }
    for (const collection of ["loginActivity", "authAuditLogs", "notifications"]) {
      deleted[collection] = await deleteMatchingRecords(collection, (item) =>
        emailMatches(item)
        || staffEmail(item.recipientId || item.userEmail || item.actorEmail || item.createdBy || item.updatedBy) === email
      , [
        [{ field: "email", value: email }],
        [{ field: "recipientId", value: email }],
        [{ field: "userEmail", value: email }],
        [{ field: "actorEmail", value: email }],
        [{ field: "createdBy", value: email }],
        [{ field: "updatedBy", value: email }],
      ]);
    }
    deleted.staffViewProjection = await deleteStaffProjectionRecords({ dealershipEmail, email, employee });
    clearCachedValue(`dealer:staff:${dealershipEmail}:`);
    clearIdentityCaches({ uid: employee.uid || employee.authAccountId, email });

    await revokeUserSessions(email, "dealer-staff-permanent-delete").catch(() => {});
    let authDeleted = false;
    try {
      const firebaseUser = await firebaseAdmin.auth().getUserByEmail(email);
      await firebaseAdmin.auth().deleteUser(firebaseUser.uid);
      authDeleted = true;
    } catch (firebaseError) {
      if (firebaseError.code !== "auth/user-not-found") throw firebaseError;
    }

    await writeAuditLog({
      req,
      actionType: "DEALER_STAFF_PERMANENT_DELETE",
      targetEntity: "dealerStaff",
      targetId: email,
      oldValue: employee,
      meta: { dealershipId: dealershipEmail, deleted, authDeleted },
    });
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.STAFF_CHANGED,
      actor: req.user,
      data: {
        action: "deleted",
        dealershipId: dealershipEmail,
        recipientId: email,
        staffEmail: email,
        role: employee.role || "",
        deleted,
        authDeleted,
      },
    });
    res.json({ message: "Employee permanently removed", employeeEmail: email, deleted, authDeleted });
  } catch (error) {
    next(error);
  }
}
