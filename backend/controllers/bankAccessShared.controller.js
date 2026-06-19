import { deleteRecord, deleteRecordsByQuery, findRecordsByField, getRecord, listRecords } from "../services/firestore.service.js";
import { ALERT_SEVERITY, emitOperationalAlert, recordOperationalEvent } from "../services/observability.service.js";
import { logInfo } from "../services/logger.service.js";
import { recordMonitoringSignal } from "../services/monitoringCenter.service.js";
import { cached } from "../services/ttlCache.service.js";
import { LEAD_STATUSES } from "../utils/status.constants.js";

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

export function normalizedMobile(value) {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

export function executiveStrongIdentityValues(executive = {}) {
  return [
    executive.id,
    executive.uid,
    executive.authUid,
    executive.sourceId,
    executive.executiveId,
    executive.email,
    executive.officialEmail,
    executive.assignedExecutiveId,
    executive.assignedExecutiveEmail,
    normalizedMobile(executive.mobile),
    normalizedMobile(executive.phone),
    normalizedMobile(executive.assignedExecutiveMobile),
    normalizedMobile(executive.executiveMobile),
  ].filter(Boolean);
}

export function leadExecutiveStrongIdentityValues(lead = {}) {
  return [
    lead.assignedExecutiveId,
    lead.assignedExecutiveEmail,
    lead.executiveEmail,
    lead.loanExecutiveId,
    lead.updatedByExecutiveId,
    normalizedMobile(lead.assignedExecutiveMobile),
    normalizedMobile(lead.executiveMobile),
    normalizedMobile(lead.assignedExecutivePhone),
    normalizedMobile(lead.loanExecutiveMobile),
  ].filter(Boolean);
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
  const strongMatch = anyMatch(leadExecutiveStrongIdentityValues(lead), executiveStrongIdentityValues(partner));
  if (strongMatch) return true;

  const nameMatch = anyMatch([lead.assignedExecutiveName], [partner.name, partner.fullName]);
  if (!nameMatch) return false;
  return anyMatch(leadBankValues(lead), partnerBankValues(partner))
    && anyMatch(leadBranchValues(lead), partnerBranchValues(partner));
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
    const executive = await getRecord("loanExecutives", email).catch(() => null)
      || (await findRecordsByField("loanExecutives", "email", email, 3))[0]
      || (await findRecordsByField("loanExecutives", "officialEmail", email, 3))[0]
      || null;
    if (executive) return {
      ...executive,
      uid: executive.uid || req.user.uid,
      authUid: executive.authUid || req.user.uid,
      email: executive.email || executive.officialEmail || email,
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
      leadExecutiveStrongIdentityValues(lead),
      executiveStrongIdentityValues(partner),
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
  if (!loanExecutiveCanAccessLead(partner, lead)) return false;
  const executiveTargets = executiveStrongIdentityValues(partner);

  const documentExecutiveValues = [
    document.assignedExecutiveId,
    document.assignedExecutiveEmail,
    document.assignedExecutiveMobile,
    document.executiveMobile,
    document.assignedExecutiveName,
  ].filter(Boolean);
  return !documentExecutiveValues.length
    || anyMatch(documentExecutiveValues, executiveTargets)
    || anyMatch([document.assignedExecutiveName], [partner.name, partner.fullName]);
}
