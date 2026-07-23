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
  queueLeadAssignedWhatsApp,
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
import { acceptedAutomationPatch, statusAutomationPatch } from "../services/automationPolicy.service.js";
import { assertLeadAcceptanceEligible } from "../services/automationPolicy.service.js";
import { runLeadStatusTransitionSideEffects } from "../services/leadStatusTransition.service.js";
import { runRecordTransaction } from "../services/firestore.service.js";
import { loanExecutiveMatchesLead } from "../services/roleIdentity.service.js";

void ACTIVE_EXPORT_SENTINEL;
export async function acceptBankLead(req, res, next) {
  try {
    const { partner, lead } = await requireAssignedLead(req);
    if (req.user?.role !== "loan-executive" || partner.roleType !== "loan-executive") {
      throw Object.assign(new Error("Only the assigned loan executive can accept this lead."), { status: 403, code: "LOAN_EXECUTIVE_REQUIRED" });
    }
    if (partner.active === false || partner.frozen === true || String(partner.status || "").toLowerCase() === "inactive") {
      throw Object.assign(new Error("Loan executive account is inactive."), { status: 403, code: "EXECUTIVE_INACTIVE" });
    }
    const acceptedAt = new Date().toISOString();
    const executive = { ...req.user, ...partner };
    const assignments = await queryRecords("leadAssignments", {
      where: [{ field: "leadId", value: lead.id }],
      orderBy: "leadId",
      direction: "asc",
      limit: 25,
      maxLimit: 25,
    }).catch(() => ({ data: [] }));
    const assignmentId = assignments.data.find((item) => String(item.status || "").toLowerCase() === "pending" && loanExecutiveMatchesLead(executive, item))?.id || null;
    const updated = await runRecordTransaction(async (transaction) => {
      const latestLead = await transaction.get("leads", lead.id);
      const latestAssignment = assignmentId ? await transaction.get("leadAssignments", assignmentId) : null;
      if (!latestLead) throw Object.assign(new Error("Lead not found."), { status: 404, code: "LEAD_NOT_FOUND" });
      assertLeadAcceptanceEligible({
        lead: latestLead,
        ownsLead: loanExecutiveMatchesLead(executive, latestLead),
        now: Date.now(),
      });
      const patch = acceptedAutomationPatch(acceptedAt, executive);
      if (assignmentId) {
        if (!latestAssignment || String(latestAssignment.status || "").toLowerCase() !== "pending" || !loanExecutiveMatchesLead(executive, latestAssignment)) {
          throw Object.assign(new Error("Lead reassigned."), { status: 409, code: "LEAD_REASSIGNED" });
        }
      }
      transaction.update("leads", latestLead.id, patch);
      if (assignmentId) transaction.update("leadAssignments", assignmentId, { ...patch, status: "accepted" });
      return { ...latestLead, ...patch, updatedAt: acceptedAt };
    });
    clearLeadDetailCaches(lead.id);
    clearBankSummaryCaches();
    await syncLeadProjection(updated);
    publishRealtimeEvent({ eventType: REALTIME_EVENTS.LEAD_ACCEPTED, lead: updated, actor: req.user, data: { ownershipStatus: updated.ownershipStatus, acceptedAt: updated.acceptedAt, acceptedExecutiveId: updated.acceptedExecutiveId, slaRunning: false } });
    await addTimelineEvent({
      leadId: lead.id,
      eventType: TIMELINE_EVENTS.EXECUTIVE_ACCEPTED,
      title: "Executive Accepted Lead",
      description: `${partner.companyName || partner.bankName || partner.name || "Bank user"} accepted the lead`,
      actorName: partner.email || partner.name || partner.fullName,
      actorRole: req.user?.role || "bank",
      branchId: partner.branchId || null,
      metadata: { status: lead.status, ownershipStatus: "ACCEPTED", acceptedAt, customerName: lead.fullName },
      leadSnapshot: updated,
    });
    await writeAuditLog({ req, actionType: "BANK_ACCEPT", newValue: { ownershipStatus: "ACCEPTED", acceptedAt, acceptedExecutiveId: updated.acceptedExecutiveId }, leadId: lead.id });
    res.json({ message: "Lead accepted", lead: updated });
  } catch (error) {
    next(error);
  }
}

