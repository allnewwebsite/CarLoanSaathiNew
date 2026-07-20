import {
  ACTIVE_EXPORT_SENTINEL,
  addTimelineEvent,
  ALERT_SEVERITY,
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
  canonicalizeBankDealershipRows,
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

void ACTIVE_EXPORT_SENTINEL;
export async function getBankLeads(req, res, next) {
  const startedAt = Date.now();
  let authStarted, authEnded, queryStarted, queryEnded;
  try {
    authStarted = Date.now();
    const partner = await currentPartner(req);
    authEnded = Date.now();
    if (!partner) return res.status(404).json({ message: "Bank partner profile not found" });
    let response;
    queryStarted = Date.now();
    if (partner.roleType === "loan-executive") {
      const { limit } = paginationParams(req.query);
      const scopedLeads = await assignedLeadsForPartner(partner, { ...req.query, limit });
      response = pageResponse({ data: scopedLeads.slice(0, limit), limit, nextCursor: null, total: scopedLeads.length });
      queryEnded = Date.now();
      logInfo("Bank executive lead query completed", {
        requestId: req.requestId,
        path: req.originalUrl,
        role: req.user?.role,
        totalMs: Date.now() - startedAt,
        authMs: authEnded - authStarted,
        queryMs: queryEnded - queryStarted,
        serializeMs: 0,
        warmup: String(req.headers["x-cls-warmup"] || "").toLowerCase() === "true",
        dataCount: Array.isArray(response?.data) ? response.data.length : undefined,
      });
      return res.json(response);
    }
    const { limit } = paginationParams(req.query);
    const scopedLeads = await assignedLeadsForPartner(partner, { ...req.query, limit: Math.min(Math.max(limit * 3, limit), 100) });
    queryEnded = Date.now();
    const data = scopedLeads.slice(0, limit);
    await recordOperationalEvent({
      type: "bank_leads_scoped",
      severity: ALERT_SEVERITY.LOW,
      component: "bank-rbac",
      message: "Bank manager lead list tenant scoped",
      entityId: partner.email || partner.id,
      requestId: req.requestId,
      meta: { returned: data.length, bankId: bankIdentity(partner).bankId, branchId: partner.branchId || partner.branchCity || partner.bankBranchLocation },
    });
    const page = pageResponse({ data, limit, nextCursor: null, total: scopedLeads.length });
    logInfo("Bank manager lead query completed", {
      requestId: req.requestId,
      path: req.originalUrl,
      role: req.user?.role,
      totalMs: Date.now() - startedAt,
      authMs: authEnded - authStarted,
      queryMs: queryEnded - queryStarted,
      serializeMs: 0,
      warmup: String(req.headers["x-cls-warmup"] || "").toLowerCase() === "true",
      dataCount: data.length,
    });
    return res.json(page);
  } catch (error) {
    next(error);
  }
}

export async function getBankDealerships(req, res, next) {
  try {
    const partner = await currentPartner(req);
    if (!partner || partner.roleType !== "bank-manager") return res.status(403).json({ message: "Only bank managers can view dealership activity" });
    const identity = bankIdentity(partner);
    const cacheKey = `bank:dealerships:${identity.bankId}:${req.query.page || 1}:${req.query.limit || 20}:${String(req.query.search || "").trim().toLowerCase()}`;
    const projected = await cached(cacheKey, 20000, () => queryBankDealershipProjection({ bankId: identity.bankId, query: req.query }).catch(() => null));
    if (projected) return res.json(projected);

    const { limit } = paginationParams({ ...req.query, limit: req.query.limit || 20 });
    const scopedLeads = await assignedLeadsForPartner(partner, { ...req.query, limit: 100 });
    const grouped = groupDealershipsFromLeads(scopedLeads);
    const canonicalRows = await canonicalizeBankDealershipRows(grouped);
    return res.json(pageResponse({ data: canonicalRows.slice(0, limit), limit, total: canonicalRows.length }));
  } catch (error) {
    next(error);
  }
}

export async function getBankDealershipDisbursedCases(req, res, next) {
  try {
    const partner = await currentPartner(req);
    if (!partner || partner.roleType !== "bank-manager") return res.status(403).json({ message: "Only bank managers can view dealership disbursed cases" });
    const identity = bankIdentity(partner);
    const dealershipId = String(req.params.dealershipId || "").trim();
    if (!dealershipId) return res.status(400).json({ message: "Dealership is required" });
    const projected = await queryLeadProjectionForUser({
      user: { ...req.user, role: "bank-manager", bankId: identity.bankId },
      query: { ...req.query, dealershipId, status: LEAD_STATUSES.DISBURSED },
    }).catch(() => null);
    if (projected) {
      const [canonical] = await canonicalizeBankDealershipRows([{ dealershipId }]);
      if (!canonical) return res.status(404).json({ message: "Registered dealership not found" });
      return res.json({
        ...projected,
        data: (projected.data || []).map((lead) => ({ ...lead, dealershipId, dealershipName: canonical.dealershipName })),
      });
    }

    const { limit } = paginationParams({ ...req.query, limit: req.query.limit || 20 });
    const scopedLeads = await assignedLeadsForPartner(partner, { ...req.query, status: LEAD_STATUSES.DISBURSED, limit: 100 });
    const data = scopedLeads
      .filter((lead) => dealershipIdentityFromLead(lead)?.dealershipId === dealershipId && normalizeStatus(lead.status) === LEAD_STATUSES.DISBURSED)
      .slice(0, limit);
    const [canonical] = await canonicalizeBankDealershipRows([{ dealershipId }]);
    if (!canonical) return res.status(404).json({ message: "Registered dealership not found" });
    return res.json(pageResponse({ data: data.map((lead) => ({ ...lead, dealershipName: canonical.dealershipName })), limit, total: data.length }));
  } catch (error) {
    next(error);
  }
}

export async function getBankLead(req, res, next) {
  try {
    const partner = await currentPartner(req);
    if (!partner) return res.status(404).json({ message: "Bank partner profile not found" });
    const cacheActor = [partner.roleType, partner.id, partner.email, partner.bankId, partner.branchId].filter(Boolean).join(":");
    const detailCacheKey = `lead-detail:${req.params.id}:bank-response:${cacheActor}`;
    let detailCacheHit = true;
    const response = await cached(detailCacheKey, 10000, async () => {
      detailCacheHit = false;
      const projection = await getLeadDetailProjection(req.params.id).catch(() => null);
      if (
        projection
        && projectedLeadHasRequiredBankScope(partner, projection)
        && partnerCanAccessLead(partner, projection)
        && Array.isArray(projection.documents)
        && Array.isArray(projection.bankDocuments)
      ) {
        logProjectionRead("PROJECTION-HIT", req, { collection: "leadDetailsProjection", leadId: req.params.id });
        return leadDetailResponseFromProjection(projection, {
          documents: projection.documents || [],
          bankDocuments: projection.bankDocuments || [],
        });
      }
      if (projection && projectedLeadHasRequiredBankScope(partner, projection) && !partnerCanAccessLead(partner, projection)) {
        logProjectionRead("PROJECTION-HIT", req, { collection: "leadDetailsProjection", leadId: req.params.id, result: "denied" });
        emitBankLeadAccessDenied(req, partner);
        const error = new Error("Lead not assigned to this bank partner");
        error.status = 403;
        throw error;
      }
      logProjectionRead("PROJECTION-MISS", req, {
        collection: "leadDetailsProjection",
        leadId: req.params.id,
        reason: projection ? "invalid_projection_for_bank_scope_or_response" : "missing_projection",
      });
      logProjectionRead("CANONICAL-FALLBACK", req, { collection: "leads", leadId: req.params.id });
      const { partner: canonicalPartner, lead } = await requireAssignedLead(req);
      const [hydratedLead] = await attachExecutiveMobile(canonicalPartner, [lead]);
      const { hydratedDocuments, hydratedBankDocuments } = await cached(`lead-detail:${hydratedLead.id}:bank-docs:v2`, 10000, async () => {
        const documentLeadIds = [...new Set([hydratedLead.id, hydratedLead.caseId].filter(Boolean))];
        const leadDocuments = async (collection) => {
          if (!documentLeadIds.length) return [];
          const page = await queryRecords(collection, {
            where: [{ field: "leadId", op: "in", value: documentLeadIds.slice(0, 10) }],
            orderBy: "leadId",
            direction: "asc",
            limit: 50,
            maxLimit: 50,
            fields: LEAD_DOCUMENT_FIELDS,
          });
          const byId = new Map();
          page.data.forEach((document) => byId.set(document.id, document));
          return [...byId.values()].sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || ""))).slice(0, 50);
        };
        const [documents, bankDocuments] = await Promise.all([
          leadDocuments("documents"),
          leadDocuments("bankDocuments"),
        ]);
        const hydrateDocumentUrls = async (rows) => Promise.all(rows.map(async (document) => ({
          ...document,
          url: document.url || document.fileUrl || document.downloadUrl || await createShortLivedDocumentUrl(document.storagePath || document.filePath),
        })));
        return {
          hydratedDocuments: await hydrateDocumentUrls(documents),
          hydratedBankDocuments: await hydrateDocumentUrls(bankDocuments),
        };
      });
      syncLeadDetailProjection(hydratedLead, {
        documents: hydratedDocuments,
        bankDocuments: hydratedBankDocuments,
      }).catch(() => {});
      return {
        ...hydratedLead,
        documents: hydratedDocuments,
        bankDocuments: hydratedBankDocuments,
      };
    });
    if (detailCacheHit) logReadMetric("CACHE-HIT", req, { endpoint: "GET /api/bank/leads/:id", cacheKey: detailCacheKey, estimatedReads: 0 });
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function getBankNotifications(req, res, next) {
  try {
    const partner = await currentPartner(req);
    if (!partner) return res.status(404).json({ message: "Bank partner profile not found" });
    const projected = await queryNotificationProjectionForUser({ user: req.user, query: { ...req.query, limit: req.query.limit || 40 } }).catch(() => null);
    if (projected) return res.json(projected.data || []);
    const leads = await cached(`bank:notifications:${partner.roleType}:${partner.bankId || partner.bankPartnerId || partner.id || ""}:${partner.email || ""}`, 15000, () => assignedLeadsForPartner(partner, { limit: 40 }));
    const rows = leads
      .filter((lead) => {
        const status = normalizeStatus(lead.status);
        return [LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.DOCUMENT_RECEIVED, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING, LEAD_STATUSES.UNDER_BANK_PROCESS, LEAD_STATUSES.APPROVED, LEAD_STATUSES.REJECTED, LEAD_STATUSES.DISBURSED, LEAD_STATUSES.ASSIGNED].includes(status);
      })
      .slice(0, 40)
      .map((lead) => ({
        id: lead.id,
        caseId: lead.caseId,
        title: `${STATUS_LABELS[normalizeStatus(lead.status)] || "Lead"} update`,
        message: `${lead.fullName || lead.customerName || "Customer"} - ${lead.assignedExecutiveName || "Auto queue"}`,
        status: normalizeStatus(lead.status),
        createdAt: lead.updatedAt || lead.createdAt || lead.assignmentTimestamp,
      }));
    res.json(rows);
  } catch (error) {
    next(error);
  }
}

export async function getBankLeadTimeline(req, res, next) {
  try {
    await requireAssignedLead(req);
    const projected = await queryTimelineProjection({ leadId: req.params.id, actor: req.user, query: req.query }).catch(() => null);
    if (projected) return res.json(projected.data || []);
    res.json(await getTimelineForLead(req.params.id));
  } catch (error) {
    next(error);
  }
}
