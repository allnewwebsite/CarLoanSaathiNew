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
import { cached, clearCachedTags, clearCachedValue } from "../services/ttlCache.service.js";
import { queueDocumentsRequiredWhatsApp, queueLeadAssignedWhatsApp, queueStatusUpdatedWhatsApp } from "../services/whatsapp.service.js";
import { publishRealtimeEvent, REALTIME_EVENTS } from "../services/realtime.service.js";
import { recordMonitoringSignal } from "../services/monitoringCenter.service.js";
import { loanCapacityUpperBound, normalizeIfsc, normalizeLoanCapacity, validateBankLocation } from "../services/bankLocationMaster.service.js";
import { getBankAnalyticsAggregate } from "../services/bankAnalyticsAggregate.service.js";
import { assertLeadMutable } from "../utils/deadCase.js";
import {
  anyMatch,
  bankManagerCanAccessLead,
  bankStatuses,
  cleanText,
  currentPartner,
  deleteMatchingRecords,
  documentBelongsToBank,
  documentBelongsToBranch,
  documentBelongsToExecutive,
  documentBelongsToLead,
  emitBankLeadAccessDenied,
  EXECUTIVE_ACTIVE_LEAD_STATUSES,
  executiveStrongIdentityValues,
  hasMatchingScopeValues,
  leadBankValues,
  leadBranchValues,
  leadExecutiveStrongIdentityValues,
  leadDetailResponseFromProjection,
  LEAD_DOCUMENT_FIELDS,
  loanExecutiveCanAccessLead,
  logProjectionRead,
  logReadMetric,
  partnerBankValues,
  partnerBranchValues,
  partnerCanAccessLead,
  projectedLeadHasRequiredBankScope,
  sameText,
  userEmail,
} from "./bankAccessShared.controller.js";

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
  clearCachedTags,
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
  anyMatch,
  bankManagerCanAccessLead,
  bankStatuses,
  cleanText,
  currentPartner,
  deleteMatchingRecords,
  documentBelongsToBank,
  documentBelongsToBranch,
  documentBelongsToExecutive,
  documentBelongsToLead,
  emitBankLeadAccessDenied,
  EXECUTIVE_ACTIVE_LEAD_STATUSES,
  executiveStrongIdentityValues,
  hasMatchingScopeValues,
  leadBankValues,
  leadBranchValues,
  leadExecutiveStrongIdentityValues,
  leadDetailResponseFromProjection,
  LEAD_DOCUMENT_FIELDS,
  loanExecutiveCanAccessLead,
  logProjectionRead,
  logReadMetric,
  partnerBankValues,
  partnerBranchValues,
  partnerCanAccessLead,
  projectedLeadHasRequiredBankScope,
  sameText,
  userEmail,
};

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
    const executiveIdentities = executiveStrongIdentityValues(partner);
    const primaryId = partner.id || partner.uid || partner.email || executiveIdentities[0];
    const executiveEmail = partner.email || partner.officialEmail || executiveIdentities.find((value) => String(value).includes("@"));
    const executiveMobile = partner.mobile || partner.assignedExecutiveMobile || partner.executiveMobile;
    const executiveNames = [partner.name, partner.fullName].filter(Boolean);
    const baseQuery = {
      ...query,
      limit: query.limit || 100,
    };
    const projectionQuery = {
      ...baseQuery,
      bankId: query.bankId || partner.bankId || partner.bankPartnerId || undefined,
    };
    const [projected, canonical] = await Promise.all([
      queryLeadProjectionForUser({
      user: { role: "loan-executive", uid: primaryId, email: executiveEmail, mobile: executiveMobile, identityValues: executiveIdentities },
      query: projectionQuery,
      fields,
      }).catch(() => null),
      queryExecutiveLeads({
        executiveId: primaryId,
        executiveEmail,
        executiveMobile,
        executiveIdentities,
        executiveNames,
        query: baseQuery,
        fields,
      }).catch(() => null),
    ]);
    const byId = new Map();
    [...(projected?.data || []), ...(canonical?.data || [])].forEach((lead) => {
      const key = lead.sourceId || lead.id || lead.caseId;
      if (key) byId.set(key, { ...lead, id: lead.sourceId || lead.id });
    });
    const merged = [...byId.values()]
      .filter((lead) => loanExecutiveCanAccessLead(partner, lead))
      .sort((left, right) => String(right.createdAt || right.generatedAt || "").localeCompare(String(left.createdAt || left.generatedAt || "")));
    return attachExecutiveMobile(partner, applyFilters(merged, query));
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
    mobile ? { field: "executiveMobile", value: mobile } : null,
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
  clearCachedTags(`lead:${leadId}`);
}

export function clearBankSummaryCaches() {
  clearCachedTags([
    "lead:list",
    "bank:summary",
    "admin:summary",
    "bank:analytics",
    "bank:notifications",
    "bank:executives",
    "bank:executive-cases",
    "bank:dealerships",
    "bank:leads",
    "gm:notifications",
    "gm:salespersons",
  ]);
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
