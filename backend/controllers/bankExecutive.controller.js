import {
  ACTIVE_EXPORT_SENTINEL,
  addTimelineEvent,
  anyMatch,
  applyFilters,
  assertBankRegistrationEmailVerified,
  assignedLeadsForPartner,
  assertLeadMutable,
  assertNoActiveIdentityCollision,
  assertValidStatusTransition,
  attachExecutiveMobile,
  AUDIT_ACTIONS,
  bankEmailPendingPayload,
  bankIdentity,
  bankManagerCanAccessLead,
  bankStatuses,
  cached,
  cleanText,
  clearBankSummaryCaches,
  clearCachedValue,
  clearExecutiveLeadAssignments,
  clearLeadDetailCaches,
  collectExecutiveLeads,
  countCanonicalBankExecutives,
  createNotification,
  createRecord,
  createShortLivedDocumentUrl,
  crypto,
  currentPartner,
  dealershipIdentityFromLead,
  deleteExecutiveSummaryProjection,
  deleteLeadDocument,
  deleteMatchingRecords,
  deleteRecord,
  deleteRecordsByQuery,
  documentBelongsToBank,
  documentBelongsToBranch,
  documentBelongsToExecutive,
  documentBelongsToLead,
  emitBankLeadAccessDenied,
  emitOperationalAlert,
  ensureCommissionForLead,
  EXECUTIVE_ACTIVE_LEAD_STATUSES,
  executiveBelongsToBank,
  executiveLeadSpecs,
  existingBranchForIfsc,
  firebaseAdmin,
  firebaseUserVerified,
  findRecordsByField,
  generateTemporaryPassword,
  getBankAnalyticsAggregate,
  getLeadDetailProjection,
  getRecord,
  getTimelineForLead,
  groupDealershipsFromLeads,
  hasMatchingScopeValues,
  hashTemporaryPassword,
  LEAD_DOCUMENT_FIELDS,
  LEAD_STATUSES,
  leadBankValues,
  leadBranchValues,
  leadDetailResponseFromProjection,
  leadText,
  listRecords,
  liveBankRegistrationForAccount,
  loanCapacityUpperBound,
  loanExecutiveCanAccessLead,
  logError,
  logInfo,
  logProjectionRead,
  logReadMetric,
  normalizeIfsc,
  normalizeLoanCapacity,
  normalizeStatus,
  pageResponse,
  paginationParams,
  partnerBankValues,
  partnerBranchValues,
  partnerCanAccessLead,
  projectedLeadHasRequiredBankScope,
  publishRealtimeEvent,
  queryBankDealershipProjection,
  queryBankLeads,
  queryExecutiveLeads,
  queryExecutiveSummaryProjection,
  queryLeadProjectionForUser,
  queryNotificationProjectionForUser,
  queryRecords,
  queryTimelineProjection,
  queueDocumentsRequiredWhatsApp,
  queueLeadAssignedWhatsApp,
  queueStatusUpdatedWhatsApp,
  reassignLeadToNextBranchExecutive,
  REALTIME_EVENTS,
  recordMonitoringSignal,
  recordOperationalEvent,
  requireAssignedLead,
  resolveBankExecutiveForMutation,
  revokeUserSessions,
  safeProjectionDocId,
  sameText,
  STATUS_LABELS,
  syncExecutiveSummaryProjection,
  syncExecutiveSummaryProjectionSoon,
  syncLeadDetailProjection,
  syncLeadProjection,
  syncLeadProjectionSoon,
  TIMELINE_EVENTS,
  updateRecord,
  uploadLeadDocument,
  upsertCanonicalUser,
  upsertRecord,
  userEmail,
  validateBankLocation,
  writeAuditLog,
} from './bankShared.controller.js';
import { executiveQueryArgs, loanExecutiveMatchesLead } from "../services/roleIdentity.service.js";
import {
  bankExecutiveCanonicalUser,
  bankExecutiveRecord,
  executiveInputError,
  executiveInputFromBody,
} from "./bankExecutivePayload.controller.js";