export async function rejectBankLead(req, res, next) {
  try {
    const reason = String(req.body.reason || "").trim();
    const remarks = String(req.body.remarks || "").trim();
    if (!reason) return res.status(400).json({ message: "Rejection reason is required" });
    const { partner, lead } = await requireAssignedLead(req);
    const nextStatus = assertValidStatusTransition(lead.status, LEAD_STATUSES.REJECTED);
    const updated = await updateRecord("leads", lead.id, { status: nextStatus, rejectionReason: reason, rejectionRemarks: remarks, ...statusAutomationPatch(nextStatus, new Date().toISOString(), lead) });
    clearLeadDetailCaches(lead.id);
    clearBankSummaryCaches();
    await syncLeadProjection(updated);
    publishRealtimeEvent({ eventType: REALTIME_EVENTS.LEAD_STATUS_UPDATED, lead: updated, actor: req.user, data: { status: nextStatus, previousStatus: lead.status } });
    await runLeadStatusTransitionSideEffects({
      req,
      existing: lead,
      lead: updated,
      nextStatus,
      actor: partner,
      pendingDocumentDescription: remarks ? `${reason} - ${remarks}` : reason,
      notification: {
        type: "rejection",
        title: "Lead rejected",
        message: remarks ? `${reason} - ${remarks}` : reason,
        recipientRole: "finance-desk",
        recipientId: lead.dealerEmail,
        dealerEmail: lead.dealerEmail,
        partnerId: partner.id,
        priority: "high",
        meta: { customerName: lead.fullName, reason, remarks },
      },
    });
    res.json({ message: "Lead rejected. Manual reassignment can be performed by bank manager if needed", lead: updated });
  } catch (error) {
    next(error);
  }
}

export async function performBankLeadReassignment({ lead, reason, actor, newExecutiveId, identity }) {
  return reassignLeadToNextBranchExecutive(lead.id, reason, actor, { newExecutiveId, bankId: identity?.bankId, bankIfsc: identity?.bankIfsc });
}

export async function reassignBankLead(req, res, next) {
  try {
    const { partner, lead } = await requireAssignedLead(req);
    if (req.user?.role !== "bank-manager" && partner.roleType !== "bank-manager") {
      return res.status(403).json({ message: "Only bank managers can reassign leads" });
    }
    const reason = String(req.body.reason || "manager-reassignment").trim();
    const newExecutiveId = String(req.body.newExecutiveId || req.body.executiveId || req.body.assignedExecutiveId || "").trim();
    const updated = await performBankLeadReassignment({ lead, reason, actor: partner.email || partner.id || "bank-manager", newExecutiveId, identity: bankIdentity(partner) });
    clearLeadDetailCaches(lead.id);
    clearBankSummaryCaches();
    await syncLeadProjection(updated);
    await writeAuditLog({
      req,
      actionType: "BANK_MANAGER_REASSIGN",
      oldValue: lead.assignedExecutiveId || lead.assignedExecutiveEmail || null,
      newValue: updated.assignedExecutiveId || updated.assignedExecutiveEmail || null,
      leadId: lead.id,
      meta: {
        caseId: lead.caseId,
        reason,
        oldExecutive: lead.assignedExecutiveName || lead.assignedExecutiveEmail || lead.assignedExecutiveId || null,
        newExecutive: updated.assignedExecutiveName || updated.assignedExecutiveEmail || updated.assignedExecutiveId || null,
        bankIfsc: updated.assignedBankIfsc || updated.bankIfsc || updated.ifscCode || null,
        branch: updated.bankBranchCity || updated.branchCity || updated.branchLocation || null,
      },
    });
    Promise.resolve(queueLeadAssignedWhatsApp(updated))
      .catch((error) => logError("Bank reassignment WhatsApp side effect failed", { error: error.message, leadId: lead.id }));
    res.json({ message: "Case reassigned successfully", lead: updated });
  } catch (error) {
    next(error);
  }
}

