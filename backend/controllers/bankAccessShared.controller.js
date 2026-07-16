import { deleteRecord, deleteRecordsByQuery, findRecordsByField, getRecord, listRecords } from "../services/firestore.service.js";
import { ALERT_SEVERITY, emitOperationalAlert, recordOperationalEvent } from "../services/observability.service.js";
import { logInfo } from "../services/logger.service.js";
import { recordMonitoringSignal } from "../services/monitoringCenter.service.js";
import { cached } from "../services/ttlCache.service.js";
import { LEAD_STATUSES } from "../utils/status.constants.js";
import { executiveNameValues } from "../services/roleIdentity.service.js";

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

function hasScopeValue(values) {
  return values.some((value) => Boolean(cleanText(value)));
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
    executive.employeeId,
    executive.employeeCode,
    executive.jobId,
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
  const canonical = [
    lead.assignedExecutiveId,
    lead.assignedExecutiveEmail,
    lead.assignedExecutiveJobId,
    normalizedMobile(lead.assignedExecutiveMobile),
    normalizedMobile(lead.executiveMobile),
    normalizedMobile(lead.assignedExecutivePhone),
  ].filter(Boolean);
  if (canonical.length) return canonical;
  return [
    lead.executiveEmail,
    lead.loanExecutiveId,
    lead.employeeId,
    lead.employeeCode,
    lead.jobId,
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
  const hasLeadBranchScope = hasScopeValue(leadBranchValues(lead));
  return sameBank && (!hasLeadBranchScope || sameBranch);
}

export function loanExecutiveCanAccessLead(partner, lead) {
  const strongMatch = anyMatch(leadExecutiveStrongIdentityValues(lead), executiveStrongIdentityValues(partner));
  if (strongMatch) return true;

  const hasCanonicalOwner = [
    lead.assignedExecutiveId,
    lead.assignedExecutiveEmail,
    lead.assignedExecutiveJobId,
    normalizedMobile(lead.assignedExecutiveMobile),
    normalizedMobile(lead.executiveMobile),
  ].some(Boolean);
  if (hasCanonicalOwner) return false;

  const nameMatch = anyMatch([lead.assignedExecutiveName], executiveNameValues(partner));
  if (!nameMatch) return false;
  return anyMatch(leadBankValues(lead), partnerBankValues(partner));
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

function uniqueValues(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

async function firstRecordByIdentity(collection, identities = [], fields = []) {
  const values = uniqueValues(identities);
  for (const value of values) {
    const direct = await getRecord(collection, value).catch(() => null);
    if (direct) return direct;
    for (const field of fields) {
      const found = (await findRecordsByField(collection, field, value, 3).catch(() => []))[0];
      if (found) return found;
    }
  }
  return null;
}

async function bankProfileForContext(...records) {
  const values = uniqueValues(records.flatMap((record = {}) => [
    record.bankPartnerId,
    record.partnerId,
    record.bankId,
    record.branchId,
    record.bankBranchId,
    record.ifscCode,
    record.bankIfsc,
    record.ifsc,
    record.branchIfsc,
    record.bankName,
    record.companyName,
  ]));
  for (const collection of ["bankPartners", "banks", "branches", "bankBranchCatalog"]) {
    const record = await firstRecordByIdentity(collection, values, ["bankId", "partnerId", "ifscCode", "ifsc", "bankIfsc", "bankName", "companyName"]);
    if (record) return record;
  }
  return null;
}

function bankContextFrom(req, profile = {}, bankProfile = {}, roleType) {
  const account = req.authAccount || {};
  const user = req.user || {};
  const email = userEmail(req);
  const merged = { ...account, ...user, ...bankProfile, ...profile };
  return {
    ...merged,
    id: profile.id || account.id || user.uid || email,
    uid: profile.uid || account.uid || user.uid || email,
    authUid: profile.authUid || account.authUid || user.uid || "",
    email: profile.email || profile.officialEmail || account.email || user.email || email,
    officialEmail: profile.officialEmail || account.officialEmail || user.email || email,
    bankId: profile.bankId || bankProfile.bankId || account.bankId || user.bankId || profile.ifscCode || bankProfile.ifscCode || account.ifscCode || user.ifscCode || "",
    bankPartnerId: profile.bankPartnerId || profile.partnerId || bankProfile.bankPartnerId || bankProfile.partnerId || bankProfile.bankId || account.bankPartnerId || account.bankId || user.bankId || "",
    partnerId: profile.partnerId || bankProfile.partnerId || profile.bankPartnerId || bankProfile.bankPartnerId || "",
    bankName: profile.bankName || profile.companyName || bankProfile.bankName || bankProfile.companyName || account.bankName || account.companyName || user.bankName || "",
    companyName: profile.companyName || profile.bankName || bankProfile.companyName || bankProfile.bankName || account.companyName || account.bankName || user.bankName || "",
    ifsc: profile.ifsc || profile.ifscCode || profile.bankIfsc || bankProfile.ifsc || bankProfile.ifscCode || bankProfile.bankIfsc || account.ifsc || account.ifscCode || account.bankIfsc || user.ifscCode || user.bankIfsc || "",
    ifscCode: profile.ifscCode || profile.bankIfsc || profile.ifsc || bankProfile.ifscCode || bankProfile.bankIfsc || bankProfile.ifsc || account.ifscCode || account.bankIfsc || account.ifsc || user.ifscCode || user.bankIfsc || "",
    bankIfsc: profile.bankIfsc || profile.ifscCode || profile.ifsc || bankProfile.bankIfsc || bankProfile.ifscCode || bankProfile.ifsc || account.bankIfsc || account.ifscCode || account.ifsc || user.bankIfsc || user.ifscCode || "",
    branchId: profile.branchId || profile.bankBranchId || bankProfile.branchId || bankProfile.bankBranchId || account.branchId || user.branchId || profile.ifscCode || bankProfile.ifscCode || account.ifscCode || user.ifscCode || "",
    bankBranchId: profile.bankBranchId || profile.branchId || bankProfile.bankBranchId || bankProfile.branchId || account.bankBranchId || account.branchId || user.branchId || "",
    bankBranchLocation: profile.bankBranchLocation || profile.branchLocation || profile.branchCity || bankProfile.bankBranchLocation || bankProfile.branchLocation || bankProfile.branchCity || account.bankBranchLocation || account.branchLocation || account.branchCity || user.branchLocation || user.branchCity || "",
    branchLocation: profile.branchLocation || profile.bankBranchLocation || profile.branchCity || bankProfile.branchLocation || bankProfile.bankBranchLocation || bankProfile.branchCity || account.branchLocation || account.bankBranchLocation || account.branchCity || user.branchLocation || user.branchCity || "",
    branchCity: profile.branchCity || profile.bankBranchCity || profile.city || bankProfile.branchCity || bankProfile.bankBranchCity || bankProfile.city || account.branchCity || account.bankBranchCity || user.branchCity || "",
    roleType,
    active: merged.active !== false,
  };
}

export async function currentPartner(req) {
  const email = userEmail(req);
  const cacheKey = `context:bank:${req.user?.role || ""}:${req.user?.uid || ""}:${email}`;
  return cached(cacheKey, 15000, async () => {
  if (req.user?.role === "loan-executive") {
    const account = req.authAccount || {};
    const executive = await firstRecordByIdentity("loanExecutives", [
      email,
      req.user?.uid,
      account.uid,
      account.employeeId,
      account.employeeCode,
      account.jobId,
      req.user?.employeeId,
      req.user?.employeeCode,
    ], ["email", "officialEmail", "uid", "authUid", "employeeId", "employeeCode", "jobId"]);
    const bankProfile = await bankProfileForContext(executive || {}, account, req.user || {});
    const partner = bankContextFrom(req, executive || {}, bankProfile || {}, "loan-executive");
    return {
      ...partner,
      executiveId: executive?.executiveId || account.executiveId || partner.id,
      employeeId: executive?.employeeId || account.employeeId || req.user?.employeeId || req.user?.employeeCode || "",
      employeeCode: executive?.employeeCode || account.employeeCode || req.user?.employeeCode || req.user?.employeeId || "",
      jobId: executive?.jobId || account.jobId || "",
      name: executive?.name || executive?.fullName || account.name || account.fullName || req.user?.name || req.user?.fullName || "",
      fullName: executive?.fullName || executive?.name || account.fullName || account.name || req.user?.fullName || req.user?.name || "",
      mobile: executive?.mobile || account.mobile || account.phone || req.user?.mobile || req.user?.phone || "",
      assignedExecutiveMobile: executive?.assignedExecutiveMobile || executive?.mobile || account.mobile || req.user?.mobile || "",
      executiveMobile: executive?.executiveMobile || executive?.mobile || account.mobile || req.user?.mobile || "",
      roleType: "loan-executive",
    };
  }

  if (req.user?.role === "bank-manager") {
    const account = req.authAccount || {};
    const manager = await firstRecordByIdentity("branchManagers", [
      email,
      req.user?.uid,
      account.uid,
    ], ["email", "officialEmail", "uid", "authUid"]);
    const bankProfile = await bankProfileForContext(manager || {}, account, req.user || {});
    return bankContextFrom(req, manager || {}, bankProfile || {}, "bank-manager");
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
    const hasLeadBranchScope = hasScopeValue(leadBranchValues(lead));
    return hasMatchingScopeValues(leadBankValues(lead), partnerBankValues(partner))
      && (!hasLeadBranchScope || hasMatchingScopeValues(leadBranchValues(lead), partnerBranchValues(partner)));
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