void ACTIVE_EXPORT_SENTINEL;
export async function getBankExecutives(req, res, next) {
  try {
    const partner = await currentPartner(req);
    if (!partner || partner.roleType !== "bank-manager") return res.status(403).json({ message: "Only bank managers can view executives" });
    const identity = bankIdentity(partner);
    const { limit } = paginationParams({ ...req.query, limit: req.query.limit || 50 }, { defaultLimit: 50, maxLimit: 100 });
    logReadMetric("READS-BEFORE", req, { endpoint: "GET /api/bank/executives", estimatedReads: 200 });
    const projectionCacheKey = `bank:executives:projection:${identity.bankId}:${JSON.stringify(req.query || {})}`;
    let projectionCacheHit = true;
    const projected = await cached(projectionCacheKey, 30000, async () => {
      projectionCacheHit = false;
      return queryExecutiveSummaryProjection({ bankId: identity.bankId, query: { ...req.query, limit } }).catch(() => null);
    });
    if (projectionCacheHit) logReadMetric("CACHE-HIT", req, { endpoint: "GET /api/bank/executives", cacheKey: projectionCacheKey });
    if (Array.isArray(projected) && projected.length === 0) {
      logProjectionRead("PROJECTION-HIT", req, { collection: "executiveSummaryProjection", resultCount: 0 });
      logReadMetric("READS-AFTER", req, { endpoint: "GET /api/bank/executives", estimatedReads: projectionCacheHit ? 0 : 1, limit });
      return res.json({ data: [] });
    }
    if (projected?.length) {
      const canonicalActiveCount = await countCanonicalBankExecutives(identity).catch(() => projected.length);
      if (canonicalActiveCount > projected.length) {
        logProjectionRead("CANONICAL-FALLBACK", req, {
          collection: "loanExecutives",
          reason: "executive_summary_projection_incomplete",
          projectedCount: projected.length,
          canonicalActiveCount,
        });
      } else {
      logProjectionRead("PROJECTION-HIT", req, { collection: "executiveSummaryProjection", resultCount: projected.length });
      logReadMetric("READS-AFTER", req, { endpoint: "GET /api/bank/executives", estimatedReads: projectionCacheHit ? 0 : Math.min(limit, projected.length), limit });
      return res.json({ data: projected });
      }
    }
    logProjectionRead("PROJECTION-MISS", req, { collection: "executiveSummaryProjection", reason: "missing_projection_page" });
    const [executivesPage, leads] = await cached(`bank:executives:${identity.bankId}:${partner.email || partner.id}`, 15000, () => Promise.all([
      queryRecords("loanExecutives", {
        where: [{ field: "bankId", value: identity.bankId }],
        orderBy: "createdAt",
        direction: "desc",
        limit,
        maxLimit: 100,
      }),
      assignedLeadsForPartner(partner),
    ]));
    const executives = executivesPage.data;
    const rows = executives
      .filter((executive) => executiveBelongsToBank(executive, identity))
      .map((executive) => {
        const { temporaryPasswordHash: _temporaryPasswordHash, ...safeExecutive } = executive;
        const executiveId = executive.id || executive.email || executive.mobile;
        const cases = leads.filter((lead) =>
          lead.assignedExecutiveId === executiveId
          || lead.assignedExecutiveId === executive.id
          || lead.assignedExecutiveEmail === executive.email
          || lead.assignedExecutiveMobile === executive.mobile
          || lead.assignedExecutiveName === executive.name
          || lead.assignedExecutiveName === executive.fullName
        );
        const activeCases = cases.filter((lead) => ![LEAD_STATUSES.REJECTED, LEAD_STATUSES.DISBURSED, LEAD_STATUSES.CLOSED].includes(normalizeStatus(lead.status)));
        return {
          ...safeExecutive,
          executiveId,
          totalAssignedCases: cases.length,
          currentActiveCases: activeCases.length,
          status: executive.active === false ? "inactive" : executive.status || "active",
        };
      });
    rows.forEach((row) => syncExecutiveSummaryProjectionSoon(row, {
      totalAssignedCases: row.totalAssignedCases,
      currentActiveCases: row.currentActiveCases,
    }));
    logReadMetric("READS-AFTER", req, { endpoint: "GET /api/bank/executives", estimatedReads: limit + 100, fallback: true });
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
}

export async function createBankExecutive(req, res, next) {
  try {
    const partner = await currentPartner(req);
    if (!partner || partner.roleType !== "bank-manager") return res.status(403).json({ message: "Only bank managers can add executives" });
    const { name, mobile, email } = executiveInputFromBody(req.body);
    const inputError = executiveInputError({ name, mobile, email });
    if (inputError) return res.status(400).json({ message: inputError });

    const identity = bankIdentity(partner);
    const executives = (await queryRecords("loanExecutives", {
      where: [{ field: "bankId", value: identity.bankId }],
      orderBy: "createdAt",
      direction: "desc",
      limit: 200,
      maxLimit: 200,
    })).data;
    const duplicate = executives.find((executive) => executive.active !== false && (executive.mobile === mobile || executive.email === email || executive.officialEmail === email || executive.id === email));
    if (duplicate?.mobile === mobile) return res.status(409).json({ message: "Mobile number already exists for this bank" });
    if (duplicate?.email === email || duplicate?.officialEmail === email || duplicate?.id === email) return res.status(409).json({ message: "Official email already exists for an executive" });
    const existingExecutiveByEmail = await getRecord("loanExecutives", email).catch(() => null);
    if (existingExecutiveByEmail?.active !== false && existingExecutiveByEmail?.bankId && existingExecutiveByEmail.bankId !== identity.bankId) {
      return res.status(409).json({ message: "Official email already exists for another bank executive" });
    }

    const now = new Date().toISOString();
    const temporaryPassword = generateTemporaryPassword();
    const temporaryPasswordHash = hashTemporaryPassword(temporaryPassword);
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });
    let firebaseUser;
    let reusedExistingAuthUser = false;
    try {
      firebaseUser = await firebaseAdmin.auth().createUser({
        email,
        password: temporaryPassword,
        displayName: name,
        emailVerified: true,
        disabled: false,
      });
    } catch (firebaseError) {
      if (firebaseError.code === "auth/email-already-exists") {
        firebaseUser = await firebaseAdmin.auth().getUserByEmail(email);
        await assertNoActiveIdentityCollision({ uid: firebaseUser.uid, email, role: "loan-executive", excludeIds: [] });
        await firebaseAdmin.auth().updateUser(firebaseUser.uid, {
          password: temporaryPassword,
          displayName: name,
          emailVerified: true,
          disabled: false,
        });
        reusedExistingAuthUser = true;
      } else {
        throw firebaseError;
      }
    }
    await assertNoActiveIdentityCollision({ uid: firebaseUser.uid, email, role: "loan-executive", excludeIds: [] });

    const payload = bankExecutiveRecord({ name, mobile, email, identity, partner, firebaseUser, temporaryPasswordHash, now });
    await upsertRecord("loanExecutives", email, payload);
    await upsertCanonicalUser(firebaseUser.uid, bankExecutiveCanonicalUser({
      name,
      mobile,
      email,
      identity,
      partner,
      firebaseUser,
      temporaryPasswordHash,
      now,
      employeeId: req.body.employeeId || req.body.employeeCode || "",
    }));
    await firebaseAdmin.auth().setCustomUserClaims(firebaseUser.uid, {
      role: "loan-executive",
      approved: true,
      active: true,
      bankId: identity.bankId,
      branchId: identity.bankLocation || null,
    });
    const executive = await getRecord("loanExecutives", email);
    await syncExecutiveSummaryProjection(executive, { totalAssignedCases: 0, currentActiveCases: 0 }).catch(() => null);
    clearBankSummaryCaches();
    await writeAuditLog({ req, actionType: "BANK_EXECUTIVE_CREATED", newValue: email, meta: { executiveId: executive.id, bankId: identity.bankId, reusedExistingAuthUser } });
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.BANK_EXECUTIVE_CREATED,
      actor: req.user,
      data: {
        bankId: identity.bankId,
        branchId: executive.branchId || identity.bankLocation,
        bankIfsc: executive.bankIfsc || executive.ifsc || identity.bankIfsc || null,
        executiveId: executive.uid || executive.email || executive.id,
        recipientId: executive.email,
        bankEvent: {
          action: "executive-created",
          executiveId: executive.id,
          email: executive.email,
          name: executive.name,
        },
      },
    });
    Promise.resolve().then(() => createNotification({
      type: "USER_CREATED",
      title: "Welcome to CarLoanSaathi",
      message: "Congratulations!\n\nYour Loan Executive account has been activated.",
      recipientRole: "loan-executive",
      recipientId: executive.email || email,
      recipientEmail: executive.email || email,
      priority: "success",
      entityType: "user",
      entityId: executive.email || email,
      actionUrl: "/loan-executive/leads",
      bankId: identity.bankId,
      assignedExecutiveId: executive.uid || executive.email || executive.id,
      createdBy: partner.email || partner.id || req.user?.email || "bank-manager",
      meta: {
        memberName: executive.name || name,
        roleLabel: "Loan Executive",
        bankId: identity.bankId,
        assignedExecutiveId: executive.uid || executive.email || executive.id,
        assignedExecutiveEmail: executive.email || email,
        dedupeKey: "loan-executive-created",
      },
    })).catch((error) => logError("Loan executive created notification failed", { error: error.message, executiveId: executive.id || email }));
    const { temporaryPasswordHash: _temporaryPasswordHash, ...safeExecutive } = executive;
    res.status(201).json({
      ...safeExecutive,
      portalLogin: `${process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || "https://carloansaathi.com"}/executive/login`,
      temporaryPassword,
    });
  } catch (error) {
    next(error);
  }
}

