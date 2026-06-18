import { countRecords, createRecord, deleteRecord, deleteRecordsByQuery, findRecordsByField, getRecord, incrementRecord, listRecords, listRecentRecords, queryRecords, updateRecord, upsertRecord } from "../services/firestore.service.js";
import { ensureCommissionForLead } from "../services/commission.service.js";
import { createNotification } from "../services/notification.service.js";
import { freezePartner } from "../services/partner.service.js";
import { getWorkflowSettings, updateWorkflowSettings } from "../services/settings.service.js";
import { getAuditLogs, writeAuditLog } from "../services/audit.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "../services/timeline.service.js";
import { assertValidStatusTransition, LEAD_STATUSES, normalizeStatus, STATUS_LABELS } from "../utils/status.constants.js";
import { firebaseAdmin } from "../firebase/admin.js";
import { logError, logInfo } from "../services/logger.service.js";
import { queryAllLeads } from "../services/leadQuery.service.js";
import { computeLeadMetrics } from "../services/metrics.service.js";
import { assertNoActiveIdentityCollision, upsertCanonicalUser } from "../services/identity.service.js";
import { getLeadDetailProjection, queryLeadProjectionForUser, syncLeadProjectionSoon } from "../services/projection.service.js";
import { cached, clearCachedValue } from "../services/ttlCache.service.js";
import { revokeUserSessions } from "./auth.controller.js";
import { recordMonitoringSignal } from "../services/monitoringCenter.service.js";
import { publishRealtimeEvent, REALTIME_EVENTS } from "../services/realtime.service.js";
import { normalizeIfsc, validateBankLocation } from "../services/bankLocationMaster.service.js";
import { queueDocumentsRequiredWhatsApp, queueStatusUpdatedWhatsApp } from "../services/whatsapp.service.js";
import { initializeDealershipTrial, initializeProfessionalSubscriptionPending } from "../services/subscription.service.js";
import { isProfessionalPlan, normalizeOnboardingPlan } from "../utils/onboardingPlan.js";
import {
  registerBankBranchAdmin,
  approveBankBranchAdmin,
  rejectBankBranchAdmin,
  deactivateBankBranchAdmin,
  getAdminBankBranches,
  getBankBranchDetailsAdmin,
  updateBankBranchAdmin,
} from "./bank.admin.controller.js";

export {
  countRecords,
  createRecord,
  deleteRecord,
  deleteRecordsByQuery,
  findRecordsByField,
  getRecord,
  incrementRecord,
  listRecords,
  listRecentRecords,
  queryRecords,
  updateRecord,
  upsertRecord,
  ensureCommissionForLead,
  createNotification,
  freezePartner,
  getWorkflowSettings,
  updateWorkflowSettings,
  getAuditLogs,
  writeAuditLog,
  addTimelineEvent,
  TIMELINE_EVENTS,
  assertValidStatusTransition,
  LEAD_STATUSES,
  normalizeStatus,
  STATUS_LABELS,
  firebaseAdmin,
  logError,
  logInfo,
  queryAllLeads,
  computeLeadMetrics,
  assertNoActiveIdentityCollision,
  upsertCanonicalUser,
  getLeadDetailProjection,
  queryLeadProjectionForUser,
  syncLeadProjectionSoon,
  cached,
  clearCachedValue,
  revokeUserSessions,
  recordMonitoringSignal,
  publishRealtimeEvent,
  REALTIME_EVENTS,
  normalizeIfsc,
  validateBankLocation,
  queueDocumentsRequiredWhatsApp,
  queueStatusUpdatedWhatsApp,
  initializeDealershipTrial,
  initializeProfessionalSubscriptionPending,
  isProfessionalPlan,
  normalizeOnboardingPlan,
  registerBankBranchAdmin,
  approveBankBranchAdmin,
  rejectBankBranchAdmin,
  deactivateBankBranchAdmin,
  getAdminBankBranches,
  getBankBranchDetailsAdmin,
  updateBankBranchAdmin,
};

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

export function sameDate(value, target) {
  if (!target) return true;
  if (!value) return false;
  return new Date(value).toISOString().slice(0, 10) === target;
}

export function leadText(lead) {
  return [
    lead.caseId,
    lead.fullName,
    lead.customerName,
    lead.mobile,
    lead.city,
    lead.selectedBrand,
    lead.selectedModel,
    lead.preferredBank,
    lead.bankPartner,
    lead.status,
  ].filter(Boolean).join(" ").toLowerCase();
}

export function sameText(left, right) {
  const cleanLeft = String(left || "").trim().toLowerCase();
  const cleanRight = String(right || "").trim().toLowerCase();
  return Boolean(cleanLeft && cleanRight && cleanLeft === cleanRight);
}

