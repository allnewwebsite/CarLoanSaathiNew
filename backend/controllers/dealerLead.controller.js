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
import { recordLeadAssignmentFailure, validateLeadAssignmentIntegrity } from "../services/assignmentIntegrity.service.js";

void DEALER_SHARED_SENTINEL;
export async function createDealerLead(req, res, next) {
  try {
    const { email, dealershipEmail, dealership } = await financeDeskContext(req);
    logInfo("Finance Desk lead creation requested", { requestId: req.requestId, dealershipId: dealershipEmail });

    const dealershipId = dealership.id || dealershipEmail;
    const dealerBrand = dealership.dealershipBrand || dealership.brand || req.body.selectedBrand || req.body.carBrand;

    // ===== NEW WORKFLOW: MANDATORY BRANCH SELECTION =====
    // Get IFSC code from request - REQUIRED
    const ifscCode = String(req.body.ifscCode || req.body.bankBranchId || req.body.branchId || "").trim().toUpperCase();
    if (!ifscCode) {
      return res.status(400).json({
        message: "Bank branch selection is required",
        code: "IFSC_CODE_REQUIRED"
      });
    }

    // Validate IFSC format
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
      return res.status(400).json({
        message: "Invalid IFSC code format",
        code: "INVALID_IFSC_FORMAT"
      });
    }

    // Validate that dealership has this tie-up
    let branchTieUp;
    try {
      branchTieUp = await validateBranchTieUp(dealershipId, ifscCode);
    } catch (error) {
      return res.status(400).json({
        message: "Selected bank branch is not tied up with your dealership",
        code: "BRANCH_NOT_TIEDUP"
      });
    }

    // Validate salesperson
    const salespersonId = salespersonIdFrom(req.body.salespersonId);
    if (!salespersonId) {
      return res.status(400).json({ message: "Salesperson selection is required" });
    }

    const financeManagerId = financeManagerIdFrom(req.body.financeManagerId);
    if (!financeManagerId) {
      return res.status(400).json({ message: "Finance Manager selection is required" });
    }
    let salesperson;
    let financeManager;
    try {
      ({ salesperson, financeManager } = await validateDealerLeadAssignees({ salespersonId, financeManagerId, dealershipId }));
    } catch (error) {
      return res.status(error.status || 400).json({ message: error.message });
    }

    // Normalize and validate lead data
    const payload = normalizeFinanceDeskLead({
      ...req.body,
      selectedBrand: dealerBrand,
      carBrand: dealerBrand,
      ifscCode,
      branchIfsc: ifscCode,
      branchId: branchTieUp.bankId || branchTieUp.id || ifscCode,
      bankBranchId: branchTieUp.bankId || branchTieUp.id || ifscCode,
      bankId: branchTieUp.bankId,
      bankName: branchTieUp.bankName,
      branchName: branchTieUp.branchName,
      branchLocation: branchTieUp.branchLocation || branchTieUp.bankBranchLocation || branchTieUp.city || branchTieUp.branchCity || "",
      state: branchTieUp.state || dealership.state || "",
      salespersonId,
      assignedSalesperson: salesperson.name,
      financeManagerId: financeManager?.id || "",
      financeManagerName: financeManager?.name || "",
      assignedFinanceManager: financeManager?.name || "Unassigned",
    });

    const dealershipCity = dealership.city || dealership.registeredCity || payload.city;
    const bankBranchCity = branchTieUp.city || branchTieUp.branchCity || branchTieUp.bankBranchCity || branchTieUp.branchName || dealershipCity;
    const now = new Date().toISOString();
    const caseId = await generateLeadCaseId();

    // Create lead with new fields
    const leadPayload = sanitizeFirestoreData({
      ...payload,
      caseId,
      selectedBrand: dealerBrand,
      carBrand: dealerBrand,
      carOnRoadPrice: payload.carPrice,
      requiredLoanAmount: payload.loanAmount,

      // Dealership scope
      dealerEmail: dealershipId,
      dealershipEmail: dealershipId,
      dealershipId,
      dealershipName: dealership.dealershipName || dealership.name || "",
      dealershipCity,
      routingCity: bankBranchCity,

      // Bank branch (new requirement)
      ifscCode,
      branchIfsc: ifscCode,
      bankIfsc: ifscCode,
      branchId: branchTieUp.bankId || branchTieUp.id || ifscCode,
      bankBranchId: branchTieUp.bankId || branchTieUp.id || ifscCode,
      bankBranchCity,
      branchCity: bankBranchCity,
      branchLocation: bankBranchCity,
      bankBranchLocation: bankBranchCity,
      state: branchTieUp.state || dealership.state || "",
      bankId: branchTieUp.bankId,
      bankName: branchTieUp.bankName,
      branchName: branchTieUp.branchName,
      assignedBankId: branchTieUp.bankId,
      assignedPartnerId: branchTieUp.bankId,
      assignedBankName: branchTieUp.bankName,
      assignedBankIfsc: ifscCode,
      selectedBankName: branchTieUp.bankName,
      selectedBranchName: branchTieUp.branchName,
      selectedBankBranchId: branchTieUp.bankId || branchTieUp.id || ifscCode,

      // Salesperson
      salespersonId: salesperson.id,
      salespersonName: salesperson.name,
      salespersonJobId: salesperson.jobId || "",
      salespersonEmail: salesperson.email || "",
      assignedSalesperson: salesperson.name,

      // Finance Manager ownership
      financeManagerId: financeManager?.id || "",
      financeManagerName: financeManager?.name || "",
      financeManagerMobile: financeManager?.mobile || "",
      financeManagerEmail: financeManager?.email || "",
      financeManagerEmployeeId: financeManager?.employeeId || "",
      assignedFinanceManager: financeManager?.name || "Unassigned",

      // Metadata
      createdBy: dealershipId,
      source: "Dealer Dashboard",
      status: LEAD_STATUSES.NEW,
      generatedDate: now.slice(0, 10),
      generatedTime: now.slice(11, 19),
      generatedAt: now,
    });

    const lead = await createRecord("leads", leadPayload);
    clearLeadSyncCaches(lead.id);

    runDealerLeadSideEffects("dealer-lead-created", [
      () => syncLeadProjectionSoon(lead),
      () => writeAuditLog({
        req,
        actionType: AUDIT_ACTIONS.LEAD_CREATED,
        newValue: { caseId: lead.caseId, customerName: lead.fullName, ifscCode },
        leadId: lead.id,
        dealershipId,
        meta: { caseId: lead.caseId, dealershipId, ifscCode, bankName: branchTieUp.bankName },
      }),
      () => addTimelineEvent({
        leadId: lead.id,
        eventType: TIMELINE_EVENTS.LEAD_CREATED,
        title: "Lead Created",
        description: `Finance Desk created lead - ${branchTieUp.bankName} ${branchTieUp.branchName}`,
        actorName: email,
        actorRole: req.user?.role || "finance-desk",
        dealershipId,
        branchId: branchTieUp.bankId,
        metadata: {
          customerName: lead.fullName,
          dealershipName: lead.dealershipName,
          ifscCode,
          bankName: branchTieUp.bankName,
          branchName: branchTieUp.branchName,
        },
      }),
    ]);

    runDealerLeadSideEffects("dealer-lead-auto-assignment", [
      async () => {
        try {
          const assignedLead = await reassignLeadToNextBranchExecutive(lead.id, "lead-created-auto-assignment", email);
          clearLeadSyncCaches(assignedLead.id || lead.id);
          publishRealtimeEvent({
            eventType: REALTIME_EVENTS.EXECUTIVE_ASSIGNED,
            lead: assignedLead,
            actor: req.user,
            data: {
              dealershipId,
              bankId: assignedLead.bankId || branchTieUp.bankId,
              branchId: assignedLead.branchId || assignedLead.bankBranchId || branchTieUp.bankId,
              executiveId: assignedLead.assignedExecutiveId || assignedLead.assignedExecutiveEmail || "",
              recipientId: assignedLead.assignedExecutiveId || assignedLead.assignedExecutiveEmail || "",
              assignedExecutiveId: assignedLead.assignedExecutiveId || "",
              assignedExecutiveEmail: assignedLead.assignedExecutiveEmail || "",
              assignedExecutiveMobile: assignedLead.assignedExecutiveMobile || "",
            },
          });
          await queueLeadAssignedWhatsApp(assignedLead);
          await validateLeadAssignmentIntegrity(assignedLead, { repair: true, source: "dealer-lead-auto-assignment" });
        } catch (assignmentError) {
          await recordLeadAssignmentFailure(lead, assignmentError, { source: "dealer-lead-auto-assignment" });
          logInfo("Dealer lead created without executive auto-assignment", {
            requestId: req.requestId,
            leadId: lead.id,
            caseId: lead.caseId,
            dealershipId,
            bankId: branchTieUp.bankId,
            ifscCode,
            reason: assignmentError.message,
          });
        }
      },
    ]);

    logInfo("Finance Desk lead created", {
      requestId: req.requestId,
      leadId: lead.id,
      caseId: lead.caseId,
      dealershipId,
      ifscCode,
    });
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.LEAD_CREATED,
      lead,
      actor: req.user,
      data: { dealershipId, bankId: lead.bankId || branchTieUp.bankId },
    });

    res.status(201).json({
      success: true,
      leadId: lead.id,
      caseId: lead.caseId,
      message: "Lead created successfully",
      lead,
    });
  } catch (error) {
    if (error?.issues) {
      return res.status(400).json({ message: readableLeadError(error) });
    }
    next(error);
  }
}