export async function removeBankExecutive(req, res, next) {
  try {
    const partner = await currentPartner(req);
    if (!partner || partner.roleType !== "bank-manager") return res.status(403).json({ message: "Only bank managers can delete executives" });
    const identity = bankIdentity(partner);
    const executive = await resolveBankExecutiveForMutation(identity, req.params.executiveId);
    if (!executive || !executiveBelongsToBank(executive, identity)) return res.status(404).json({ message: "Executive not found for this bank" });
    const email = cleanText(executive.email || executive.officialEmail || executive.id);
    const uid = String(executive.uid || executive.authUid || "").trim();
    const mobile = String(executive.mobile || "").replace(/\D/g, "").slice(-10);
    const assignedLeads = await collectExecutiveLeads({ identity, uid, email, mobile });
    const activeLeads = activeExecutiveLeads(assignedLeads);
    if (activeLeads.length) {
      return res.status(409).json({
        code: "ACTIVE_EXECUTIVE_LEADS",
        message: "Executive has active cases.",
        action: "TRANSFER_LEADS_REQUIRED",
        activeLeadCount: activeLeads.length,
        transferUrl: `/bank-manager/executives/${encodeURIComponent(executive.id || email)}/cases`,
      });
    }
    const deleted = {};
    const removedAt = new Date().toISOString();
    const matchesExecutive = (item = {}) => {
      const itemEmail = cleanText(item.email || item.officialEmail || item.id);
      const itemUid = String(item.uid || item.authUid || "").trim();
      return Boolean(
        (email && itemEmail === email)
        || (uid && itemUid === uid)
        || String(item.id || "") === executive.id
      );
    };

    for (const collection of ["loanExecutives", "users"]) {
      deleted[collection] = await deleteMatchingRecords(collection, matchesExecutive, [
        [{ field: "email", value: email }],
        [{ field: "officialEmail", value: email }],
        ...(uid ? [[{ field: "uid", value: uid }], [{ field: "authUid", value: uid }]] : []),
      ]);
    }

    const affectedLeadCount = await clearExecutiveLeadAssignments({ identity, uid, email, mobile, removedAt });
    deleted.linkedRecords = await cleanupExecutiveLinkedRecords({ executive, uid, email, mobile });
    await deleteExecutiveSummaryProjection(identity, executive);
    clearBankSummaryCaches();

    await revokeUserSessions(email, "bank-executive-permanent-delete").catch(() => {});
    let authDeleted = false;
    if (firebaseAdmin && email) {
      try {
        const firebaseUser = await firebaseAdmin.auth().getUserByEmail(email);
        await firebaseAdmin.auth().deleteUser(firebaseUser.uid);
        authDeleted = true;
      } catch (firebaseError) {
        if (firebaseError.code !== "auth/user-not-found") throw firebaseError;
      }
    }

    await writeAuditLog({
      req,
      actionType: "BANK_EXECUTIVE_DELETED",
      oldValue: executive.status,
      newValue: "deleted",
      meta: {
        deletedBy: partner.email || partner.id || req.user?.email,
        deletedExecutive: executive.name || executive.fullName || email,
        deletedAt: removedAt,
        branch: executive.bankBranchLocation || executive.branchCity || identity.bankLocation || null,
        bankIfsc: executive.bankIfsc || executive.ifsc || identity.bankIfsc || null,
        reason: req.body?.reason || "bank-manager-delete",
        executiveId: executive.id,
        bankId: identity.bankId,
        email,
        uid,
        deleted,
        affectedLeadCount,
        authDeleted,
      },
    });
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.BANK_EXECUTIVE_DELETED,
      actor: req.user,
      data: {
        bankId: identity.bankId,
        branchId: executive.branchId || identity.bankLocation,
        bankIfsc: executive.bankIfsc || executive.ifsc || identity.bankIfsc || null,
        executiveId: uid || email || executive.id,
        recipientId: email,
        bankEvent: {
          action: "executive-deleted",
          executiveId: executive.id,
          email,
        },
      },
    });
    Promise.resolve().then(() => createNotification({
      type: "EXECUTIVE_REMOVED",
      title: "Loan Executive Removed",
      message: `Loan Executive ${executive.name || executive.fullName || email} has been removed successfully.`,
      recipientRole: "bank-manager",
      recipientId: identity.bankId,
      priority: "medium",
      entityType: "user",
      entityId: email || executive.id,
      actionUrl: "/bank-manager/executives",
      bankId: identity.bankId,
      assignedExecutiveId: uid || email || executive.id,
      createdBy: partner.email || partner.id || req.user?.email || "bank-manager",
      meta: {
        memberName: executive.name || executive.fullName || email,
        roleLabel: "Loan Executive",
        removedEmail: email,
        bankId: identity.bankId,
        dedupeKey: "loan-executive-removed",
      },
    })).catch((error) => logError("Loan executive removed notification failed", { error: error.message, executiveId: executive.id || email }));
    res.json({ message: "Executive permanently deleted", deleted, affectedLeadCount, authDeleted });
  } catch (error) {
    next(error);
  }
}