export async function enrichAdminLeadRows(leads = []) {
  if (!leads.length) return leads;
  const [bankPartners, bankApprovals] = await Promise.all([
    listRecentRecords("bankPartners", { limit: 200 }).catch(() => []),
    listRecentRecords("pendingBankApprovals", { limit: 200 }).catch(() => []),
  ]);
  const banks = [...bankPartners, ...bankApprovals];
  return leads.map((lead) => {
    const bank = banks.find((item) =>
      sameText(item.id, lead.bankId)
      || sameText(item.id, lead.assignedPartnerId)
      || sameText(item.bankId, lead.bankId)
      || sameText(item.email, lead.bankId)
      || sameText(item.email, lead.assignedPartnerId)
      || sameText(item.bankName, lead.assignedBankName)
      || sameText(item.companyName, lead.assignedBankName)
      || sameText(item.bankName, lead.bankPartner)
      || sameText(item.companyName, lead.bankPartner)
      || sameText(item.bankName, lead.preferredBank)
    );
    return {
      ...lead,
      assignedBankName: lead.assignedBankName || lead.bankPartner || bank?.bankName || bank?.companyName || null,
      assignedBankIfsc: lead.assignedBankIfsc || bank?.ifsc || bank?.bankIfsc || bank?.ifscCode || null,
    };
  });
}

export function filterLeads(leads, query) {
  const search = (query.search || "").trim().toLowerCase();
  return leads.filter((lead) => {
    const bank = lead.preferredBank || lead.bankPartner || lead.bank;
    const matchesSearch = !search || leadText(lead).includes(search);
    const matchesStatus = !query.status || normalizeStatus(lead.status) === normalizeStatus(query.status);
    const matchesBank = !query.bank || bank === query.bank;
    const matchesCity = !query.city || (lead.city || "").toLowerCase() === query.city.toLowerCase();
    const matchesDate = sameDate(lead.createdAt, query.date);
    return matchesSearch && matchesStatus && matchesBank && matchesCity && matchesDate;
  });
}

export async function approvalLog({ req, entityType, entityId, previousStatus, newStatus, rejectionReason = "" }) {
  return createRecord("approvalLogs", {
    entityType,
    entityId,
    approvedBy: newStatus === "approved" ? req.user?.email || "super-admin" : null,
    approvedAt: newStatus === "approved" ? new Date().toISOString() : null,
    rejectedBy: newStatus === "rejected" ? req.user?.email || "super-admin" : null,
    rejectionReason,
    previousStatus,
    newStatus,
  });
}

export function today(value) {
  return String(value || "").startsWith(new Date().toISOString().slice(0, 10));
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function approvalStatusOf(record) {
  return String(record?.status || record?.approvalStatus || "pending").trim().toLowerCase();
}

export function finalApprovalStatus(record) {
  return ["approved", "rejected", "suspended", "deleted", "disabled", "inactive"].includes(approvalStatusOf(record));
}

export function pendingApprovalStatus(record) {
  if (record?.accountApproved === true || record?.approved === true) return false;
  return !finalApprovalStatus(record);
}

export function ecosystemLimit(value, fallback = 5) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 10) : fallback;
}

export async function boundedList(collection, limit, mapper = (item) => item, fields = []) {
  const rows = await listRecentRecords(collection, { limit, fields });
  return rows.map(mapper);
}

export const APPROVAL_LIST_FIELDS = [
  "id",
  "status",
  "approvalStatus",
  "accountType",
  "type",
  "dealershipName",
  "dealershipBrand",
  "city",
  "loginEmail",
  "primaryGoogleEmail",
  "bankName",
  "companyName",
  "bankBranchLocation",
  "branchLocation",
  "ifsc",
  "ifscCode",
  "managerName",
  "contactPerson",
  "mobile",
  "email",
  "officialEmail",
  "state",
  "monthlyLoanCapacity",
  "monthlyCapacity",
  "approvalLimit",
  "executiveCount",
  "executives",
  "documents",
  "createdAt",
  "updatedAt",
  "submittedAt",
  "dealership",
];

export const APPROVAL_LIST_PROJECTION_FIELDS = APPROVAL_LIST_FIELDS;

export function clearAdminApprovalCaches() {
  clearCachedValue("admin:approvals:");
  clearCachedValue("admin:ecosystem:");
  clearCachedValue("admin:partners:");
}

export function runAdminSideEffects(label, tasks = []) {
  Promise.allSettled(tasks.map((task) => task())).catch((error) => {
    logError("Admin side effect runner failed", { label, error: error.message });
  });
}

export function clearLeadMutationCaches(leadId) {
  clearCachedValue(`lead-detail:${leadId}:`);
  clearCachedValue(`timeline:lead:${leadId}:`);
  clearCachedValue("admin:");
  clearCachedValue("bank:");
  clearCachedValue("dealer:");
  clearCachedValue("finance:");
  clearCachedValue("gm:");
  clearCachedValue("lead-query:");
}

export function safeAdminUser(user = {}) {
  return {
    id: user.id,
    uid: user.uid || user.email,
    email: user.email,
    role: user.role,
    approved: user.approved === true,
    active: user.active !== false,
    accountStatus: user.accountStatus || user.status || "",
    dealershipId: user.dealershipId || null,
    bankId: user.bankId || null,
    branchId: user.branchId || null,
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
    lastLoginAt: user.lastLoginAt || null,
    lockedUntil: user.lockedUntil || null,
  };
}

export function safeLoginActivity(item = {}) {
  return {
    id: item.id,
    email: item.email,
    role: item.role || null,
    status: item.status,
    reason: item.reason || "",
    createdAt: item.createdAt || item.timestamp || null,
    ipAddress: item.ipAddress ? "recorded" : "",
    userAgent: item.userAgent ? "recorded" : "",
  };
}