export async function getDealerLeads(req, res, next) {
  const startedAt = Date.now();
  const requestStartedAt = Number(res.locals.startedAt || startedAt);
  let authStarted, authEnded, queryStarted, queryEnded;
  let projectionStarted, projectionEnded, fallbackStarted, fallbackEnded;
  let projectionError = null;
  let fallbackTriggered = false;
  try {
    authStarted = Date.now();
    const { dealershipEmail } = await financeDeskContext(req);
    authEnded = Date.now();
    queryStarted = Date.now();
    projectionStarted = Date.now();
    const projectionPage = await queryLeadProjectionForUser({
      user: { ...req.user, role: "finance-desk", dealershipId: dealershipEmail },
      query: req.query,
      requestId: req.requestId,
    }).catch((error) => {
      projectionError = error;
      return null;
    });
    projectionEnded = Date.now();
    let page = projectionPage;
    if (!page) {
      fallbackTriggered = true;
      fallbackStarted = Date.now();
      page = await queryDealershipLeads({ dealershipId: dealershipEmail, query: req.query, requestId: req.requestId });
      fallbackEnded = Date.now();
    }
    queryEnded = Date.now();
    const rowCount = Array.isArray(page?.data) ? page.data.length : 0;
    const fieldCounts = Array.isArray(page?.data) ? page.data.map((item) => Object.keys(item || {}).length) : [];
    const maxFieldCount = fieldCounts.length ? Math.max(...fieldCounts) : 0;
    const totalFieldCount = fieldCounts.reduce((sum, count) => sum + count, 0);
    logInfo("Dealer leads serialization breakdown", {
      tag: "SERIALIZATION-LATENCY",
      requestId: req.requestId,
      path: req.originalUrl,
      function: "getDealerLeads",
      file: "backend/controllers/dealer.controller.js",
      responseShapeDurationMs: 0,
      leadEnrichmentDurationMs: 0,
      financeManagerLookupCount: 0,
      executiveLookupCount: 0,
      dealershipLookupCount: 0,
      documentFormattingCount: 0,
      jsonStringifyDurationMs: 0,
      jsonParseDurationMs: 0,
      rowCount,
      totalFieldCount,
      maxFieldCount,
      responseBytes: null,
      fallbackTriggered,
      projectionDurationMs: projectionEnded - projectionStarted,
      fallbackDurationMs: fallbackTriggered ? fallbackEnded - fallbackStarted : 0,
      controllerDurationMs: Date.now() - startedAt,
      totalDurationMs: Date.now() - requestStartedAt,
    });
    logInfo("Dealer leads latency breakdown", {
      tag: "PROJECTION-LATENCY",
      requestId: req.requestId,
      path: req.originalUrl,
      role: req.user?.role,
      authDurationMs: startedAt - requestStartedAt,
      financeContextDurationMs: authEnded - authStarted,
      projectionDurationMs: projectionEnded - projectionStarted,
      projectionResultCount: Array.isArray(projectionPage?.data) ? projectionPage.data.length : 0,
      projectionError: projectionError ? projectionError.code || projectionError.message : null,
      fallbackTriggered,
      fallbackDurationMs: fallbackTriggered ? fallbackEnded - fallbackStarted : 0,
      fallbackResultCount: fallbackTriggered && Array.isArray(page?.data) ? page.data.length : 0,
      queryDurationMs: queryEnded - queryStarted,
      serializationDurationMs: 0,
      controllerDurationMs: Date.now() - startedAt,
      totalDurationMs: Date.now() - requestStartedAt,
      responseBytes: null,
    });
    logInfo("Dealer lead query completed", {
      requestId: req.requestId,
      path: req.originalUrl,
      role: req.user?.role,
      totalMs: Date.now() - startedAt,
      authMs: authEnded - authStarted,
      queryMs: queryEnded - queryStarted,
      serializeMs: 0,
      warmup: String(req.headers["x-cls-warmup"] || "").toLowerCase() === "true",
      dataCount: Array.isArray(page?.data) ? page.data.length : undefined,
    });
    res.json(page);
  } catch (error) {
    next(error);
  }
}

