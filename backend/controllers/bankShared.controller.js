import { createRecord, deleteRecord, deleteRecordsByQuery, findRecordsByField, getRecord, listRecords, queryRecords, updateRecord, upsertRecord } from "../services/firestore.service.js";
import { ensureCommissionForLead } from "../services/commission.service.js";
import { createNotification } from "../services/notification.service.js";
import { reassignLeadToNextBranchExecutive } from "../services/assignment.service.js";
import { addTimelineEvent, getTimelineForLead, TIMELINE_EVENTS } from "../services/timeline.service.js";
import { createShortLivedDocumentUrl, deleteLeadDocument, uploadLeadDocument } from "../services/storage.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "../services/audit.service.js";
import { assertValidStatusTransition, LEAD_STATUSES, normalizeStatus, STATUS_LABELS } from "../utils/status.constants.js";
import { firebaseAdmin } from "../firebase/admin.js";
import { queryBankLeads, queryExecutiveLeads } from "../services/leadQuery.service.js";
import { ALERT_SEVERITY, emitOperationalAlert, recordOperationalEvent } from "../services/observability.service.js";
import { logError, logInfo } from "../services/logger.service.js";
import {
  getLeadDetailProjection,
  queryBankDealershipProjection,
  queryExecutiveSummaryProjection,
  queryLeadProjectionForUser,
  queryNotificationProjectionForUser,
  queryTimelineProjection,
  syncExecutiveSummaryProjection,
  syncExecutiveSummaryProjectionSoon,
  syncLeadDetailProjection,
  syncLeadProjection,
  syncLeadProjectionSoon,
} from "../services/projection.service.js";
import { paginationParams, pageResponse } from "../utils/pagination.js";
import crypto from "node:crypto";
import { revokeUserSessions } from "./auth.controller.js";
import { assertNoActiveIdentityCollision, upsertCanonicalUser } from "../services/identity.service.js";
import { hashTemporaryPassword } from "../services/temporaryPassword.service.js";
import { cached, clearCachedValue } from "../services/ttlCache.service.js";
import { queueDocumentsRequiredWhatsApp, queueLeadAssignedWhatsApp, queueStatusUpdatedWhatsApp } from "../services/whatsapp.service.js";
import { publishRealtimeEvent, REALTIME_EVENTS } from "../services/realtime.service.js";
import { recordMonitoringSignal } from "../services/monitoringCenter.service.js";
import { loanCapacityUpperBound, normalizeIfsc, normalizeLoanCapacity, validateBankLocation } from "../services/bankLocationMaster.service.js";
import { getBankAnalyticsAggregate } from "../services/bankAnalyticsAggregate.service.js";
import { assertLeadMutable } from "../utils/deadCase.js";

export {
  createRecord,
  deleteRecord,
  deleteRecordsByQuery,
  findRecordsByField,
  getRecord,
  listRecords,
  queryRecords,
  updateRecord,
  upsertRecord,
  ensureCommissionForLead,
  createNotification,
  reassignLeadToNextBranchExecutive,
  addTimelineEvent,
  getTimelineForLead,
  TIMELINE_EVENTS,
  createShortLivedDocumentUrl,
  deleteLeadDocument,
  uploadLeadDocument,
  AUDIT_ACTIONS,
  writeAuditLog,
  assertValidStatusTransition,
  LEAD_STATUSES,
  normalizeStatus,
  STATUS_LABELS,
  firebaseAdmin,
  queryBankLeads,
  queryExecutiveLeads,
  ALERT_SEVERITY,
  emitOperationalAlert,
  recordOperationalEvent,
  logError,
  logInfo,
  getLeadDetailProjection,
  queryBankDealershipProjection,
  queryExecutiveSummaryProjection,
  queryLeadProjectionForUser,
  queryNotificationProjectionForUser,
  queryTimelineProjection,
  syncExecutiveSummaryProjection,
  syncExecutiveSummaryProjectionSoon,
  syncLeadDetailProjection,
  syncLeadProjection,
  syncLeadProjectionSoon,
  paginationParams,
  pageResponse,
  crypto,
  revokeUserSessions,
  assertNoActiveIdentityCollision,
  upsertCanonicalUser,
  hashTemporaryPassword,
  cached,
  clearCachedValue,
  queueDocumentsRequiredWhatsApp,
  queueLeadAssignedWhatsApp,
  queueStatusUpdatedWhatsApp,
  publishRealtimeEvent,
  REALTIME_EVENTS,
  recordMonitoringSignal,
  loanCapacityUpperBound,
  normalizeIfsc,
  normalizeLoanCapacity,
  validateBankLocation,
  getBankAnalyticsAggregate,
  assertLeadMutable,
};