export function safeDocument(item = {}) {
  return {
    id: item.id,
    leadId: item.leadId || null,
    caseId: item.caseId || null,
    dealershipId: item.dealershipId || null,
    bankId: item.bankId || null,
    assignedExecutiveId: item.assignedExecutiveId || null,
    assignedExecutiveEmail: item.assignedExecutiveEmail || null,
    type: item.type || item.documentType || item.label || "",
    documentType: item.documentType || item.type || "",
    fileName: item.fileName || item.originalName || "",
    fileType: item.fileType || item.mimeType || "",
    size: item.size || item.fileSize || null,
    status: item.status || "",
    uploadedBy: item.uploadedBy || "",
    createdAt: item.createdAt || item.uploadedAt || null,
  };
}

export async function firstAdminLookup(lookups = []) {
  for (const lookup of lookups) {
    const result = await lookup().catch(() => null);
    if (Array.isArray(result)) {
      if (result[0]) return result[0];
    } else if (result) {
      return result;
    }
  }
  return null;
}

export async function incrementPlatformCounters(increments = {}) {
  clearCachedValue("metrics:global:v2");
  return incrementRecord("metrics", "global", increments, {
    activeDealerships: 0,
    approvedDealerships: 0,
    pendingDealerships: 0,
    totalDealerships: 0,
    disabledDealerships: 0,
    bankPartners: 0,
    activeBanks: 0,
    totalBranches: 0,
    disabledBranches: 0,
    updatedAt: new Date().toISOString(),
  }).catch(() => null);
}

export function requestLoginEmail(request) {
  return normalizeEmail(request.loginEmail || request.primaryGoogleEmail || request.dealership?.loginEmail || request.financeDesk?.officialEmail || request.dealership?.officialDealershipEmail);
}

export function stripRemovedDealershipFields(dealership = {}) {
  const {
    officialDealershipEmail,
    ...rest
  } = dealership || {};
  return rest;
}

export function safeDealershipApprovalRecord(record = {}) {
  if (!record || typeof record !== "object") return record;
  const {
    officialDealershipEmail,
    ...rest
  } = record;
  return {
    ...rest,
    ...(record.dealership ? { dealership: stripRemovedDealershipFields(record.dealership) } : {}),
  };
}

export function dealerEventPayload({ loginEmail, dealership = {}, status = "updated" } = {}) {
  return {
    dealerId: loginEmail || dealership.dealerId || dealership.loginEmail || "",
    dealerName: dealership.dealerName || dealership.dealershipName || "",
    dealerBrand: dealership.dealerBrand || dealership.dealershipBrand || "",
    dealerState: dealership.dealerState || dealership.state || "",
    dealerLocation: dealership.dealerLocation || dealership.location || dealership.city || "",
    dealerStatus: status,
    monthlySalesCapacity: dealership.monthlySalesCapacity || dealership.monthlyCarSalesCapacity || "",
  };
}

export function recordDealerSignal(tag, payload = {}) {
  recordMonitoringSignal(tag, {
    dealerId: payload.dealerId,
    dealerBrand: payload.dealerBrand,
    state: payload.dealerState,
    location: payload.dealerLocation,
    monthlySalesCapacity: payload.monthlySalesCapacity,
  });
}

export function publishDealerEvent(eventType, req, payload = {}) {
  publishRealtimeEvent({
    eventType,
    actor: req.user || null,
    data: {
      dealershipId: payload.dealerId,
      publicDealerCatalog: true,
      dealerEvent: payload,
    },
  });
}

export function firestoreNotFound(error) {
  return error?.code === 5
    || error?.code === "not-found"
    || /not[-_ ]found|no document to update/i.test(String(error?.message || ""));
}

export async function updateRecordIfExists(collection, id, payload, options = {}) {
  if (!id) return null;
  const existing = await getRecord(collection, id).catch((error) => {
    if (firestoreNotFound(error)) return null;
    throw error;
  });
  if (!existing) return null;
  try {
    return await updateRecord(collection, existing.id, payload, options);
  } catch (error) {
    if (firestoreNotFound(error)) return null;
    throw error;
  }
}

export function dealerIdentityProfile(dealership = {}, request = {}) {
  return {
    dealershipName: dealership.dealershipName || dealership.name || request.dealershipName || "",
    dealerName: dealership.dealerName || dealership.dealershipName || request.dealershipName || "",
    officialDealershipMobile: dealership.officialDealershipMobile || request.owner?.mobile || "",
    ownerName: request.owner?.fullName || dealership.ownerName || "",
    ownerMobile: request.owner?.mobile || dealership.ownerMobile || "",
    address: dealership.address || dealership.fullAddress || "",
    city: dealership.city || dealership.location || request.city || "",
    state: dealership.state || request.state || "",
    createdAt: dealership.createdAt || request.createdAt || request.submittedAt || new Date().toISOString(),
  };
}