export async function getBankExecutiveCases(req, res, next) {
  try {
    const partner = await currentPartner(req);
    if (!partner || partner.roleType !== "bank-manager") return res.status(403).json({ message: "Only bank managers can view executive cases" });
    const identity = bankIdentity(partner);
    const projectedExecutives = await queryExecutiveSummaryProjection({ bankId: identity.bankId, query: { limit: 100 } }).catch(() => null);
    let executive = (projectedExecutives || []).find((item) =>
      anyMatch(
        [item.sourceId, item.executiveId, item.id, item.email, item.mobile],
        [req.params.executiveId],
      )
    );
    if (executive) {
      logProjectionRead("PROJECTION-HIT", req, { collection: "executiveSummaryProjection", executiveId: req.params.executiveId });
    } else {
      logProjectionRead("PROJECTION-MISS", req, { collection: "executiveSummaryProjection", executiveId: req.params.executiveId, reason: "missing_executive_summary" });
      logProjectionRead("CANONICAL-FALLBACK", req, { collection: "loanExecutives", executiveId: req.params.executiveId });
      executive = await getRecord("loanExecutives", req.params.executiveId);
    }
    if (!executive || !executiveBelongsToBank(executive, identity)) return res.status(404).json({ message: "Executive not found for this bank" });
    const rows = await cached(`bank:executive-cases:${identity.bankId}:${executive.id || executive.email}:${JSON.stringify(req.query || {})}`, 10000, async () => {
      const executiveActor = {
        ...executive,
        role: "loan-executive",
        uid: executive.sourceId || executive.executiveId || executive.uid || executive.id || executive.email,
      };
      const projected = await queryLeadProjectionForUser({
        user: executiveActor,
        query: { ...req.query, limit: req.query.limit || 100 },
        recordMetrics: false,
      }).catch(() => null);
      if (projected?.data) logProjectionRead("PROJECTION-HIT", req, { collection: "executiveViews", resultCount: projected.data.length });
      else logProjectionRead("PROJECTION-MISS", req, { collection: "executiveViews", reason: "missing_executive_lead_view" });
      logProjectionRead("CANONICAL-FALLBACK", req, { collection: "leads", executiveId: executive.sourceId || executive.executiveId || executive.id || executive.email });
      const candidates = await Promise.all([
        queryExecutiveLeads({ ...executiveQueryArgs(executiveActor), query: req.query }),
      ]);
      const byId = new Map();
      [...(projected?.data || []), ...candidates.flatMap((page) => page.data || [])].forEach((lead) => {
        const key = lead.sourceId || lead.id || lead.caseId;
        if (key && partnerCanAccessLead(partner, lead) && loanExecutiveMatchesLead(executiveActor, lead)) {
          byId.set(key, { ...lead, id: lead.sourceId || lead.id });
        }
      });
      return [...byId.values()];
    });
    res.json({ data: rows, executive });
  } catch (error) {
    next(error);
  }
}