export const bankStatuses = [
  LEAD_STATUSES.NEW,
  LEAD_STATUSES.CONTACTED,
  LEAD_STATUSES.REQUEST_DOCUMENT,
  LEAD_STATUSES.DOCUMENT_RECEIVED,
  LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS,
  LEAD_STATUSES.ALL_DOCUMENTS_RECEIVED,
  LEAD_STATUSES.UNDER_BANK_PROCESS,
  LEAD_STATUSES.ASSIGNED,
  LEAD_STATUSES.ACCEPTED,
  LEAD_STATUSES.UNDER_REVIEW,
  LEAD_STATUSES.DOCS_PENDING,
  LEAD_STATUSES.APPROVED,
  LEAD_STATUSES.REJECTED,
  LEAD_STATUSES.DISBURSED,
];

export const EXECUTIVE_ACTIVE_LEAD_STATUSES = new Set([
  LEAD_STATUSES.NEW,
  LEAD_STATUSES.CONTACTED,
  LEAD_STATUSES.REQUEST_DOCUMENT,
  LEAD_STATUSES.DOCUMENT_RECEIVED,
  LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS,
  LEAD_STATUSES.ALL_DOCUMENTS_RECEIVED,
  LEAD_STATUSES.UNDER_BANK_PROCESS,
  LEAD_STATUSES.ASSIGNED,
  LEAD_STATUSES.ACCEPTED,
  LEAD_STATUSES.UNDER_REVIEW,
  LEAD_STATUSES.DOCS_PENDING,
  LEAD_STATUSES.APPROVED,
]);

export const LEAD_DOCUMENT_FIELDS = [
  "id",
  "leadId",
  "caseId",
  "type",
  "documentType",
  "label",
  "fileName",
  "originalName",
  "fileType",
  "mimeType",
  "size",
  "fileSize",
  "status",
  "uploadedBy",
  "createdAt",
  "uploadedAt",
  "url",
  "fileUrl",
  "downloadUrl",
  "storagePath",
  "filePath",
];

export function userEmail(req) {
  return req.user?.email || req.user?.uid;
}

export function cleanText(value) {
  return String(value || "").trim().toLowerCase();
}

export function sameText(left, right) {
  const cleanLeft = cleanText(left);
  const cleanRight = cleanText(right);
  return Boolean(cleanLeft && cleanRight && cleanLeft === cleanRight);
}

export function anyMatch(values, targets) {
  return values.some((value) => targets.some((target) => sameText(value, target)));
}

export function leadBankValues(lead = {}) {
  return [
    lead.bankId,
    lead.assignedBankId,
    lead.assignedPartnerId,
    lead.bankPartner,
    lead.preferredBank,
    lead.bankName,
    lead.assignedBankName,
    lead.selectedBankName,
  ];
}

export function partnerBankValues(partner = {}) {
  return [
    partner.bankId,
    partner.bankPartnerId,
    partner.partnerId,
    partner.id,
    partner.ifsc,
    partner.ifscCode,
    partner.bankIfsc,
    partner.bankName,
    partner.companyName,
  ];
}

export function leadBranchValues(lead = {}) {
  return [
    lead.branchId,
    lead.bankBranchId,
    lead.selectedBankBranchId,
    lead.bankBranchCity,
    lead.branchCity,
    lead.routingCity,
    lead.ifscCode,
    lead.bankIfsc,
    lead.assignedBankIfsc,
  ];
}

export function partnerBranchValues(partner = {}) {
  return [
    partner.branchId,
    partner.bankBranchId,
    partner.selectedBankBranchId,
    partner.ifsc,
    partner.ifscCode,
    partner.bankIfsc,
    partner.bankBranchLocation,
    partner.branchLocation,
    partner.branchCity,
    partner.city,
    partner.operatingCity,
  ];
}

export function bankManagerCanAccessLead(partner, lead) {
  const sameBank = anyMatch(leadBankValues(lead), partnerBankValues(partner));
  const sameBranch = anyMatch(leadBranchValues(lead), partnerBranchValues(partner));
  return sameBank && sameBranch;
}

export function loanExecutiveCanAccessLead(partner, lead) {
  return anyMatch(
    [lead.assignedExecutiveId, lead.assignedExecutiveEmail, lead.assignedExecutiveMobile, lead.assignedExecutiveName],
    [partner.id, partner.email, partner.mobile, partner.name, partner.fullName],
  );
}