export async function materializeApprovedDealership({ request, loginEmail, dealership }) {
  const selectedPlan = normalizeOnboardingPlan(request.selectedPlan || dealership.selectedPlan);
  const dealerLocation = dealership.dealerLocation || dealership.location || dealership.city || request.city || "";
  const dealerFields = {
    ...stripRemovedDealershipFields(dealership),
    dealerId: loginEmail,
    dealerName: dealership.dealerName || dealership.dealershipName || request.dealershipName || "",
    dealerBrand: dealership.dealerBrand || dealership.dealershipBrand || request.dealershipBrand || "",
    dealerState: dealership.dealerState || dealership.state || request.state || "",
    dealerLocation,
    dealerStatus: "approved",
    monthlySalesCapacity: dealership.monthlySalesCapacity || dealership.monthlyCarSalesCapacity || "",
    location: dealerLocation,
    selectedPlan,
  };
  const gmEmail = request.generalManager?.email ? normalizeEmail(request.generalManager.email) : "";
  const [financeUid, gmUid] = await Promise.all([
    firebaseUidForEmail(loginEmail),
    gmEmail ? firebaseUidForEmail(gmEmail) : Promise.resolve(null),
  ]);
  const financeCanonicalId = financeUid || loginEmail;
  await assertNoActiveIdentityCollision({ uid: financeCanonicalId, email: loginEmail, role: "finance-desk", excludeIds: [financeCanonicalId, loginEmail] });
  let gmCanonicalId = "";
  if (gmEmail) {
    gmCanonicalId = gmUid || gmEmail;
    await assertNoActiveIdentityCollision({ uid: gmCanonicalId, email: gmEmail, role: "gm", excludeIds: [gmCanonicalId, gmEmail] });
  }
  const writeTasks = [
    () => upsertRecord("dealerships", loginEmail, dealerFields, { readback: false }),
    () => upsertRecord("approvedDealerships", loginEmail, dealerFields, { readback: false }),
    () => upsertRecord("dealers", loginEmail, { ...dealerFields, role: "finance-desk", accountActive: true }, { readback: false }),
    () => upsertRecord("dealershipManagers", `${loginEmail}:owner`, { dealershipEmail: loginEmail, role: "Owner", ...(request.owner || {}), status: "active", active: true }, { readback: false }),
    () => upsertRecord("cityMappings", `dealer:${request.city}:${loginEmail}`, { type: "dealer", city: request.city, dealershipEmail: loginEmail, dealershipName: request.dealershipName, status: "approved", active: true }, { readback: false }),
    () => upsertCanonicalUser(financeCanonicalId, {
      ...dealerIdentityProfile(dealerFields, request),
      uid: financeCanonicalId,
      email: loginEmail,
      officialEmail: loginEmail,
      mobile: dealerFields.officialDealershipMobile || request.owner?.mobile || "",
      ownerName: request.owner?.fullName || "",
      ownerMobile: request.owner?.mobile || "",
      role: "finance-desk",
      approved: true,
      active: true,
      accountApproved: true,
      accountActive: true,
      dealershipId: loginEmail,
      status: "active",
      accountStatus: "active",
      selectedPlan,
    }),
  ];
  if (gmEmail) {
    writeTasks.push(() => upsertCanonicalUser(gmCanonicalId, {
      ...dealerIdentityProfile(dealerFields, request),
      uid: gmCanonicalId,
      email: gmEmail,
      officialEmail: gmEmail,
      name: request.generalManager?.name || "",
      fullName: request.generalManager?.name || "",
      mobile: request.generalManager?.mobile || "",
      ownerName: request.owner?.fullName || "",
      ownerMobile: request.owner?.mobile || "",
      role: "gm",
      approved: true,
      active: true,
      accountApproved: true,
      accountActive: true,
      dealershipId: loginEmail,
      status: "active",
      accountStatus: "active",
      selectedPlan,
    }));
  }
  if (request.generalManager?.name || request.generalManager?.mobile || gmEmail) {
    writeTasks.push(() => upsertRecord("dealershipManagers", `${loginEmail}:gm`, { dealershipEmail: loginEmail, role: "General Manager", fullName: request.generalManager?.name, mobile: request.generalManager?.mobile, email: request.generalManager?.email, status: "active", active: true }, { readback: false }));
  }
  const financeDeskPayload = {
    ...(request.financeDesk || {}),
    dealershipEmail: loginEmail,
    dealershipId: loginEmail,
    city: request.city,
    officialEmail: normalizeEmail(request.financeDesk?.officialEmail) || loginEmail,
    email: normalizeEmail(request.financeDesk?.officialEmail) || loginEmail,
    status: "active",
    active: true,
  };
  writeTasks.push(
    () => upsertRecord("financeDesk", loginEmail, financeDeskPayload, { readback: false }),
    () => upsertRecord("financeDesks", loginEmail, financeDeskPayload, { readback: false }),
  );
  await Promise.all(writeTasks.map((task) => task()));
}