export function buildBankLeadStatusMutation({ req, lead, partner }) {
  const normalizedStatus = normalizeStatus(req.body.status);
  if (!bankStatuses.includes(normalizedStatus)) {
    const error = new Error("Invalid bank lead status");
    error.status = 400;
    throw error;
  }
  assertValidStatusTransition(lead.status, normalizedStatus);
  const pendingDocument = String(req.body.pendingDocument || "").trim();
  const requestedDocuments = Array.isArray(req.body.pendingDocumentsRequested)
    ? [...new Map(req.body.pendingDocumentsRequested.map((item) => String(item || "").trim()).filter(Boolean).map((item) => [item.toLowerCase(), item])).values()]
    : pendingDocument ? [pendingDocument] : [];
  const pendingDocumentReason = String(req.body.pendingDocumentReason || req.body.remarks || "").trim();
  const pendingDocumentDescription = requestedDocuments.length
    ? `${requestedDocuments.join(", ")}${pendingDocumentReason ? ` - ${pendingDocumentReason}` : ""}`
    : "";
  const clearsPendingDocuments = [
    LEAD_STATUSES.DOCUMENT_RECEIVED,
    LEAD_STATUSES.ALL_DOCUMENTS_RECEIVED,
    LEAD_STATUSES.UNDER_BANK_PROCESS,
    LEAD_STATUSES.DISBURSED,
  ].includes(normalizedStatus);
  const now = new Date().toISOString();
  const executiveName = partner.name || partner.fullName || partner.email || req.user?.email;
  const rejectionReason = String(req.body.rejectionReason || req.body.reason || req.body.remarks || "").trim();
  if (normalizedStatus === LEAD_STATUSES.REJECTED && !rejectionReason) {
    throw Object.assign(new Error("Rejection reason is required"), { status: 400, code: "REJECTION_REASON_REQUIRED" });
  }
  const statusPayload = {
    status: normalizedStatus,
    ...statusAutomationPatch(normalizedStatus, now, lead),
    updatedAt: now,
    statusUpdatedAt: now,
    updatedByExecutiveId: partner.id || partner.email || req.user?.email,
    updatedByExecutiveName: executiveName,
    ...(normalizedStatus === LEAD_STATUSES.APPROVED ? {
      approvedAmount: req.body.approvedAmount,
      roi: req.body.roi,
      tenure: req.body.tenure,
      emi: req.body.emi,
      processingFee: req.body.processingFee,
      sanctionNumber: req.body.sanctionNumber,
      sanctionDate: req.body.sanctionDate,
      approvalRemarks: req.body.remarks,
    } : {}),
    ...(normalizedStatus === LEAD_STATUSES.REJECTED ? {
      rejectionReason,
      rejectedAt: now,
      rejectedBy: executiveName,
      rejectionRemarks: req.body.remarks,
    } : {}),
    ...(normalizedStatus === LEAD_STATUSES.DISBURSED ? {
      disbursedAmount: req.body.disbursedAmount,
      disbursementDate: req.body.disbursementDate,
      utrNumber: req.body.utrNumber,
      disbursementRemarks: req.body.remarks,
    } : {}),
    ...(clearsPendingDocuments ? {
      pendingDocuments: [],
      pendingDocumentsRequested: [],
      pendingDocument: "",
      pendingDocumentReason: "",
      pendingDocumentsClearedAt: now,
      pendingDocumentsClearedBy: executiveName,
    } : {}),
    ...([LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING].includes(normalizedStatus) ? {
      pendingDocuments: requestedDocuments.length
        ? [...new Set([...(Array.isArray(lead.pendingDocuments) ? lead.pendingDocuments : []), ...requestedDocuments])]
        : lead.pendingDocuments,
      pendingDocumentsRequested: requestedDocuments.length
        ? [...(Array.isArray(lead.pendingDocumentsRequested) ? lead.pendingDocumentsRequested : []), {
          documents: requestedDocuments,
          notes: pendingDocumentReason,
          requestedByExecutiveId: partner.id || partner.email || req.user?.email,
          requestedByExecutiveName: executiveName,
          requestedAt: now,
        }]
        : lead.pendingDocumentsRequested,
      pendingDocumentReason,
    } : {}),
  };
  return {
    normalizedStatus,
    pendingDocument,
    requestedDocuments,
    pendingDocumentReason,
    pendingDocumentDescription,
    statusPayload,
  };
}