export async function deleteMatchingRecords(collection, predicate, indexedQueries = []) {
  if (indexedQueries.length) {
    const counts = await Promise.all(indexedQueries.map((where) => deleteRecordsByQuery(collection, { where }).catch(() => 0)));
    return counts.reduce((sum, count) => sum + count, 0);
  }
  const records = await listRecords(collection).catch(() => []);
  const matches = records.filter(predicate);
  await Promise.all(matches.map((item) => deleteRecord(collection, item.id)));
  return matches.length;
}

export async function currentPartner(req) {
  const email = userEmail(req);
  const cacheKey = `context:bank:${req.user?.role || ""}:${req.user?.uid || ""}:${email}`;
  return cached(cacheKey, 15000, async () => {
  if (req.user?.role === "loan-executive") {
    const executive = await getRecord("loanExecutives", email);
    if (executive) return {
      ...executive,
      bankId: executive.bankId || req.user.bankId,
      bankPartnerId: executive.bankPartnerId || executive.bankId || req.user.bankId,
      branchId: executive.branchId || req.user.branchId,
      roleType: "loan-executive",
    };
    return {
      id: req.user.uid || email,
      email,
      bankId: req.user.bankId,
      bankPartnerId: req.user.bankId,
      branchId: req.user.branchId,
      roleType: "loan-executive",
      active: req.user.active !== false,
    };
  }

  if (req.user?.role === "bank-manager") {
    const manager = await getRecord("branchManagers", email);
    if (manager) return {
      ...manager,
      bankId: manager.bankId || req.user.bankId,
      bankPartnerId: manager.bankPartnerId || manager.bankId || req.user.bankId,
      branchId: manager.branchId || req.user.branchId,
      roleType: "bank-manager",
    };
    return {
      id: req.user.uid || email,
      email,
      bankId: req.user.bankId,
      bankPartnerId: req.user.bankId,
      branchId: req.user.branchId,
      roleType: "bank-manager",
      active: req.user.active !== false,
    };
  }

  const partner = await getRecord("bankPartners", email).catch(() => null)
    || (await findRecordsByField("bankPartners", "email", email, 3))[0]
    || null;
  return partner ? { ...partner, roleType: req.user?.role || partner.role } : null;
  });
}

export function partnerCanAccessLead(partner, lead) {
  if (!partner || !lead) return false;
  if (partner.roleType === "loan-executive") {
    return loanExecutiveCanAccessLead(partner, lead);
  }

  if (partner.roleType === "bank-manager") {
    return bankManagerCanAccessLead(partner, lead);
  }

  const supportedBanks = Array.isArray(partner.supportedBanks) ? partner.supportedBanks : [];
  return anyMatch(
    [lead.assignedPartnerId, lead.assignedBankId, lead.bankPartner, lead.assignedBankName, lead.preferredBank],
    [partner.id, partner.email, partner.bankName, partner.companyName, ...supportedBanks],
  );
}

export function logProjectionRead(event, req, meta = {}) {
  recordMonitoringSignal(event, { endpoint: req.route?.path, path: req.originalUrl, ...meta });
  logInfo(event, {
    tag: event,
    requestId: req.requestId,
    path: req.originalUrl,
    endpoint: req.route?.path,
    ...meta,
  });
}

export function logReadMetric(event, req, meta = {}) {
  recordMonitoringSignal(event, { endpoint: meta.endpoint || req.route?.path, path: req.originalUrl, ...meta });
  logInfo(event, {
    tag: event,
    requestId: req.requestId,
    path: req.originalUrl,
    ...meta,
  });
}

export function hasMatchingScopeValues(values, targets) {
  return values.some((value) => targets.some((target) => sameText(value, target)));
}

export function projectedLeadHasRequiredBankScope(partner, lead) {
  if (!partner || !lead) return false;
  if (partner.roleType === "loan-executive") {
    return hasMatchingScopeValues(
      [lead.assignedExecutiveId, lead.assignedExecutiveEmail, lead.assignedExecutiveMobile, lead.assignedExecutiveName],
      [partner.id, partner.email, partner.mobile, partner.name, partner.fullName],
    );
  }
  if (partner.roleType === "bank-manager") {
    return hasMatchingScopeValues(leadBankValues(lead), partnerBankValues(partner))
      && hasMatchingScopeValues(leadBranchValues(lead), partnerBranchValues(partner));
  }
  return hasMatchingScopeValues(
    [lead.assignedPartnerId, lead.assignedBankId, lead.bankPartner, lead.assignedBankName, lead.preferredBank],
    [partner.id, partner.email, partner.bankName, partner.companyName, ...(Array.isArray(partner.supportedBanks) ? partner.supportedBanks : [])],
  );
}

