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
export async function getAdminLeads(req, res, next) {
  const startedAt = Date.now();
  let queryStarted, queryEnded, enrichStarted, enrichEnded;
  try {
    queryStarted = Date.now();
    const projectedPage = await queryLeadProjectionForUser({ user: req.user, query: req.query }).catch(() => null);
    const page = projectedPage || await queryAllLeads({ query: req.query });
    queryEnded = Date.now();
    enrichStarted = Date.now();
    const response = { ...page, data: await enrichAdminLeadRows(page.data) };
    enrichEnded = Date.now();
    logInfo("Admin lead query completed", {
      requestId: req.requestId,
      path: req.originalUrl,
      role: req.user?.role,
      totalMs: Date.now() - startedAt,
      queryMs: queryEnded - queryStarted,
      enrichMs: enrichEnded - enrichStarted,
      serializeMs: 0,
      warmup: String(req.headers["x-cls-warmup"] || "").toLowerCase() === "true",
      dataCount: Array.isArray(response?.data) ? response.data.length : undefined,
    });
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function getAdminLead(req, res, next) {
  try {
    const projection = await getLeadDetailProjection(req.params.id).catch(() => null);
    if (projection && Array.isArray(projection.documents) && Array.isArray(projection.bankDocuments)) {
      recordMonitoringSignal("PROJECTION-HIT", {
        endpoint: req.route?.path,
        path: req.originalUrl,
        collection: "leadDetailsProjection",
        leadId: req.params.id,
      });
      logInfo("PROJECTION-HIT", {
        tag: "PROJECTION-HIT",
        requestId: req.requestId,
        path: req.originalUrl,
        endpoint: req.route?.path,
        collection: "leadDetailsProjection",
        leadId: req.params.id,
      });
      return res.json(leadDetailResponseFromProjection(projection, {
        documents: projection.documents || [],
        bankDocuments: projection.bankDocuments || [],
      }));
    }
    recordMonitoringSignal("PROJECTION-MISS", {
      endpoint: req.route?.path,
      path: req.originalUrl,
      collection: "leadDetailsProjection",
      leadId: req.params.id,
      reason: projection ? "invalid_projection" : "missing_projection",
    });
    logInfo("PROJECTION-MISS", {
      tag: "PROJECTION-MISS",
      requestId: req.requestId,
      path: req.originalUrl,
      endpoint: req.route?.path,
      collection: "leadDetailsProjection",
      leadId: req.params.id,
      reason: projection ? "invalid_projection" : "missing_projection",
    });
    recordMonitoringSignal("CANONICAL-FALLBACK", {
      endpoint: req.route?.path,
      path: req.originalUrl,
      collection: "leads",
      leadId: req.params.id,
    });
    logInfo("CANONICAL-FALLBACK", {
      tag: "CANONICAL-FALLBACK",
      requestId: req.requestId,
      path: req.originalUrl,
      endpoint: req.route?.path,
      collection: "leads",
      leadId: req.params.id,
    });
    let lead = await getRecord("leads", req.params.id);
    if (!lead) {
      const page = await queryRecords("leads", {
        where: [{ field: "caseId", value: req.params.id }],
        limit: 1,
        maxLimit: 1,
      });
      lead = page.data?.[0] || null;
    }
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    const [documentsPage, bankDocumentsPage] = await Promise.all([
      queryRecords("documents", {
        where: [{ field: "leadId", value: lead.id }],
        orderBy: "createdAt",
        direction: "desc",
        limit: 50,
        maxLimit: 50,
      }).catch(() => ({ data: [] })),
      queryRecords("bankDocuments", {
        where: [{ field: "leadId", value: lead.id }],
        orderBy: "createdAt",
        direction: "desc",
        limit: 50,
        maxLimit: 50,
      }).catch(() => ({ data: [] })),
    ]);

    res.json({
      ...lead,
      documents: documentsPage.data || [],
      bankDocuments: bankDocumentsPage.data || [],
    });
  } catch (error) {
    next(error);
  }
}

export async function applyAdminLeadStatusSideEffects({ req, existing, lead, status }) {
  await ensureCommissionForLead(lead, status);
  const statusLabel = STATUS_LABELS[status] || status;
  await addTimelineEvent({
    leadId: req.params.id,
    eventType: status === LEAD_STATUSES.APPROVED
      ? TIMELINE_EVENTS.APPROVAL
      : status === LEAD_STATUSES.REJECTED
        ? TIMELINE_EVENTS.REJECTION
        : status === LEAD_STATUSES.DISBURSED
          ? TIMELINE_EVENTS.DISBURSEMENT_MARKED
          : TIMELINE_EVENTS.STATUS_CHANGED,
    title: `Admin Status Update: ${statusLabel}`,
    description: `Super Admin moved lead to ${statusLabel}`,
    actorName: req.user?.email || "super-admin",
    actorRole: "super-admin",
    metadata: { oldStatus: existing.status, nextStatus: status, status },
  });
  await createNotification({
    type: status === LEAD_STATUSES.REJECTED ? "rejection" : status === LEAD_STATUSES.APPROVED ? "approval" : "status-update",
    title: `Lead ${statusLabel}`,
    message: `Lead ${lead.caseId || req.params.id} moved to ${statusLabel}`,
    leadId: req.params.id,
    dealerEmail: lead.dealerEmail || lead.createdBy,
    admin: true,
    meta: { caseId: lead.caseId },
  });
  Promise.resolve(status === LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS
    ? queueDocumentsRequiredWhatsApp({ lead, documents: lead.pendingDocuments || [] })
    : queueStatusUpdatedWhatsApp({ lead, statusLabel }))
    .catch((error) => logError("Admin WhatsApp status side effect failed", { error: error.message, leadId: lead.id, status }));
  await writeAuditLog({ req, actionType: "STATUS_CHANGE", newValue: status, leadId: req.params.id });
}

export async function updateAdminLeadStatus(req, res, next) {
  try {
    const existing = await getRecord("leads", req.params.id);
    if (!existing) return res.status(404).json({ message: "Lead not found" });
    const status = assertValidStatusTransition(existing?.status, req.body.status);
    const lead = await updateRecord("leads", req.params.id, { status });
    clearLeadMutationCaches(req.params.id);
    syncLeadProjectionSoon(lead);
    publishRealtimeEvent({ eventType: REALTIME_EVENTS.LEAD_STATUS_UPDATED, lead, actor: req.user, data: { status, previousStatus: existing.status } });
    if (req.body.adminRemarks) {
      publishRealtimeEvent({ eventType: REALTIME_EVENTS.LEAD_REMARK_ADDED, lead, actor: req.user, data: { remarkType: "admin", status } });
    }
    await applyAdminLeadStatusSideEffects({ req, existing, lead, status });
    res.json({ message: "Lead status updated", lead });
  } catch (error) {
    next(error);
  }
}