export async function approveDealershipBackrefs({ request, loginEmail, now, approvedBy }) {
  const selectedPlan = normalizeOnboardingPlan(request.selectedPlan || request.dealership?.selectedPlan);
  const subscriptionAccessStatus = isProfessionalPlan(selectedPlan) ? "PAYMENT_REQUIRED" : "TRIAL_ACTIVE";
  const updated = await updateRecordIfExists("pendingDealershipApprovals", request.id, {
    status: "approved",
    approvalStatus: "approved",
    dealershipVerified: true,
    approvedAt: now,
    approvedBy,
    selectedPlan,
    subscriptionAccessStatus,
  });
  const sideUpdates = [];
  if (request.onboardingRequestId) sideUpdates.push(updateRecordIfExists("onboardingRequests", request.onboardingRequestId, { status: "Approved", active: true, accountActive: true, approvedAt: now, approvedBy, selectedPlan, subscriptionAccessStatus }, { readback: false }));
  const pendingAccountId = request.pendingDealerAccountId || request.pendingDealerRegistrationId;
  if (pendingAccountId) sideUpdates.push(updateRecordIfExists("pendingDealerAccounts", pendingAccountId, { registrationSubmitted: true, approvalStatus: "approved", accountApproved: true, accountActive: true, approvedAt: now, approvedBy, selectedPlan, subscriptionAccessStatus }, { readback: false }));
  await Promise.all(sideUpdates);
  if (!pendingAccountId && loginEmail) {
    const pendingAccount = await firstAdminLookup([
      () => getRecord("pendingDealerAccounts", loginEmail),
      () => findRecordsByField("pendingDealerAccounts", "email", loginEmail, 5),
    ]);
    if (pendingAccount) await updateRecordIfExists("pendingDealerAccounts", pendingAccount.id, { registrationSubmitted: true, approvalStatus: "approved", accountApproved: true, accountActive: true, approvedAt: now, approvedBy, selectedPlan, subscriptionAccessStatus }, { readback: false });
  }
  const queueItem = await firstAdminLookup([
    () => findRecordsByField("dealerApprovalQueue", "pendingDealershipApprovalId", request.id, 5),
    () => findRecordsByField("dealerApprovalQueue", "pendingDealerAccountId", request.pendingDealerAccountId || request.pendingDealerRegistrationId, 5),
  ]);
  if (queueItem) await updateRecordIfExists("dealerApprovalQueue", queueItem.id, { status: "approved", approvalStatus: "approved", approvedAt: now, approvedBy, selectedPlan, subscriptionAccessStatus }, { readback: false });
  return updated;
}

export async function materializeApprovedBank({ request, bankEmail, bankName, branchLocation, state, ifsc, branchId, partnerId, now, approvedBy }) {
  await upsertRecord("bankPartners", partnerId, { ...request, id: partnerId, email: bankEmail, officialEmail: bankEmail, bankId: partnerId, bankPartnerId: partnerId, branchId, bankName, ifsc, branchIfsc: ifsc, ifscCode: ifsc, bankIfsc: ifsc, branchLocation, bankBranchLocation: branchLocation, branchCity: branchLocation, city: branchLocation, state, serviceArea: branchLocation, status: "active", active: true, approved: true, frozen: false, approvedAt: now, approvedBy });
  await upsertRecord("banks", partnerId, {
    id: partnerId,
    bankId: partnerId,
    branchId,
    email: bankEmail,
    officialEmail: bankEmail,
    name: bankName,
    bankName,
    branchName: branchLocation,
    branchLocation,
    bankBranchLocation: branchLocation,
    city: branchLocation,
    branchCity: branchLocation,
    state,
    ifsc,
    ifscCode: ifsc,
    branchIfsc: ifsc,
    bankIfsc: ifsc,
    serviceArea: branchLocation,
    status: "active",
    approvalStatus: "approved",
    active: true,
    approved: true,
    approvedAt: now,
    approvedBy,
  });
  await upsertRecord("branches", branchId, { id: branchId, bankPartnerId: partnerId, bankId: partnerId, branchId, bankName, branchName: branchLocation, branchLocation, bankBranchLocation: branchLocation, city: branchLocation, branchCity: branchLocation, ifscCode: ifsc, branchIfsc: ifsc, bankIfsc: ifsc, ifsc, state, serviceArea: branchLocation, status: "approved", active: true, approved: true, publicStatus: "approved" });
  await upsertRecord("branchManagers", bankEmail, { email: bankEmail, officialEmail: bankEmail, bankPartnerId: partnerId, bankId: partnerId, bankName, ifsc, ifscCode: ifsc, branchIfsc: ifsc, bankIfsc: ifsc, bankBranchLocation: branchLocation, branchLocation, branchCity: branchLocation, city: branchLocation, state, serviceArea: branchLocation, branchId, name: request.managerName || request.contactPerson, mobile: request.mobile, status: "active", active: true, approved: true, accountStatus: "active", accountApproved: true, accountActive: true });
}