export async function queueBankLeadStatusSideEffects({ req, lead, updated, partner, normalizedStatus, pendingDocument, requestedDocuments, pendingDocumentReason, pendingDocumentDescription }) {
  const executiveName = partner.name || partner.fullName || partner.email || req.user?.email || "Loan Executive";
  const dealershipId = updated.dealershipId || updated.dealershipEmail || updated.dealerEmail || lead.dealershipId || lead.dealershipEmail || lead.dealerEmail || "";
  const bankId = updated.bankId || updated.assignedBankId || lead.bankId || lead.assignedBankId || partner.bankId || partner.id || "";
  return runLeadStatusTransitionSideEffects({
    req,
    existing: lead,
    lead: updated,
    nextStatus: normalizedStatus,
    actor: { ...partner, name: executiveName },
    pendingDocument,
    requestedDocuments,
    pendingDocumentReason,
    pendingDocumentDescription,
    notification: {
      type: normalizedStatus === LEAD_STATUSES.REJECTED ? "rejection" : "STATUS_CHANGED",
      title: "Case Status Updated",
      message: `Executive ${executiveName} updated ${updated.caseId || lead.caseId || lead.id} to ${STATUS_LABELS[normalizedStatus] || normalizedStatus}.`,
      recipientRole: "finance-desk",
      recipientId: dealershipId,
      dealerEmail: dealershipId,
      dealershipId,
      bankId,
      assignedExecutiveId: updated.assignedExecutiveId || lead.assignedExecutiveId || partner.id || partner.email,
      actionUrl: `/finance/leads/${updated.id || lead.id}`,
      meta: { executiveName, dealershipId, bankId, pendingDocuments: requestedDocuments, pendingDocumentReason },
    },
  });
}

export async function updateBankLeadStatus(req, res, next) {
  try {
    const { partner, lead } = await requireAssignedLead(req);
    let mutation;
    try {
      mutation = buildBankLeadStatusMutation({ req, lead, partner });
    } catch (error) {
      return res.status(error.status || 400).json({ message: error.message });
    }
    const { normalizedStatus, statusPayload } = mutation;
    const updated = await updateRecord("leads", lead.id, statusPayload);
    clearLeadDetailCaches(lead.id);
    clearBankSummaryCaches();
    let synchronizationPending = false;
    try {
      await syncLeadProjection(updated);
    } catch (syncError) {
      synchronizationPending = true;
      logError("Lead status projection synchronization failed", { leadId: lead.id, status: normalizedStatus, error: syncError.message });
      await recordOperationalEvent({
        type: "lead_status_projection_sync_failed",
        severity: ALERT_SEVERITY.HIGH,
        component: "lead-status-workflow",
        message: "Canonical lead status was updated but projection synchronization requires retry",
        entityId: lead.id,
        requestId: req.requestId,
        meta: { status: normalizedStatus, previousStatus: lead.status, error: syncError.message },
      });
      syncLeadProjectionSoon(updated);
    }
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.LEAD_STATUS_UPDATED,
      lead: updated,
      actor: req.user,
      data: { status: normalizedStatus, previousStatus: lead.status },
    });
    res.status(synchronizationPending ? 202 : 200).json({
      message: synchronizationPending ? "Lead status updated; synchronization is retrying" : "Lead status updated",
      lead: updated,
      synchronizationPending,
    });
    await queueBankLeadStatusSideEffects({ req, lead, updated, partner, ...mutation });
  } catch (error) {
    next(error);
  }
}

export async function updateBankLeadRemarks(req, res, next) {
  try {
    const remarks = String(req.body.remarks || "").trim();
    const { partner, lead } = await requireAssignedLead(req);
    const updated = await updateRecord("leads", lead.id, { bankRemarks: remarks });
    clearLeadDetailCaches(lead.id);
    clearBankSummaryCaches();
    syncLeadProjectionSoon(updated);
    await addTimelineEvent({
      leadId: lead.id,
      eventType: TIMELINE_EVENTS.INTERNAL_REMARKS_ADDED,
      title: "Internal Remarks Added",
      description: remarks,
      actorName: partner.email || partner.name || partner.fullName,
      actorRole: req.user?.role || "bank",
      metadata: { remarks },
      leadSnapshot: lead,
    });
    await writeAuditLog({ req, actionType: "REMARKS_CHANGE", newValue: remarks, leadId: lead.id });
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.LEAD_REMARK_ADDED,
      lead: updated,
      actor: req.user,
      data: { remarkType: "bank", status: updated.status },
    });
    res.json({ message: "Remarks saved", lead: updated });
  } catch (error) {
    next(error);
  }
}
