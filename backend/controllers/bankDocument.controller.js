import {
  ACTIVE_EXPORT_SENTINEL,
  addTimelineEvent,
  anyMatch,
  applyFilters,
  assertBankRegistrationEmailVerified,
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

void ACTIVE_EXPORT_SENTINEL;
export async function uploadBankLeadDocument(req, res, next) {
  try {
    const { partner, lead } = await requireAssignedLead(req);
    if (!req.file) return res.status(400).json({ message: "Document file is required" });
    const uploaded = await uploadLeadDocument(req.file, lead.id, {
      dealershipId: lead.dealershipId,
      caseId: lead.caseId,
      bankId: lead.bankId || partner.bankId || partner.bankPartnerId || partner.id,
      assignedExecutiveId: lead.assignedExecutiveId,
      assignedExecutiveEmail: lead.assignedExecutiveEmail,
      uploadedBy: partner.email,
    });
    const document = await createRecord("bankDocuments", {
      leadId: lead.id,
      caseId: lead.caseId || lead.id,
      partnerId: partner.id,
      uploadedBy: partner.email,
      dealershipId: lead.dealershipId || null,
      bankId: lead.bankId || partner.bankId || partner.bankPartnerId || partner.id,
      assignedExecutiveId: lead.assignedExecutiveId || null,
      documentType: req.body.documentType || "query-document",
      ...uploaded,
    });
    clearLeadDetailCaches(lead.id);
    clearBankSummaryCaches();
    const isSanction = String(document.documentType || "").includes("sanction");
    if (isSanction) {
      const updatedLead = await updateRecord("leads", lead.id, {
        sanctionLetterUrl: uploaded?.url || null,
        sanctionLetterStoragePath: uploaded?.storagePath || null,
        sanctionLetterDocumentId: document.id,
        sanctionLetterUploadedAt: document.createdAt || new Date().toISOString(),
        sanctionLetterUploadedBy: partner.email || req.user?.email || null,
        updatedAt: new Date().toISOString(),
      });
      syncLeadProjectionSoon(updatedLead);
    }
    await addTimelineEvent({
      leadId: lead.id,
      eventType: isSanction ? TIMELINE_EVENTS.SANCTION_LETTER_UPLOADED : TIMELINE_EVENTS.DOCUMENT_UPLOADED,
      title: isSanction ? "Sanction Letter Uploaded" : "Document Uploaded",
      description: document.documentType,
      actorName: partner.email || partner.name || partner.fullName,
      actorRole: req.user?.role || "bank",
      metadata: { documentId: document.id, documentType: document.documentType },
      leadSnapshot: lead,
    });
    await createNotification({ type: "documents-uploaded", title: "Document uploaded", message: `${document.documentType} uploaded for lead ${lead.caseId || lead.id}`, leadId: lead.id, dealerEmail: lead.dealerEmail, recipientRole: "finance-desk", recipientId: lead.dealerEmail, phoneNumber: lead.dealerMobile, meta: { caseId: lead.caseId, customerName: lead.fullName, documents: [document.documentType] } });
    await writeAuditLog({ req, actionType: "DOCUMENT_UPLOAD", newValue: document.documentType, leadId: lead.id });
    publishRealtimeEvent({ eventType: REALTIME_EVENTS.DOCUMENT_UPLOADED, lead, document, actor: req.user });
    res.status(201).json({ message: "Document uploaded", document });
  } catch (error) {
    next(error);
  }
}

export async function deleteBankLeadDocument(req, res, next) {
  try {
    const { partner, lead } = await requireAssignedLead(req);
    const document = await getRecord("bankDocuments", req.params.documentId);
    if (
      !document
      || !documentBelongsToLead(document, lead)
      || !documentBelongsToBank(document, lead, partner)
      || !documentBelongsToBranch(document, lead, partner)
      || !documentBelongsToExecutive(document, lead, partner)
    ) {
      recordOperationalEvent({
        type: "bank_document_delete_blocked",
        severity: ALERT_SEVERITY.HIGH,
        component: "bank-rbac",
        message: "Blocked bank document deletion outside lead ownership scope",
        entityId: req.params.documentId,
        requestId: req.requestId,
        meta: {
          actor: partner.email || partner.id,
          roleType: partner.roleType,
          leadId: lead.id,
          documentLeadId: document?.leadId || null,
          documentPartnerId: document?.partnerId || null,
        },
      }).catch(() => {});
      return res.status(404).json({ message: "Document not found" });
    }
    await deleteLeadDocument(document.storagePath);
    await deleteRecord("bankDocuments", document.id);
    clearLeadDetailCaches(lead.id);
    clearBankSummaryCaches();
    await addTimelineEvent({ leadId: lead.id, eventType: TIMELINE_EVENTS.DOCUMENT_REPLACED, title: "Document Removed", description: document.documentType, actorName: partner.email || partner.name || partner.fullName, actorRole: req.user?.role || "bank", metadata: { documentType: document.documentType }, leadSnapshot: lead });
    await writeAuditLog({ req, actionType: "DOCUMENT_DELETE", oldValue: document.documentType, leadId: lead.id });
    res.json({ message: "Document deleted" });
  } catch (error) {
    next(error);
  }
}