export async function activateApprovedBankUsers({ request, bankEmail, bankName, branchLocation, state, ifsc, partnerId }) {
  const bankUid = await firebaseUidForEmail(bankEmail);
  const bankCanonicalId = bankUid || bankEmail;
  await assertNoActiveIdentityCollision({ uid: bankCanonicalId, email: bankEmail, role: "bank-manager", excludeIds: [bankCanonicalId, bankEmail] });
  await upsertCanonicalUser(bankCanonicalId, {
    uid: bankCanonicalId,
    email: bankEmail,
    officialEmail: request.officialEmail || bankEmail,
    role: "bank-manager",
    name: request.managerName || request.contactPerson || "",
    managerName: request.managerName || request.contactPerson || "",
    mobile: request.mobile || "",
    bankName,
    companyName: request.companyName || bankName,
    address: request.address || request.fullAddress || "",
    city: branchLocation,
    approved: true,
    active: true,
    accountStatus: "active",
    accountApproved: true,
    accountActive: true,
    bankId: partnerId,
    branchId: partnerId,
    branchIfsc: ifsc,
    ifscCode: ifsc,
    bankIfsc: ifsc,
    branchLocation,
    bankBranchLocation: branchLocation,
    state,
    createdAt: request.createdAt || request.submittedAt || new Date().toISOString(),
    status: "active",
  });
  if (firebaseAdmin) {
    try {
      const firebaseUser = await firebaseAdmin.auth().getUserByEmail(bankEmail);
      await firebaseAdmin.auth().setCustomUserClaims(firebaseUser.uid, {
        role: "bank-manager",
        approved: true,
        active: true,
        dealershipId: null,
        bankId: partnerId,
        branchId: partnerId || null,
        branchIfsc: ifsc,
      });
    } catch {
      // Firebase account may be created later; login will repair claims.
    }
  }
  for (const executive of Array.isArray(request.executives) ? request.executives : []) {
    const executiveEmail = normalizeEmail(executive.email || executive.officialEmail);
    if (executiveEmail) {
      await upsertRecord("loanExecutives", executiveEmail, { ...executive, email: executiveEmail, officialEmail: executiveEmail, bankPartnerId: partnerId, bankId: partnerId, bankName, ifsc, ifscCode: ifsc, branchIfsc: ifsc, bankIfsc: ifsc, branchCity: branchLocation, branchLocation, bankBranchLocation: branchLocation, state, serviceArea: branchLocation, branchId: partnerId, status: "active", active: true, approved: true, accountStatus: "active", accountApproved: true, accountActive: true });
      await assertNoActiveIdentityCollision({ uid: executiveEmail, email: executiveEmail, role: "loan-executive", excludeIds: [executiveEmail] });
      await upsertCanonicalUser(executiveEmail, {
        uid: executiveEmail,
        email: executiveEmail,
        officialEmail: executiveEmail,
        name: executive.name || executive.fullName || "",
        fullName: executive.fullName || executive.name || "",
        mobile: executive.mobile || executive.phone || "",
        employeeId: executive.employeeId || executive.employeeCode || "",
        role: "loan-executive",
        approved: true,
        active: true,
        accountStatus: "active",
        accountApproved: true,
        accountActive: true,
        bankId: partnerId,
        bankName,
        branchId: partnerId,
        branchIfsc: ifsc,
        ifscCode: ifsc,
        bankIfsc: ifsc,
        branchLocation,
        bankBranchLocation: branchLocation,
        state,
        createdAt: executive.createdAt || request.createdAt || request.submittedAt || new Date().toISOString(),
        status: "active",
      });
    }
  }
}

export async function approveBankBackrefs({ request, bankEmail, bankName, branchLocation, partnerId, now, approvedBy }) {
  for (const city of request.supportedCities?.length ? request.supportedCities : [branchLocation].filter(Boolean)) {
    await upsertRecord("bankCityMappings", `${partnerId}:${city}`, { bankPartnerId: partnerId, bankName, city, bankBranchLocation: city, approvalLimit: request.approvalLimit || 100, status: "active", active: true });
  }
  const approvalPatch = {
    status: "approved",
    approvalStatus: "approved",
    active: true,
    approved: true,
    accountApproved: true,
    accountActive: true,
    bankId: partnerId,
    bankPartnerId: partnerId,
    branchId: partnerId,
    branchIfsc: partnerId,
    ifscCode: partnerId,
    bankIfsc: partnerId,
    branchLocation,
    bankBranchLocation: branchLocation,
    approvedAt: now,
    approvedBy,
  };
  const updated = await updateRecordIfExists("pendingBankApprovals", request.id, approvalPatch);
  const pendingBankAccount = await firstAdminLookup([
    () => getRecord("pendingBankAccounts", bankEmail),
    () => findRecordsByField("pendingBankAccounts", "email", bankEmail, 5),
    () => findRecordsByField("pendingBankAccounts", "officialEmail", bankEmail, 5),
    () => findRecordsByField("pendingBankAccounts", "primaryGoogleEmail", bankEmail, 5),
    () => findRecordsByField("pendingBankAccounts", "approvalRequestId", request.id, 5),
    () => findRecordsByField("pendingBankAccounts", "pendingBankApprovalId", request.id, 5),
  ]);
  if (pendingBankAccount) {
    await updateRecordIfExists("pendingBankAccounts", pendingBankAccount.id, {
      registrationSubmitted: true,
      approvalStatus: "approved",
      status: "approved",
      active: true,
      approved: true,
      accountApproved: true,
      accountActive: true,
      bankId: partnerId,
      bankPartnerId: partnerId,
      branchId: partnerId,
      branchIfsc: partnerId,
      ifscCode: partnerId,
      bankIfsc: partnerId,
      branchLocation,
      bankBranchLocation: branchLocation,
      approvedAt: now,
      approvedBy,
    });
  } else {
    await upsertRecord("pendingBankAccounts", bankEmail, {
      email: bankEmail,
      registrationSubmitted: true,
      approvalStatus: "approved",
      status: "approved",
      active: true,
      approved: true,
      accountApproved: true,
      accountActive: true,
      bankId: partnerId,
      bankPartnerId: partnerId,
      branchId: partnerId,
      branchIfsc: partnerId,
      ifscCode: partnerId,
      bankIfsc: partnerId,
      branchLocation,
      bankBranchLocation: branchLocation,
      approvalRequestId: request.id,
      approvedAt: now,
      approvedBy,
    });
  }
  return updated;
}