export function leadDetailResponseFromProjection(projection = {}, extras = {}) {
  const {
    sourceCollection,
    sourceId,
    viewType,
    leadId,
    searchText,
    customerSummary,
    executiveSummary,
    statusSummary,
    documentCounts,
    timelineSummary,
    documents,
    bankDocuments,
    ...lead
  } = projection;
  return { ...lead, id: sourceId || leadId || projection.id, ...extras };
}

export function emitBankLeadAccessDenied(req, partner) {
  recordOperationalEvent({
    type: "bank_cross_tenant_access_blocked",
    severity: ALERT_SEVERITY.HIGH,
    component: "bank-rbac",
    message: "Blocked bank lead access outside tenant scope",
    entityId: req.params.id,
    requestId: req.requestId,
    meta: { actor: partner.email || partner.id, roleType: partner.roleType, bankId: partner.bankId || partner.bankPartnerId },
  }).catch(() => {});
  emitOperationalAlert({
    type: "bank_cross_tenant_access_blocked",
    severity: ALERT_SEVERITY.HIGH,
    component: "bank-rbac",
    title: "Blocked cross-tenant bank lead access",
    message: "Bank user attempted to access a lead outside assigned scope",
    entityId: req.params.id,
    requestId: req.requestId,
    meta: { actor: partner.email || partner.id, roleType: partner.roleType },
  }).catch(() => {});
}

export function documentBelongsToLead(document, lead) {
  return anyMatch(
    [document.leadId, document.caseId],
    [lead.id, lead.caseId],
  );
}

export function documentBelongsToBank(document, lead, partner) {
  return anyMatch(
    [
      document.partnerId,
      document.bankId,
      document.bankPartnerId,
      document.assignedBankId,
      document.branchId,
      document.bankBranchId,
      document.ifscCode,
      document.bankIfsc,
    ],
    [
      partner.id,
      partner.bankId,
      partner.bankPartnerId,
      partner.partnerId,
      partner.branchId,
      partner.ifsc,
      partner.ifscCode,
      partner.bankIfsc,
      lead.bankId,
      lead.assignedBankId,
      lead.assignedPartnerId,
      lead.branchId,
      lead.bankBranchId,
      lead.selectedBankBranchId,
      lead.ifscCode,
      lead.bankIfsc,
      lead.assignedBankIfsc,
    ],
  );
}

export function documentBelongsToBranch(document, lead, partner) {
  const partnerBranches = partnerBranchValues(partner);
  const leadBranchMatch = anyMatch(leadBranchValues(lead), partnerBranches);
  if (!leadBranchMatch) return false;

  const documentBranches = [
    document.branchId,
    document.bankBranchId,
    document.selectedBankBranchId,
    document.bankBranchCity,
    document.branchCity,
    document.routingCity,
    document.ifscCode,
    document.bankIfsc,
  ].filter(Boolean);
  return !documentBranches.length || anyMatch(documentBranches, partnerBranches);
}

export function documentBelongsToExecutive(document, lead, partner) {
  if (partner.roleType !== "loan-executive") return true;
  const executiveTargets = [partner.id, partner.email, partner.mobile, partner.name, partner.fullName];
  const leadExecutiveMatch = anyMatch(
    [lead.assignedExecutiveId, lead.assignedExecutiveEmail, lead.assignedExecutiveMobile, lead.assignedExecutiveName],
    executiveTargets,
  );
  if (!leadExecutiveMatch) return false;

  const documentExecutiveValues = [
    document.assignedExecutiveId,
    document.assignedExecutiveEmail,
    document.assignedExecutiveMobile,
    document.assignedExecutiveName,
  ].filter(Boolean);
  return !documentExecutiveValues.length || anyMatch(documentExecutiveValues, executiveTargets);
}

export function bankIdentity(partner) {
  const bankId = partner.bankPartnerId || partner.partnerId || partner.bankId || partner.id || partner.email || partner.bankName;
  return {
    bankId,
    bankName: partner.bankName || partner.companyName || partner.name || bankId,
    bankIfsc: partner.ifsc || partner.bankIfsc || partner.ifscCode || null,
    branchId: partner.branchId || partner.bankBranchId || null,
    bankLocation: partner.bankBranchLocation || partner.branchLocation || partner.branchCity || partner.city || partner.operatingCity,
  };
}

export function generateTemporaryPassword() {
  const digits = crypto.randomInt(1000, 10000);
  const suffix = "abcdefghijkmnopqrstuvwxyz".charAt(crypto.randomInt(0, 24));
  return `CLS@${digits}${suffix}`;
}