export async function getDealerLead(req, res, next) {
  try {
    const { email, dealershipEmail } = await financeDeskContext(req);
    const projection = await getLeadDetailProjection(req.params.id).catch(() => null);
    if (projection && dealerCanReadProjectedLead(projection, email, dealershipEmail) && Array.isArray(projection.bankDocuments)) {
      logProjectionRead("PROJECTION-HIT", req, { collection: "leadDetailsProjection", leadId: req.params.id });
      return res.json(leadDetailResponseFromProjection(projection, { bankDocuments: projection.bankDocuments || [] }));
    }
    logProjectionRead("PROJECTION-MISS", req, {
      collection: "leadDetailsProjection",
      leadId: req.params.id,
      reason: projection ? "invalid_or_unauthorized_projection" : "missing_projection",
    });
    logProjectionRead("CANONICAL-FALLBACK", req, { collection: "leads", leadId: req.params.id });
    const lead = await getRecord("leads", req.params.id);
    if (!lead || !owned([lead], email, dealershipEmail).length) return res.status(404).json({ message: "Lead not found" });
    const bankDocumentsPage = await queryRecords("bankDocuments", {
      where: [{ field: "leadId", value: lead.id }],
      orderBy: "createdAt",
      direction: "desc",
      limit: 50,
      maxLimit: 50,
    }).catch(() => ({ data: [] }));
    res.json({ ...lead, bankDocuments: bankDocumentsPage.data || [] });
  } catch (error) {
    next(error);
  }
}