export async function resolveDealershipApprovalRequest(id) {
  const directApproval = await getRecord("pendingDealershipApprovals", id).catch((error) => {
    if (firestoreNotFound(error)) return null;
    throw error;
  });
  if (directApproval) return directApproval;

  const pendingAccount = await getRecord("pendingDealerAccounts", id).catch((error) => {
    if (firestoreNotFound(error)) return null;
    throw error;
  });
  if (!pendingAccount) return null;

  const loginEmail = normalizeEmail(pendingAccount.email || pendingAccount.loginEmail || pendingAccount.primaryGoogleEmail);
  const approval = await firstAdminLookup([
    () => getRecord("pendingDealershipApprovals", pendingAccount.approvalRequestId),
    () => findRecordsByField("pendingDealershipApprovals", "pendingDealerAccountId", pendingAccount.id, 5),
    () => findRecordsByField("pendingDealershipApprovals", "pendingDealerRegistrationId", pendingAccount.id, 5),
    () => findRecordsByField("pendingDealershipApprovals", "onboardingRequestId", pendingAccount.onboardingRequestId, 5),
    () => findRecordsByField("pendingDealershipApprovals", "loginEmail", loginEmail, 5),
    () => findRecordsByField("pendingDealershipApprovals", "primaryGoogleEmail", loginEmail, 5),
  ]);
  return approval || {
    ...pendingAccount,
    id: pendingAccount.approvalRequestId || pendingAccount.id,
    pendingDealerAccountId: pendingAccount.id,
    loginEmail,
    status: pendingAccount.approvalStatus || pendingAccount.status || "pending",
  };
}

export async function activateDealerAccessFromRequest({ request, req, now }) {
  const loginEmail = requestLoginEmail(request);
  if (!loginEmail) return null;

  const approvedBy = req.user?.email || "super-admin";
  const dealership = {
    ...stripRemovedDealershipFields(request.dealership || {}),
    dealershipName: request.dealershipName || request.dealership?.dealershipName || request.dealership?.name,
    dealershipBrand: request.dealershipBrand || request.dealership?.dealershipBrand || request.dealership?.brand,
    city: request.city || request.dealership?.city,
    onboardingRequestId: request.onboardingRequestId || request.id,
    loginEmail,
    primaryGoogleEmail: normalizeEmail(request.primaryGoogleEmail) || loginEmail,
    status: "approved",
    active: true,
    approved: true,
    accountActive: true,
    accountApproved: true,
    verified: true,
    dealershipVerified: true,
    approvedAt: now,
    approvedBy,
  };

  await upsertRecord("dealerships", loginEmail, dealership);
  await upsertRecord("approvedDealerships", loginEmail, dealership);
  await upsertRecord("dealers", loginEmail, { ...dealership, role: "finance-desk" });
  await assertNoActiveIdentityCollision({ uid: loginEmail, email: loginEmail, role: "finance-desk", excludeIds: [loginEmail] });
  await upsertCanonicalUser(loginEmail, {
    ...dealerIdentityProfile(dealership, request),
    uid: loginEmail,
    email: loginEmail,
    officialEmail: loginEmail,
    mobile: dealership.officialDealershipMobile || request.owner?.mobile || "",
    ownerName: request.owner?.fullName || "",
    ownerMobile: request.owner?.mobile || "",
    role: "finance-desk",
    approved: true,
    active: true,
    accountApproved: true,
    accountActive: true,
    dealershipId: loginEmail,
    accountStatus: "active",
    status: "active",
  });

  const gmEmail = normalizeEmail(request.generalManager?.email);
  if (gmEmail) {
    await assertNoActiveIdentityCollision({ uid: gmEmail, email: gmEmail, role: "gm", excludeIds: [gmEmail] });
    await upsertCanonicalUser(gmEmail, {
      ...dealerIdentityProfile(dealership, request),
      uid: gmEmail,
      email: gmEmail,
      officialEmail: gmEmail,
      name: request.generalManager?.name || "",
      fullName: request.generalManager?.name || "",
      mobile: request.generalManager?.mobile || "",
      ownerName: request.owner?.fullName || "",
      ownerMobile: request.owner?.mobile || "",
      role: "gm",
      approved: true,
      active: true,
      accountApproved: true,
      accountActive: true,
      dealershipId: loginEmail,
      accountStatus: "active",
      status: "active",
    });
  }

  await upsertRecord("dealershipManagers", `${loginEmail}:owner`, {
    dealershipEmail: loginEmail,
    role: "Owner",
    ...(request.owner || {}),
    status: "active",
    active: true,
  });
  await upsertRecord("dealershipManagers", `${loginEmail}:gm`, {
    dealershipEmail: loginEmail,
    role: "General Manager",
    fullName: request.generalManager?.name,
    mobile: request.generalManager?.mobile,
    email: gmEmail || request.generalManager?.email,
    status: "active",
    active: true,
  });
  await upsertRecord("financeDesk", loginEmail, {
    dealershipEmail: loginEmail,
    city: request.city || request.dealership?.city,
    ...(request.financeDesk || {}),
    officialEmail: normalizeEmail(request.financeDesk?.officialEmail) || loginEmail,
    status: "active",
    active: true,
  });
  await upsertRecord("financeDesks", loginEmail, {
    dealershipEmail: loginEmail,
    city: request.city || request.dealership?.city,
    ...(request.financeDesk || {}),
    officialEmail: normalizeEmail(request.financeDesk?.officialEmail) || loginEmail,
    status: "active",
    active: true,
  });

  const city = request.city || request.dealership?.city;
  if (city) {
    await upsertRecord("cityMappings", `dealer:${city}:${loginEmail}`, {
      type: "dealer",
      city,
      dealershipEmail: loginEmail,
      dealershipName: request.dealershipName || request.dealership?.dealershipName,
      status: "approved",
      active: true,
    });
  }

  const pendingAccount = await firstAdminLookup([
    () => getRecord("pendingDealerAccounts", request.pendingDealerAccountId),
    () => getRecord("pendingDealerAccounts", request.pendingDealerRegistrationId),
    () => getRecord("pendingDealerAccounts", loginEmail),
    () => findRecordsByField("pendingDealerAccounts", "email", loginEmail, 5),
    () => findRecordsByField("pendingDealerAccounts", "uid", request.dealerUid, 5),
    () => findRecordsByField("pendingDealerAccounts", "onboardingRequestId", request.id, 5),
    () => findRecordsByField("pendingDealerAccounts", "approvalRequestId", request.approvalRequestId, 5),
  ]);
  if (pendingAccount) {
    await updateRecordIfExists("pendingDealerAccounts", pendingAccount.id, {
      registrationSubmitted: true,
      registrationCompleted: true,
      approvalStatus: "approved",
      accountApproved: true,
      accountActive: true,
      approvedAt: now,
      approvedBy,
    });
  }

  const approval = await firstAdminLookup([
    () => getRecord("pendingDealershipApprovals", request.approvalRequestId),
    () => findRecordsByField("pendingDealershipApprovals", "onboardingRequestId", request.id, 5),
    () => findRecordsByField("pendingDealershipApprovals", "loginEmail", loginEmail, 5),
    () => findRecordsByField("pendingDealershipApprovals", "primaryGoogleEmail", loginEmail, 5),
  ]);
  if (approval) {
    await updateRecordIfExists("pendingDealershipApprovals", approval.id, {
      status: "approved",
      approvalStatus: "approved",
      dealershipVerified: true,
      approvedAt: now,
      approvedBy,
    });
  }

  const queueItem = await firstAdminLookup([
    () => findRecordsByField("dealerApprovalQueue", "pendingDealershipApprovalId", approval?.id, 5),
    () => findRecordsByField("dealerApprovalQueue", "pendingDealerAccountId", pendingAccount?.id, 5),
    () => findRecordsByField("dealerApprovalQueue", "onboardingRequestId", request.id, 5),
    () => findRecordsByField("dealerApprovalQueue", "loginEmail", loginEmail, 5),
  ]);
  if (queueItem) {
    await updateRecordIfExists("dealerApprovalQueue", queueItem.id, {
      status: "approved",
      approvalStatus: "approved",
      approvedAt: now,
      approvedBy,
    });
  }

  return { loginEmail, dealership, pendingAccount, approval };
}