export function executiveBelongsToBank(executive, identity) {
  return executive.bankPartnerId === identity.bankId
    || executive.bankId === identity.bankId
    || executive.partnerId === identity.bankId
    || sameText(executive.bankIfsc, identity.bankIfsc)
    || sameText(executive.ifsc, identity.bankIfsc)
    || sameText(executive.ifscCode, identity.bankIfsc)
    || sameText(executive.bankName, identity.bankName);
}

export function leadText(lead) {
  return [lead.caseId, lead.fullName, lead.customerName, lead.mobile, lead.city, lead.selectedBrand, lead.selectedModel, lead.status, lead.dealershipName, lead.dealerEmail, lead.assignedExecutiveName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function applyFilters(leads, query) {
  const search = String(query.search || "").trim().toLowerCase();
  const executive = String(query.executive || "").trim().toLowerCase();
  const dealership = String(query.dealership || "").trim().toLowerCase();
  const dealershipId = String(query.dealershipId || "").trim().toLowerCase();
  return leads.filter((lead) => {
    const statusOk = !query.status || normalizeStatus(lead.status) === normalizeStatus(query.status) || lead.assignmentStatus === query.status;
    const dateOk = !query.date || (lead.assignmentTimestamp || lead.createdAt || "").startsWith(query.date);
    const searchOk = !search || leadText(lead).includes(search);
    const executiveOk = !executive || String(lead.assignedExecutiveName || lead.assignedExecutiveId || "").toLowerCase() === executive;
    const dealershipOk = !dealership || String(lead.dealershipName || lead.dealerEmail || "").toLowerCase() === dealership;
    const dealershipIdOk = !dealershipId || String(lead.dealershipId || lead.dealershipEmail || lead.dealerEmail || "").toLowerCase() === dealershipId;
    const pendingDocsOk = !query.pendingDocs || [LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.DOCUMENT_RECEIVED, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING].includes(normalizeStatus(lead.status));
    return statusOk && dateOk && searchOk && executiveOk && dealershipOk && dealershipIdOk && pendingDocsOk;
  });
}

export async function attachExecutiveMobile(partner, leads) {
  const missing = leads.filter((lead) => !lead.assignedExecutiveMobile && (lead.assignedExecutiveId || lead.assignedExecutiveEmail));
  if (!missing.length) return leads;
  const executivesPage = await queryRecords("loanExecutives", {
    where: partner.bankId || partner.bankPartnerId ? [{ field: "bankId", value: partner.bankId || partner.bankPartnerId }] : [],
    orderBy: "createdAt",
    direction: "desc",
    limit: 100,
    maxLimit: 100,
  }).catch(() => ({ data: [] }));
  return leads.map((lead) => {
    if (lead.assignedExecutiveMobile) return lead;
    const executive = executivesPage.data.find((item) =>
      anyMatch(
        [item.id, item.email, item.officialEmail],
        [lead.assignedExecutiveId, lead.assignedExecutiveEmail],
      )
    );
    return executive?.mobile ? { ...lead, assignedExecutiveMobile: executive.mobile, executiveMobile: executive.mobile } : lead;
  });
}

export async function liveBankRegistrationForAccount(account) {
  if (!account?.email) return { approval: null, bankPartner: null, branchManager: null, live: false };
  const approval = await getRecord("pendingBankApprovals", account.approvalRequestId || "").catch(() => null)
    || (await findRecordsByField("pendingBankApprovals", "email", account.email, 3))[0]
    || (await findRecordsByField("pendingBankApprovals", "officialEmail", account.email, 3))[0]
    || (await findRecordsByField("pendingBankApprovals", "primaryGoogleEmail", account.email, 3))[0]
    || null;
  const bankPartner = await getRecord("bankPartners", account.email).catch(() => null)
    || (await findRecordsByField("bankPartners", "email", account.email, 3))[0]
    || (await findRecordsByField("bankPartners", "officialEmail", account.email, 3))[0]
    || null;
  const branchManager = await getRecord("branchManagers", account.email).catch(() => null)
    || (await findRecordsByField("branchManagers", "email", account.email, 3))[0]
    || (await findRecordsByField("branchManagers", "officialEmail", account.email, 3))[0]
    || null;
  return { approval, bankPartner, branchManager, live: Boolean(approval || bankPartner || branchManager) };
}

export async function assignedLeadsForPartner(partner, query = {}, fields) {
  if (partner.roleType === "loan-executive") {
    const projected = await queryLeadProjectionForUser({
      user: { role: "loan-executive", uid: partner.id, email: partner.email },
      query: { ...query, limit: query.limit || 100 },
      fields,
    }).catch(() => null);
    const result = projected || await queryExecutiveLeads({ executiveId: partner.id, executiveEmail: partner.email, query: { ...query, limit: query.limit || 100 }, fields });
    return attachExecutiveMobile(partner, applyFilters(result.data, query));
  }
  const identity = bankIdentity(partner);
  const projected = await queryLeadProjectionForUser({
    user: { role: "bank-manager", bankId: identity.bankId },
    query: { ...query, limit: query.limit || 100 },
    fields,
  }).catch(() => null);
  const result = projected || await queryBankLeads({ bankId: identity.bankId, query: { ...query, limit: query.limit || 100 }, fields });
  return attachExecutiveMobile(partner, applyFilters(result.data.filter((lead) => partnerCanAccessLead(partner, lead)), query));
}

export function executiveLeadSpecs({ uid, email, mobile } = {}) {
  return [
    uid ? { field: "assignedExecutiveId", value: uid } : null,
    email ? { field: "assignedExecutiveEmail", value: email } : null,
    email ? { field: "assignedExecutiveId", value: email } : null,
    mobile ? { field: "assignedExecutiveMobile", value: mobile } : null,
  ].filter(Boolean);
}

export async function collectExecutiveLeads({ identity, uid, email, mobile, batchSize = 250 }) {
  const seen = new Set();
  const leads = [];

  for (const spec of executiveLeadSpecs({ uid, email, mobile })) {
    let cursor = null;
    for (;;) {
      const page = await queryRecords("leads", {
        where: [{ field: "bankId", value: identity.bankId }, spec],
        limit: batchSize,
        maxLimit: batchSize,
        cursor,
      }).catch(() => ({ data: [] }));
      if (!page.data.length) break;

      page.data.forEach((lead) => {
        if (seen.has(lead.id)) return false;
        seen.add(lead.id);
        leads.push(lead);
        return true;
      });

      if (page.data.length < batchSize) break;
      cursor = page.nextCursor;
      if (!cursor) break;
    }
  }

  return leads;
}

export async function clearExecutiveLeadAssignments({ identity, uid, email, mobile, removedAt, batchSize = 250 }) {
  const leads = await collectExecutiveLeads({ identity, uid, email, mobile, batchSize });
  let affectedLeadCount = 0;
  for (let index = 0; index < leads.length; index += batchSize) {
    const uniqueLeads = leads.slice(index, index + batchSize);
      await Promise.all(uniqueLeads.map((lead) => updateRecord("leads", lead.id, {
        assignedExecutiveId: null,
        assignedExecutiveEmail: null,
        assignedExecutiveName: null,
        assignedExecutiveMobile: null,
        assignedExecutiveJobId: null,
        executiveMobile: null,
        updatedAt: removedAt,
      })));
      affectedLeadCount += uniqueLeads.length;
  }

  return affectedLeadCount;
}

export function activeExecutiveLeads(leads = []) {
  return leads.filter((lead) => EXECUTIVE_ACTIVE_LEAD_STATUSES.has(normalizeStatus(lead.status || lead.assignmentStatus)));
}

export async function requireAssignedLead(req) {
  const partner = await currentPartner(req);
  if (!partner) {
    const error = new Error("Bank partner profile not found");
    error.status = 404;
    throw error;
  }
  const lead = await getRecord("leads", req.params.id);
  if (!lead || !partnerCanAccessLead(partner, lead)) {
    emitBankLeadAccessDenied(req, partner);
    const error = new Error("Lead not assigned to this bank partner");
    error.status = 403;
    throw error;
  }
  assertLeadMutable(lead);
  return { partner, lead };
}

export function clearLeadDetailCaches(leadId) {
  clearCachedValue(`lead-detail:${leadId}:`);
  clearCachedValue(`timeline:lead:${leadId}:`);
}

export function clearBankSummaryCaches() {
  clearCachedValue("admin:");
  clearCachedValue("bank:");
  clearCachedValue("dealer:");
  clearCachedValue("finance:");
  clearCachedValue("gm:");
  clearCachedValue("bank:analytics:");
  clearCachedValue("bank:notifications:");
  clearCachedValue("bank:executives:");
  clearCachedValue("bank:executive-cases:");
  clearCachedValue("bank:dealerships:");
  clearCachedValue("bank:leads:");
  clearCachedValue("gm:notifications:");
  clearCachedValue("gm:salespersons:");
  clearCachedValue("lead-query:");
}

export function safeProjectionDocId(value) {
  return String(value || "").trim().replace(/[^\w.@-]/g, "_").slice(0, 420);
}

export async function countCanonicalBankExecutives(identity) {
  const page = await queryRecords("loanExecutives", {
    where: [{ field: "bankId", value: identity.bankId }],
    orderBy: "createdAt",
    direction: "desc",
    limit: 100,
    maxLimit: 100,
    fields: ["id", "bankId", "bankPartnerId", "active"],
  });
  return page.data.filter((executive) => executiveBelongsToBank(executive, identity) && executive.active !== false).length;
}

export async function deleteExecutiveSummaryProjection(identity, executive = {}) {
  const bankId = identity.bankId;
  const candidates = [
    executive.id,
    executive.email,
    executive.officialEmail,
    executive.mobile,
  ].filter(Boolean);
  await Promise.all(candidates.map((candidate) =>
    deleteRecord("executiveSummaryProjection", safeProjectionDocId(`executive_${bankId}_${candidate}`)).catch(() => false),
  ));
}

export async function resolveBankExecutiveForMutation(identity, executiveId = "") {
  const requested = String(executiveId || "").trim();
  if (!requested) return null;
  const direct = await getRecord("loanExecutives", requested).catch(() => null);
  if (direct && executiveBelongsToBank(direct, identity)) return direct;

  const projectedExecutives = await queryExecutiveSummaryProjection({ bankId: identity.bankId, query: { limit: 100 } }).catch(() => null);
  const projected = (projectedExecutives || []).find((item) =>
    anyMatch(
      [item.id, item.sourceId, item.executiveId, item.email, item.officialEmail, item.mobile],
      [requested],
    )
  );
  if (!projected) return direct;

  const canonicalId = projected.sourceId || projected.email || projected.officialEmail || projected.executiveId;
  const canonical = canonicalId ? await getRecord("loanExecutives", canonicalId).catch(() => null) : null;
  if (canonical && executiveBelongsToBank(canonical, identity)) return canonical;

  const email = cleanText(projected.email || projected.officialEmail || "");
  if (email) {
    const byEmail = await findRecordsByField("loanExecutives", "email", email, 1).catch(() => []);
    if (byEmail[0] && executiveBelongsToBank(byEmail[0], identity)) return byEmail[0];
  }
  const mobile = String(projected.mobile || "").replace(/\D/g, "").slice(-10);
  if (mobile) {
    const byMobile = await findRecordsByField("loanExecutives", "mobile", mobile, 3).catch(() => []);
    const match = byMobile.find((item) => executiveBelongsToBank(item, identity));
    if (match) return match;
  }
  return projected && executiveBelongsToBank(projected, identity) ? projected : null;
}

export async function cleanupExecutiveLinkedRecords({ executive = {}, uid = "", email = "", mobile = "" }) {
  const identifiers = {
    uid,
    email,
    mobile,
    id: executive.id,
    sourceId: executive.sourceId,
    executiveId: executive.executiveId,
  };
  const deleted = {};
  const add = async (collection, where) => {
    const count = await deleteRecordsByQuery(collection, { where }).catch(() => 0);
    deleted[collection] = Number(deleted[collection] || 0) + count;
  };

  if (email) {
    await add("userSessions", [{ field: "email", value: email }]);
    await add("leadAssignments", [{ field: "executiveEmail", value: email }]);
    await add("leadAssignments", [{ field: "assignedExecutiveEmail", value: email }]);
    await add("notifications", [{ field: "recipientId", value: email }]);
    await add("notifications", [{ field: "assignedExecutiveEmail", value: email }]);
    await add("notificationEvents", [{ field: "recipientId", value: email }]);
    await add("notificationLogs", [{ field: "recipientId", value: email }]);
    await add("whatsappQueue", [{ field: "recipientId", value: email }]);
    await add("executiveViews", [{ field: "scopeId", value: email }]);
  }
  if (uid) {
    await add("userSessions", [{ field: "uid", value: uid }]);
    await add("leadAssignments", [{ field: "executiveId", value: uid }]);
    await add("notifications", [{ field: "assignedExecutiveId", value: uid }]);
    await add("notificationEvents", [{ field: "assignedExecutiveId", value: uid }]);
    await add("executiveViews", [{ field: "scopeId", value: uid }]);
  }
  if (mobile) {
    await add("leadAssignments", [{ field: "assignedExecutiveMobile", value: mobile }]);
    await add("whatsappQueue", [{ field: "phoneNumber", value: mobile }]);
    await add("whatsappQueue", [{ field: "to", value: mobile }]);
  }
  for (const value of [identifiers.id, identifiers.sourceId, identifiers.executiveId].filter(Boolean)) {
    await add("leadAssignments", [{ field: "executiveId", value }]);
    await add("notifications", [{ field: "assignedExecutiveId", value }]);
  }
  return deleted;
}

export function dealershipIdentityFromLead(lead = {}) {
  const dealershipId = String(lead.dealershipId || lead.dealershipEmail || lead.dealerEmail || "").trim();
  if (!dealershipId) return null;
  return {
    dealershipId,
    dealershipName: lead.dealershipName || lead.dealerName || lead.dealerBusinessName || lead.dealershipEmail || lead.dealerEmail || dealershipId,
    dealershipEmail: lead.dealershipEmail || lead.dealerEmail || "",
    dealerName: lead.dealerName || lead.dealershipName || "",
    dealerMobile: lead.dealerMobile || lead.dealershipMobile || "",
    city: lead.dealershipCity || lead.dealerCity || lead.city || "",
    dealershipCity: lead.dealershipCity || lead.dealerCity || lead.city || "",
    bankName: lead.bankName || lead.assignedBankName || "",
    bankIfsc: lead.assignedBankIfsc || lead.ifscCode || "",
  };
}

export function groupDealershipsFromLeads(leads = []) {
  const grouped = new Map();
  for (const lead of leads) {
    const identity = dealershipIdentityFromLead(lead);
    if (!identity) continue;
    const current = grouped.get(identity.dealershipId) || {
      id: identity.dealershipId,
      ...identity,
      totalCases: 0,
      activeCases: 0,
      totalDisbursedCases: 0,
      firstLeadAt: lead.createdAt || lead.generatedAt || lead.updatedAt || null,
      lastLeadAt: lead.updatedAt || lead.statusUpdatedAt || lead.createdAt || lead.generatedAt || null,
    };
    current.totalCases += 1;
    if (normalizeStatus(lead.status) === LEAD_STATUSES.DISBURSED) current.totalDisbursedCases += 1;
    if (![LEAD_STATUSES.DISBURSED, LEAD_STATUSES.REJECTED].includes(normalizeStatus(lead.status))) current.activeCases += 1;
    const leadTime = lead.updatedAt || lead.statusUpdatedAt || lead.createdAt || lead.generatedAt;
    if (leadTime && (!current.lastLeadAt || String(leadTime) > String(current.lastLeadAt))) current.lastLeadAt = leadTime;
    grouped.set(identity.dealershipId, current);
  }
  return [...grouped.values()].sort((left, right) => String(right.lastLeadAt || "").localeCompare(String(left.lastLeadAt || "")));
}

export async function existingBranchForIfsc(ifsc = "") {
  const normalized = normalizeIfsc(ifsc);
  if (!normalized) return null;
  const direct = await getRecord("branches", normalized).catch(() => null)
    || await getRecord("banks", normalized).catch(() => null)
    || await getRecord("bankPartners", normalized).catch(() => null)
    || await getRecord("pendingBankApprovals", normalized).catch(() => null);
  if (direct) return direct;
  const [pending, bank, partner, branch] = await Promise.all([
    findRecordsByField("pendingBankApprovals", "ifsc", normalized, 1).catch(() => []),
    findRecordsByField("banks", "ifscCode", normalized, 1).catch(() => []),
    findRecordsByField("bankPartners", "ifscCode", normalized, 1).catch(() => []),
    findRecordsByField("branches", "ifscCode", normalized, 1).catch(() => []),
  ]);
  return pending[0] || bank[0] || partner[0] || branch[0] || null;
}

export async function firebaseUserVerified(decoded, email) {
  if (decoded?.email_verified === true) return true;
  if (!firebaseAdmin) return false;
  try {
    const user = decoded?.uid
      ? await firebaseAdmin.auth().getUser(decoded.uid)
      : await firebaseAdmin.auth().getUserByEmail(email);
    return user.emailVerified === true;
  } catch {
    return false;
  }
}

export async function assertBankRegistrationEmailVerified({ uid, email }) {
  if (!firebaseAdmin) return;
  let user = null;
  try {
    user = uid ? await firebaseAdmin.auth().getUser(uid) : null;
  } catch {
    user = null;
  }
  if (!user && email) {
    try {
      user = await firebaseAdmin.auth().getUserByEmail(email);
    } catch {
      user = null;
    }
  }
  if (user && user.emailVerified !== true) {
    const error = new Error("Verify your email address before submitting bank registration.");
    error.status = 403;
    error.code = "EMAIL_NOT_VERIFIED";
    throw error;
  }
}

export function bankEmailPendingPayload({ registrationId, email }) {
  return {
    status: "email-pending",
    approvalStatus: "email-pending",
    accountState: "EMAIL_PENDING",
    registrationSubmitted: false,
    accountApproved: false,
    accountActive: false,
    emailVerified: false,
    registrationId,
    email,
    message: "Verify your email address before completing bank registration.",
    redirectTo: "/bank-registration/verify-email",
  };
}

export const ACTIVE_EXPORT_SENTINEL = true;