export async function getDealerEarnings(req, res, next) {
  try {
    const { dealershipEmail } = await financeDeskContext(req);
    const projected = await queryLeadProjectionForUser({
      user: { ...req.user, role: "finance-desk", dealershipId: dealershipEmail },
      query: { limit: 100 },
      requestId: req.requestId,
      recordMetrics: false,
    }).catch(() => null);
    let leads;
    if (projected?.data) {
      logProjectionRead("PROJECTION-HIT", req, { collection: "financeViews", resultCount: projected.data.length });
      leads = projected.data;
    } else {
      logProjectionRead("PROJECTION-MISS", req, { collection: "financeViews", reason: "missing_projection_page" });
      logProjectionRead("CANONICAL-FALLBACK", req, { collection: "leads", estimatedLimit: 100 });
      leads = (await queryDealershipLeads({ dealershipId: dealershipEmail, query: { limit: 100 } })).data;
    }
    const disbursed = leads.filter((lead) => normalizeStatus(lead.status) === LEAD_STATUSES.DISBURSED);
    const approved = leads.filter((lead) => normalizeStatus(lead.status) === LEAD_STATUSES.APPROVED);
    res.json({
      totalEarnings: disbursed.reduce((sum, lead) => sum + Math.round(Number(lead.loanAmount || 0) * 0.01), 0),
      pendingEarnings: approved.reduce((sum, lead) => sum + Math.round(Number(lead.loanAmount || 0) * 0.005), 0),
      disbursedCount: disbursed.length,
      approvedCount: approved.length,
    });
  } catch (error) {
    next(error);
  }
}