export async function deleteMatchingRecords(collection, matcher, indexedQueries = []) {
  if (indexedQueries.length) {
    const counts = await Promise.all(indexedQueries.map((where) => deleteRecordsByQuery(collection, { where }).catch(() => 0)));
    return counts.reduce((sum, count) => sum + count, 0);
  }
  const records = await listRecords(collection);
  const matches = records.filter(matcher);
  await Promise.all(matches.map((item) => deleteRecord(collection, item.id)));
  return matches.length;
}

export async function candidateRecordsByQueries(collection, directIds = [], indexedQueries = []) {
  const byId = new Map();
  await Promise.all(directIds.map(async (id) => {
    const record = await getRecord(collection, id).catch(() => null);
    if (record?.id) byId.set(record.id, record);
  }));
  await Promise.all(indexedQueries.map(async (where) => {
    const page = await queryRecords(collection, {
      where,
      orderBy: where[0]?.field || "createdAt",
      direction: "asc",
      limit: 100,
      maxLimit: 100,
    }).catch(() => ({ data: [] }));
    page.data.forEach((record) => {
      if (record?.id) byId.set(record.id, record);
    });
  }));
  return [...byId.values()];
}

export async function firebaseUidForEmail(email) {
  if (!firebaseAdmin || !email) return null;
  try {
    const firebaseUser = await firebaseAdmin.auth().getUserByEmail(email);
    return firebaseUser.uid;
  } catch (error) {
    if (error.code === "auth/user-not-found") return null;
    throw error;
  }
}

export async function deleteFirebaseAuthByEmail(email) {
  if (!firebaseAdmin || !email) return false;
  try {
    const firebaseUser = await firebaseAdmin.auth().getUserByEmail(email);
    await firebaseAdmin.auth().deleteUser(firebaseUser.uid);
    return true;
  } catch (error) {
    if (error.code === "auth/user-not-found") return false;
    throw error;
  }
}

export const ADMIN_SHARED_SENTINEL = true;
