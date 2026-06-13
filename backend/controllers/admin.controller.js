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
import { initializeDealershipTrial } from "../services/subscription.service.js";
import {
  registerBankBranchAdmin,
  approveBankBranchAdmin,
  rejectBankBranchAdmin,
  deactivateBankBranchAdmin,
  getAdminBankBranches,
  getBankBranchDetailsAdmin,
  updateBankBranchAdmin,
} from "./bank.admin.controller.js";

function leadDetailResponseFromProjection(projection = {}, extras = {}) {
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

function sameDate(value, target) {
  if (!target) return true;
  if (!value) return false;
  return new Date(value).toISOString().slice(0, 10) === target;
}

function leadText(lead) {
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

function sameText(left, right) {
  const cleanLeft = String(left || "").trim().toLowerCase();
  const cleanRight = String(right || "").trim().toLowerCase();
  return Boolean(cleanLeft && cleanRight && cleanLeft === cleanRight);
}

async function enrichAdminLeadRows(leads = []) {
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

function filterLeads(leads, query) {
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

async function approvalLog({ req, entityType, entityId, previousStatus, newStatus, rejectionReason = "" }) {
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

function today(value) {
  return String(value || "").startsWith(new Date().toISOString().slice(0, 10));
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function approvalStatusOf(record) {
  return String(record?.status || record?.approvalStatus || "pending").trim().toLowerCase();
}

function finalApprovalStatus(record) {
  return ["approved", "rejected", "suspended", "deleted", "disabled", "inactive"].includes(approvalStatusOf(record));
}

function pendingApprovalStatus(record) {
  if (record?.accountApproved === true || record?.approved === true) return false;
  return !finalApprovalStatus(record);
}

function ecosystemLimit(value, fallback = 5) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 10) : fallback;
}

async function boundedList(collection, limit, mapper = (item) => item, fields = []) {
  const rows = await listRecentRecords(collection, { limit, fields });
  return rows.map(mapper);
}

const APPROVAL_LIST_FIELDS = [
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
  "gstin",
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

const APPROVAL_LIST_PROJECTION_FIELDS = APPROVAL_LIST_FIELDS;

function clearAdminApprovalCaches() {
  clearCachedValue("admin:approvals:");
  clearCachedValue("admin:ecosystem:");
  clearCachedValue("admin:partners:");
}

function clearLeadMutationCaches(leadId) {
  clearCachedValue(`lead-detail:${leadId}:`);
  clearCachedValue(`timeline:lead:${leadId}:`);
  clearCachedValue("admin:");
  clearCachedValue("bank:");
  clearCachedValue("dealer:");
  clearCachedValue("finance:");
  clearCachedValue("gm:");
  clearCachedValue("lead-query:");
}

function safeAdminUser(user = {}) {
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

function safeLoginActivity(item = {}) {
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

function safeDocument(item = {}) {
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

async function firstAdminLookup(lookups = []) {
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

async function incrementPlatformCounters(increments = {}) {
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

function requestLoginEmail(request) {
  return normalizeEmail(request.loginEmail || request.primaryGoogleEmail || request.dealership?.loginEmail || request.financeDesk?.officialEmail || request.dealership?.officialDealershipEmail);
}

function dealerEventPayload({ loginEmail, dealership = {}, status = "updated" } = {}) {
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

function recordDealerSignal(tag, payload = {}) {
  recordMonitoringSignal(tag, {
    dealerId: payload.dealerId,
    dealerBrand: payload.dealerBrand,
    state: payload.dealerState,
    location: payload.dealerLocation,
    monthlySalesCapacity: payload.monthlySalesCapacity,
  });
}

function publishDealerEvent(eventType, req, payload = {}) {
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

function firestoreNotFound(error) {
  return error?.code === 5
    || error?.code === "not-found"
    || /not[-_ ]found|no document to update/i.test(String(error?.message || ""));
}

async function updateRecordIfExists(collection, id, payload) {
  if (!id) return null;
  const existing = await getRecord(collection, id).catch((error) => {
    if (firestoreNotFound(error)) return null;
    throw error;
  });
  if (!existing) return null;
  try {
    return await updateRecord(collection, existing.id, payload);
  } catch (error) {
    if (firestoreNotFound(error)) return null;
    throw error;
  }
}

function dealerIdentityProfile(dealership = {}, request = {}) {
  return {
    dealershipName: dealership.dealershipName || dealership.name || request.dealershipName || "",
    dealerName: dealership.dealerName || dealership.dealershipName || request.dealershipName || "",
    officialDealershipEmail: dealership.officialDealershipEmail || request.loginEmail || "",
    officialDealershipMobile: dealership.officialDealershipMobile || request.owner?.mobile || "",
    ownerName: request.owner?.fullName || dealership.ownerName || "",
    ownerMobile: request.owner?.mobile || dealership.ownerMobile || "",
    gstin: dealership.gstin || request.gstin || "",
    address: dealership.address || dealership.fullAddress || "",
    city: dealership.city || dealership.location || request.city || "",
    state: dealership.state || request.state || "",
    createdAt: dealership.createdAt || request.createdAt || request.submittedAt || new Date().toISOString(),
  };
}

async function materializeApprovedDealership({ request, loginEmail, dealership }) {
  const dealerLocation = dealership.dealerLocation || dealership.location || dealership.city || request.city || "";
  const dealerFields = {
    ...dealership,
    dealerId: loginEmail,
    dealerName: dealership.dealerName || dealership.dealershipName || request.dealershipName || "",
    dealerBrand: dealership.dealerBrand || dealership.dealershipBrand || request.dealershipBrand || "",
    dealerState: dealership.dealerState || dealership.state || request.state || "",
    dealerLocation,
    dealerStatus: "approved",
    monthlySalesCapacity: dealership.monthlySalesCapacity || dealership.monthlyCarSalesCapacity || "",
    location: dealerLocation,
  };
  await upsertRecord("dealerships", loginEmail, dealerFields);
  await upsertRecord("approvedDealerships", loginEmail, dealerFields);
  const financeUid = await firebaseUidForEmail(loginEmail);
  const financeCanonicalId = financeUid || loginEmail;
  await assertNoActiveIdentityCollision({ uid: financeCanonicalId, email: loginEmail, role: "finance-desk", excludeIds: [financeCanonicalId, loginEmail] });
  await upsertCanonicalUser(financeCanonicalId, {
    ...dealerIdentityProfile(dealerFields, request),
    uid: financeCanonicalId,
    email: loginEmail,
    officialEmail: dealerFields.officialDealershipEmail || loginEmail,
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
  });
  if (request.generalManager?.email) {
    const gmEmail = normalizeEmail(request.generalManager.email);
    const gmUid = await firebaseUidForEmail(gmEmail);
    const gmCanonicalId = gmUid || gmEmail;
    await assertNoActiveIdentityCollision({ uid: gmCanonicalId, email: gmEmail, role: "gm", excludeIds: [gmCanonicalId, gmEmail] });
    await upsertCanonicalUser(gmCanonicalId, {
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
    });
  }
  await upsertRecord("dealers", loginEmail, { ...dealerFields, role: "finance-desk", accountActive: true });
  await upsertRecord("dealershipManagers", `${loginEmail}:owner`, { dealershipEmail: loginEmail, role: "Owner", ...(request.owner || {}), status: "active", active: true });
  if (request.generalManager?.name || request.generalManager?.mobile || request.generalManager?.email) {
    await upsertRecord("dealershipManagers", `${loginEmail}:gm`, { dealershipEmail: loginEmail, role: "General Manager", fullName: request.generalManager?.name, mobile: request.generalManager?.mobile, email: request.generalManager?.email, status: "active", active: true });
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
  await upsertRecord("financeDesk", loginEmail, financeDeskPayload);
  await upsertRecord("financeDesks", loginEmail, financeDeskPayload);
  await upsertRecord("cityMappings", `dealer:${request.city}:${loginEmail}`, { type: "dealer", city: request.city, dealershipEmail: loginEmail, dealershipName: request.dealershipName, status: "approved", active: true });
}

async function approveDealershipBackrefs({ request, loginEmail, now, approvedBy }) {
  const updated = await updateRecordIfExists("pendingDealershipApprovals", request.id, {
    status: "approved",
    approvalStatus: "approved",
    gstinVerified: true,
    dealershipVerified: true,
    approvedAt: now,
    approvedBy,
  });
  if (request.onboardingRequestId) await updateRecordIfExists("onboardingRequests", request.onboardingRequestId, { status: "Approved", active: true, accountActive: true, approvedAt: now, approvedBy });
  const pendingAccountId = request.pendingDealerAccountId || request.pendingDealerRegistrationId;
  if (pendingAccountId) await updateRecordIfExists("pendingDealerAccounts", pendingAccountId, { registrationSubmitted: true, approvalStatus: "approved", accountApproved: true, accountActive: true, approvedAt: now, approvedBy });
  if (!pendingAccountId && loginEmail) {
    const pendingAccount = await firstAdminLookup([
      () => getRecord("pendingDealerAccounts", loginEmail),
      () => findRecordsByField("pendingDealerAccounts", "email", loginEmail, 5),
    ]);
    if (pendingAccount) await updateRecordIfExists("pendingDealerAccounts", pendingAccount.id, { registrationSubmitted: true, approvalStatus: "approved", accountApproved: true, accountActive: true, approvedAt: now, approvedBy });
  }
  const queueItem = await firstAdminLookup([
    () => findRecordsByField("dealerApprovalQueue", "pendingDealershipApprovalId", request.id, 5),
    () => findRecordsByField("dealerApprovalQueue", "pendingDealerAccountId", request.pendingDealerAccountId || request.pendingDealerRegistrationId, 5),
  ]);
  if (queueItem) await updateRecordIfExists("dealerApprovalQueue", queueItem.id, { status: "approved", approvalStatus: "approved", approvedAt: now, approvedBy });
  return updated;
}

async function materializeApprovedBank({ request, bankEmail, bankName, branchLocation, state, ifsc, branchId, partnerId, now, approvedBy }) {
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

async function activateApprovedBankUsers({ request, bankEmail, bankName, branchLocation, state, ifsc, partnerId }) {
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

async function approveBankBackrefs({ request, bankEmail, bankName, branchLocation, partnerId, now, approvedBy }) {
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

async function resolveDealershipApprovalRequest(id) {
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

async function activateDealerAccessFromRequest({ request, req, now }) {
  const loginEmail = requestLoginEmail(request);
  if (!loginEmail) return null;

  const approvedBy = req.user?.email || "super-admin";
  const dealership = {
    ...(request.dealership || {}),
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
    gstinVerified: true,
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
    officialEmail: dealership.officialDealershipEmail || loginEmail,
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
      gstinVerified: true,
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

async function deleteMatchingRecords(collection, matcher, indexedQueries = []) {
  if (indexedQueries.length) {
    const counts = await Promise.all(indexedQueries.map((where) => deleteRecordsByQuery(collection, { where }).catch(() => 0)));
    return counts.reduce((sum, count) => sum + count, 0);
  }
  const records = await listRecords(collection);
  const matches = records.filter(matcher);
  await Promise.all(matches.map((item) => deleteRecord(collection, item.id)));
  return matches.length;
}

async function candidateRecordsByQueries(collection, directIds = [], indexedQueries = []) {
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

async function firebaseUidForEmail(email) {
  if (!firebaseAdmin || !email) return null;
  try {
    const firebaseUser = await firebaseAdmin.auth().getUserByEmail(email);
    return firebaseUser.uid;
  } catch (error) {
    if (error.code === "auth/user-not-found") return null;
    throw error;
  }
}

async function deleteFirebaseAuthByEmail(email) {
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

export async function getAdminLeads(req, res, next) {
  const startedAt = Date.now();
  let queryStarted, queryEnded, enrichStarted, enrichEnded, serializeStarted, serializeEnded;
  try {
    queryStarted = Date.now();
    const page = await queryLeadProjectionForUser({ user: req.user, query: req.query }).catch(() => null)
      || await queryAllLeads({ query: req.query });
    queryEnded = Date.now();
    enrichStarted = Date.now();
    const response = { ...page, data: await enrichAdminLeadRows(page.data) };
    enrichEnded = Date.now();
    serializeStarted = Date.now();
    const responseJson = JSON.stringify(response);
    serializeEnded = Date.now();
    logInfo("Admin lead query completed", {
      requestId: req.requestId,
      path: req.originalUrl,
      role: req.user?.role,
      totalMs: Date.now() - startedAt,
      queryMs: queryEnded - queryStarted,
      enrichMs: enrichEnded - enrichStarted,
      serializeMs: serializeEnded - serializeStarted,
      warmup: String(req.headers["x-cls-warmup"] || "").toLowerCase() === "true",
      dataCount: Array.isArray(response?.data) ? response.data.length : undefined,
    });
    res.json(JSON.parse(responseJson));
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

export async function getAdminOnboardingRequests(req, res, next) {
  try {
    const requests = await listRecentRecords("onboardingRequests", { limit: req.query.limit || 100 });
    const status = String(req.query.status || "").trim();
    const search = String(req.query.search || "").trim().toLowerCase();
    const filtered = requests.filter((request) => {
      const matchesStatus = !status || request.status === status;
      const haystack = [
        request.id,
        request.dealershipName,
        request.dealershipBrand,
        request.loginEmail,
        request.city,
        request.status,
      ].filter(Boolean).join(" ").toLowerCase();
      return matchesStatus && (!search || haystack.includes(search));
    });
    res.json(filtered);
  } catch (error) {
    next(error);
  }
}

async function dealershipApprovalListPayload({ status, search, query }) {
  const page = await queryRecords("pendingDealershipApprovals", {
    ...(status ? { where: [{ field: "status", value: status }] } : {}),
    orderBy: "createdAt",
    direction: "desc",
    limit: query.limit || 100,
    maxLimit: 100,
    cursor: query.cursor || null,
    fields: APPROVAL_LIST_PROJECTION_FIELDS,
  });
  const requests = page.data.filter((item) => {
    const statusOk = !status || String(item.status || "").toLowerCase() === status;
    const typeOk = (item.accountType || item.type || "dealership") === "dealership";
    const text = [item.id, item.dealershipName, item.dealershipBrand, item.city, item.loginEmail, item.status, item.dealership?.gstin, item.dealership?.authorizedDealerCode].filter(Boolean).join(" ").toLowerCase();
    return typeOk && statusOk && (!search || text.includes(search));
  });
  const meta = await cached("admin:approvals:dealerships:meta", 30000, async () => {
    const [logsPage, dealershipCount] = await Promise.all([
      queryRecords("approvalLogs", {
        where: [{ field: "entityType", value: "dealership" }],
        orderBy: "createdAt",
        direction: "desc",
        limit: 100,
        maxLimit: 100,
        fields: ["id", "entityType", "newStatus", "createdAt", "approvedAt"],
      }),
      countRecords("dealerships"),
    ]);
    const logs = logsPage.data;
    return {
      approvedToday: logs.filter((item) => item.newStatus === "approved" && today(item.createdAt || item.approvedAt)).length,
      rejectedToday: logs.filter((item) => item.newStatus === "rejected" && today(item.createdAt)).length,
      activeDealerships: dealershipCount,
    };
  });
  return {
    data: requests,
    nextCursor: page.nextCursor,
    hasMore: Boolean(page.nextCursor),
    meta: {
      pending: requests.filter((item) => item.status === "pending").length,
      ...meta,
    },
  };
}

export async function getPendingDealershipApprovals(req, res, next) {
  try {
    const status = String(req.query.status || "pending").trim().toLowerCase();
    const search = String(req.query.search || "").trim().toLowerCase();
    const payload = await cached(`admin:approvals:dealerships:${JSON.stringify({ status, search, cursor: req.query.cursor || "", limit: req.query.limit || 100 })}`, 10000, () => dealershipApprovalListPayload({ status, search, query: req.query }));
    res.json(payload);
  } catch (error) {
    next(error);
  }
}

export async function getPendingBankApprovals(req, res, next) {
  try {
    const status = String(req.query.status || "pending").trim().toLowerCase();
    const search = String(req.query.search || "").trim().toLowerCase();
    const payload = await cached(`admin:approvals:banks:${JSON.stringify({ status, search, cursor: req.query.cursor || "", limit: req.query.limit || 100 })}`, 10000, async () => {
      const page = await queryRecords("pendingBankApprovals", {
        ...(status && status !== "pending" ? { where: [{ field: "status", value: status }] } : {}),
        orderBy: "updatedAt",
        direction: "desc",
        limit: req.query.limit || 100,
        maxLimit: 100,
        cursor: req.query.cursor || null,
        fields: APPROVAL_LIST_FIELDS,
      });
      const requests = page.data.filter((item) => {
        const itemStatus = approvalStatusOf(item);
        const statusOk = status === "pending" ? pendingApprovalStatus(item) : itemStatus === status;
        const typeOk = (item.accountType || item.type || "bank") === "bank";
        const text = [item.id, item.bankName, item.companyName, item.bankBranchLocation, item.branchLocation, item.ifsc, item.managerName, item.mobile, item.email, item.status].filter(Boolean).join(" ").toLowerCase();
        return typeOk && statusOk && (!search || text.includes(search));
      });
      return { data: requests, nextCursor: page.nextCursor, hasMore: Boolean(page.nextCursor) };
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
}

export async function getApprovalLogs(req, res, next) {
  try {
    const status = String(req.query.status || "").trim().toLowerCase();
    const entityType = String(req.query.entityType || "").trim().toLowerCase();
    const page = await queryRecords("approvalLogs", {
      ...(entityType ? { where: [{ field: "entityType", value: entityType }] } : {}),
      orderBy: "createdAt",
      direction: "desc",
      limit: req.query.limit || 100,
      maxLimit: 100,
    });
    const logs = page.data.filter((item) => {
      const statusOk = !status || String(item.newStatus || "").toLowerCase() === status;
      const typeOk = !entityType || String(item.entityType || "").toLowerCase() === entityType;
      return statusOk && typeOk;
    });
    res.json({ data: logs, nextCursor: page.nextCursor, hasMore: page.hasMore });
  } catch (error) {
    next(error);
  }
}

export async function approveDealershipApproval(req, res, next) {
  try {
    const request = await resolveDealershipApprovalRequest(req.params.id);
    if (!request) return res.status(404).json({ message: "Dealership approval request not found" });
    const requestStatus = String(request.status || request.approvalStatus || "pending").toLowerCase();
    if (requestStatus === "approved") return res.status(409).json({ message: "Dealership is already approved" });
    if (requestStatus !== "pending") return res.status(400).json({ message: "Application is not pending" });
    const now = new Date().toISOString();
    const loginEmail = requestLoginEmail(request);
    if (!loginEmail) return res.status(400).json({ message: "Dealership login email is missing" });
    const dealership = {
      ...(request.dealership || {}),
      loginEmail,
      primaryGoogleEmail: request.primaryGoogleEmail || loginEmail,
      status: "approved",
      active: true,
      approved: true,
      accountActive: true,
      verified: true,
      gstinVerified: true,
      dealershipVerified: true,
      approvedAt: now,
      approvedBy: req.user?.email || "super-admin",
      onboardingRequestId: request.onboardingRequestId || request.id,
    };
    const approvedBy = req.user?.email || "super-admin";
    await materializeApprovedDealership({ request, loginEmail, dealership });
    const subscription = await initializeDealershipTrial({
      dealershipId: loginEmail,
      dealership,
      approvedAt: now,
      actor: req.user,
    });
    const updated = await approveDealershipBackrefs({ request, loginEmail, now, approvedBy });
    await approvalLog({ req, entityType: "dealership", entityId: request.id, previousStatus: request.status, newStatus: "approved" });
    await incrementPlatformCounters({ activeDealerships: 1, approvedDealerships: 1, pendingDealerships: -1 });
    const dealerPayload = dealerEventPayload({ loginEmail, dealership, status: "approved" });
    recordDealerSignal("DEALER-APPROVED", dealerPayload);
    publishDealerEvent(REALTIME_EVENTS.DEALER_APPROVED, req, dealerPayload);
    await createNotification({ type: "dealership-approved", title: "Dealership approved", message: `${request.dealershipName} approved. Login access is active.`, recipientRole: "finance-desk", recipientId: loginEmail, dealerEmail: loginEmail, phoneNumber: request.dealership?.officialDealershipMobile || request.owner?.mobile, meta: { dealershipName: request.dealershipName } });
    await writeAuditLog({ req, actionType: "DEALERSHIP_APPROVED", oldValue: request.status, newValue: "approved", meta: { approvalId: request.id, loginEmail } });
    clearAdminApprovalCaches();
    res.json({
      message: "Dealership approved",
      subscription,
      request: updated || { ...request, status: "approved", approvalStatus: "approved", approvedAt: now },
    });
  } catch (error) {
    next(error);
  }
}

export async function rejectDealershipApproval(req, res, next) {
  try {
    const reason = String(req.body.reason || "").trim();
    if (!reason) return res.status(400).json({ message: "Rejection reason is required" });
    const request = await resolveDealershipApprovalRequest(req.params.id);
    if (!request) return res.status(404).json({ message: "Dealership approval request not found" });
    const now = new Date().toISOString();
    const updated = await updateRecordIfExists("pendingDealershipApprovals", request.id, { status: "rejected", rejectedAt: now, rejectedBy: req.user?.email || "super-admin", rejectionReason: reason });
    if (request.onboardingRequestId) await updateRecordIfExists("onboardingRequests", request.onboardingRequestId, { status: "Rejected", active: false, rejectionReason: reason });
    if (request.pendingDealerAccountId || request.pendingDealerRegistrationId) await updateRecordIfExists("pendingDealerAccounts", request.pendingDealerAccountId || request.pendingDealerRegistrationId, { registrationSubmitted: true, approvalStatus: "rejected", accountApproved: false, accountActive: false, rejectionReason: reason, rejectedAt: now, rejectedBy: req.user?.email || "super-admin" });
    const queueItem = await firstAdminLookup([
      () => findRecordsByField("dealerApprovalQueue", "pendingDealershipApprovalId", request.id, 5),
      () => findRecordsByField("dealerApprovalQueue", "pendingDealerAccountId", request.pendingDealerAccountId || request.pendingDealerRegistrationId, 5),
    ]);
    if (queueItem) await updateRecordIfExists("dealerApprovalQueue", queueItem.id, { status: "rejected", approvalStatus: "rejected", rejectionReason: reason, rejectedAt: now, rejectedBy: req.user?.email || "super-admin" });
    await approvalLog({ req, entityType: "dealership", entityId: request.id, previousStatus: request.status, newStatus: "rejected", rejectionReason: reason });
    await incrementPlatformCounters({ pendingDealerships: -1 });
    await createNotification({ type: "dealership-rejected", title: "Dealership rejected", message: reason, recipientRole: "finance-desk", recipientId: request.loginEmail, dealerEmail: request.loginEmail, phoneNumber: request.dealership?.officialDealershipMobile || request.owner?.mobile, priority: "high", meta: { dealershipName: request.dealershipName, reason } });
    await writeAuditLog({ req, actionType: "DEALERSHIP_REJECTED", oldValue: request.status, newValue: "rejected", meta: { approvalId: request.id, reason } });
    clearAdminApprovalCaches();
    res.json({ message: "Dealership rejected", request: updated || { ...request, status: "rejected", rejectionReason: reason, rejectedAt: now } });
  } catch (error) {
    next(error);
  }
}

export async function suspendDealershipApproval(req, res, next) {
  try {
    const reason = String(req.body.reason || "Suspended by Super Admin").trim();
    const request = await resolveDealershipApprovalRequest(req.params.id);
    if (!request) return res.status(404).json({ message: "Dealership approval request not found" });
    const loginEmail = requestLoginEmail(request);
    const now = new Date().toISOString();

    const updated = await updateRecordIfExists("pendingDealershipApprovals", request.id, {
      status: "suspended",
      approvalStatus: "suspended",
      suspensionReason: reason,
      suspendedAt: now,
      suspendedBy: req.user?.email || "super-admin",
    });

    if (loginEmail) {
      await upsertRecord("dealerships", loginEmail, { status: "suspended", active: false, approved: true, accountActive: false, suspensionReason: reason, suspendedAt: now });
      await upsertRecord("dealers", loginEmail, { status: "suspended", active: false, accountActive: false, suspensionReason: reason, suspendedAt: now });
      await upsertRecord("users", loginEmail, { uid: loginEmail, email: loginEmail, role: "finance-desk", approved: true, active: false, accountActive: false, dealershipId: loginEmail, status: "suspended" });
    }
    if (request.generalManager?.email) {
      await upsertRecord("users", request.generalManager.email, { uid: request.generalManager.email, email: request.generalManager.email, role: "gm", approved: true, active: false, accountActive: false, dealershipId: loginEmail, status: "suspended" });
    }
    if (request.onboardingRequestId) await updateRecordIfExists("onboardingRequests", request.onboardingRequestId, { status: "Suspended", active: false, accountActive: false, suspensionReason: reason });
    const pendingAccountId = request.pendingDealerAccountId || request.pendingDealerRegistrationId;
    if (pendingAccountId) await updateRecordIfExists("pendingDealerAccounts", pendingAccountId, { approvalStatus: "suspended", accountApproved: false, accountActive: false, suspensionReason: reason, suspendedAt: now, suspendedBy: req.user?.email || "super-admin" });
    const queueItem = await firstAdminLookup([
      () => findRecordsByField("dealerApprovalQueue", "pendingDealershipApprovalId", request.id, 5),
      () => findRecordsByField("dealerApprovalQueue", "pendingDealerAccountId", pendingAccountId, 5),
    ]);
    if (queueItem) await updateRecordIfExists("dealerApprovalQueue", queueItem.id, { status: "suspended", approvalStatus: "suspended", suspensionReason: reason, suspendedAt: now, suspendedBy: req.user?.email || "super-admin" });
    await approvalLog({ req, entityType: "dealership", entityId: request.id, previousStatus: request.status, newStatus: "suspended", rejectionReason: reason });
    await incrementPlatformCounters({ activeDealerships: -1, disabledDealerships: 1 });
    const dealerPayload = dealerEventPayload({ loginEmail, dealership: request.dealership || request, status: "disabled" });
    recordDealerSignal("DEALER-DISABLED", dealerPayload);
    publishDealerEvent(REALTIME_EVENTS.DEALER_DISABLED, req, dealerPayload);
    await writeAuditLog({ req, actionType: "DEALERSHIP_SUSPENDED", oldValue: request.status, newValue: "suspended", meta: { approvalId: request.id, reason } });
    clearAdminApprovalCaches();
    res.json({ message: "Dealership suspended", request: updated || { ...request, status: "suspended", suspensionReason: reason, suspendedAt: now } });
  } catch (error) {
    next(error);
  }
}

export async function deleteDealershipPermanently(req, res, next) {
  try {
    const id = String(req.params.id || "").trim();
    const [onboardingRequest, pendingCandidates] = await Promise.all([
      getRecord("onboardingRequests", id).catch(() => null),
      candidateRecordsByQueries("pendingDealershipApprovals", [id], [[{ field: "onboardingRequestId", value: id }]]),
    ]);
    const approvalRequest = pendingCandidates.find((item) => item.id === id || item.onboardingRequestId === id);
    const request = onboardingRequest || approvalRequest || await getRecord("dealerships", id) || await getRecord("approvedDealerships", id);
    if (!request) return res.status(404).json({ message: "Dealership record not found" });

    const loginEmail = requestLoginEmail(request) || normalizeEmail(id);
    const gmEmail = normalizeEmail(request.generalManager?.email);
    const ownerEmail = normalizeEmail(request.owner?.email);
    const financeEmail = normalizeEmail(request.financeDesk?.officialEmail);
    const emails = new Set([loginEmail, gmEmail, ownerEmail, financeEmail].filter(Boolean));
    const now = new Date().toISOString();
    const deleted = {};
    const matchesDealer = (item) => {
      const values = [
        item.id,
        item.email,
        item.uid,
        item.loginEmail,
        item.primaryGoogleEmail,
        item.dealerEmail,
        item.dealershipEmail,
        item.officialEmail,
        item.officialDealershipEmail,
        item.createdBy,
        item.dealershipId,
        item.pendingDealerAccountId,
        item.pendingDealerRegistrationId,
        item.pendingDealershipApprovalId,
        item.approvalRequestId,
        item.onboardingRequestId,
      ].map(normalizeEmail);
      return values.some((value) => emails.has(value) || value === id || value === onboardingRequest?.id || value === approvalRequest?.id);
    };

    const directIds = [
      ["onboardingRequests", onboardingRequest?.id || id],
      ["pendingDealershipApprovals", approvalRequest?.id],
      ["dealerships", loginEmail],
      ["approvedDealerships", loginEmail],
      ["dealers", loginEmail],
      ["users", loginEmail],
      ["users", gmEmail],
      ["financeDesk", loginEmail],
      ["financeDesks", loginEmail],
      ["dealershipManagers", `${loginEmail}:owner`],
      ["dealershipManagers", `${loginEmail}:gm`],
      ["dealerRegistrations", loginEmail],
    ].filter(([, docId]) => docId);

    for (const [collection, docId] of directIds) {
      await deleteRecord(collection, docId);
      deleted[collection] = (deleted[collection] || 0) + 1;
    }

    const indexedDealerQueries = [
      ...[...emails].flatMap((email) => [
        [{ field: "email", value: email }],
        [{ field: "uid", value: email }],
        [{ field: "loginEmail", value: email }],
        [{ field: "primaryGoogleEmail", value: email }],
        [{ field: "dealerEmail", value: email }],
        [{ field: "dealershipEmail", value: email }],
        [{ field: "officialEmail", value: email }],
        [{ field: "officialDealershipEmail", value: email }],
        [{ field: "createdBy", value: email }],
        [{ field: "dealershipId", value: email }],
      ]),
      onboardingRequest?.id ? [{ field: "onboardingRequestId", value: onboardingRequest.id }] : null,
      approvalRequest?.id ? [{ field: "pendingDealershipApprovalId", value: approvalRequest.id }] : null,
      approvalRequest?.id ? [{ field: "approvalRequestId", value: approvalRequest.id }] : null,
      id ? [{ field: "pendingDealerAccountId", value: id }] : null,
      id ? [{ field: "pendingDealerRegistrationId", value: id }] : null,
    ].filter(Boolean);

    for (const collection of [
      "pendingDealerAccounts",
      "pendingGoogleAccounts",
      "dealerApprovalQueue",
      "dealerRegistrations",
      "dealerRegistrationDocuments",
      "dealerDocuments",
      "dealershipManagers",
      "financeDesk",
      "financeDesks",
      "users",
      "notifications",
      "cityMappings",
    ]) {
      deleted[collection] = (deleted[collection] || 0) + await deleteMatchingRecords(collection, matchesDealer, indexedDealerQueries);
    }

    const authDeleted = {};
    for (const email of emails) {
      await revokeUserSessions(email, "dealership-permanent-delete").catch(() => {});
      authDeleted[email] = await deleteFirebaseAuthByEmail(email);
    }

    await approvalLog({ req, entityType: "dealership", entityId: id, previousStatus: request.status || "unknown", newStatus: "deleted", rejectionReason: "Permanently deleted by Super Admin" });
    await incrementPlatformCounters({ activeDealerships: -1, disabledDealerships: 1 });
    const dealerPayload = dealerEventPayload({ loginEmail, dealership: request.dealership || request, status: "deleted" });
    recordDealerSignal("DEALER-DISABLED", dealerPayload);
    publishDealerEvent(REALTIME_EVENTS.DEALER_DISABLED, req, dealerPayload);
    await writeAuditLog({ req, actionType: "DEALERSHIP_DELETED_PERMANENTLY", oldValue: request.status || "", newValue: "deleted", meta: { id, loginEmail, deleted, authDeleted, deletedAt: now } });
    clearAdminApprovalCaches();
    res.json({ message: "Dealership permanently deleted", id, loginEmail, deleted, authDeleted });
  } catch (error) {
    next(error);
  }
}

export async function approveBankApproval(req, res, next) {
  try {
    const request = await getRecord("pendingBankApprovals", req.params.id);
    if (!request) return res.status(404).json({ message: "Bank approval request not found" });
    const requestStatus = approvalStatusOf(request);
    if (requestStatus === "approved") return res.status(409).json({ message: "Bank branch is already approved" });
    if (!pendingApprovalStatus(request)) return res.status(400).json({ message: "Application is not pending" });
    const now = new Date().toISOString();
    const bankEmail = normalizeEmail(request.email || request.officialEmail || request.primaryGoogleEmail || request.managerEmail);
    if (!bankEmail) return res.status(400).json({ message: "Bank manager email is missing on this approval request" });
    const bankName = String(request.bankName || request.companyName || request.name || "Bank Branch").trim();
    const branchLocationInput = String(request.bankBranchLocation || request.branchLocation || request.branchName || request.city || "").trim();
    const ifsc = normalizeIfsc(request.branchIfsc || request.ifsc || request.ifscCode || request.bankIfsc);
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return res.status(400).json({ message: "Valid IFSC code is required before bank approval" });
    const location = validateBankLocation({ state: request.state || "Haryana", location: branchLocationInput });
    if (!location.valid) return res.status(400).json({ message: "Supported state and bank branch location are required before approval" });
    const existingBranch = await getRecord("branches", ifsc).catch(() => null)
      || await getRecord("banks", ifsc).catch(() => null)
      || await getRecord("bankPartners", ifsc).catch(() => null);
    if (existingBranch && String(existingBranch.id || existingBranch.bankId || "") !== ifsc) {
      return res.status(409).json({ message: "This IFSC is already registered to another branch.", code: "DUPLICATE_IFSC" });
    }
    const branchLocation = location.location;
    const branchId = ifsc || `${bankEmail}:${branchLocation}`;
    const partnerId = branchId;
    const approvedBy = req.user?.email || "super-admin";
    await materializeApprovedBank({ request, bankEmail, bankName, branchLocation, state: location.state, ifsc, branchId, partnerId, now, approvedBy });
    await activateApprovedBankUsers({ request, bankEmail, bankName, branchLocation, state: location.state, ifsc, partnerId });
    const updated = await approveBankBackrefs({ request, bankEmail, bankName, branchLocation, partnerId, now, approvedBy });
    await approvalLog({ req, entityType: "bank", entityId: request.id, previousStatus: request.status, newStatus: "approved" });
    await incrementPlatformCounters({ bankPartners: 1, activeBanks: 1, totalBranches: 1 });
    recordMonitoringSignal("BRANCH-CREATED", {
      collection: "branches",
      projectionId: ifsc,
      bankId: partnerId,
      branchId: ifsc,
      state: location.state,
      location: branchLocation,
      capacityRange: request.monthlyLoanCapacity || null,
    });
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.BRANCH_CREATED,
      actor: req.user,
      data: {
        publicCatalog: true,
        bankEvent: {
          bankId: partnerId,
          bankName,
          branchIfsc: ifsc,
          branchLocation,
          state: location.state,
          status: "active",
        },
        bankId: partnerId,
        branchId: ifsc,
        ifscCode: ifsc,
      },
    });
    await createNotification({ type: "bank-approved", title: "Bank branch approved", message: `${bankName} ${branchLocation} branch approved. Login access is active.`, recipientRole: "bank-manager", recipientId: bankEmail, partnerId: partnerId, phoneNumber: request.mobile, meta: { bankName, city: branchLocation, bankBranchLocation: branchLocation } });
    await writeAuditLog({ req, actionType: "BANK_APPROVED", oldValue: request.status, newValue: "approved", meta: { approvalId: request.id, bankId: partnerId } });
    clearAdminApprovalCaches();
    res.json({ message: "Bank approved", request: updated || { ...request, status: "approved", approvedAt: now } });
  } catch (error) {
    next(error);
  }
}

export async function rejectBankApproval(req, res, next) {
  try {
    const reason = String(req.body.reason || "").trim();
    if (!reason) return res.status(400).json({ message: "Rejection reason is required" });
    const request = await getRecord("pendingBankApprovals", req.params.id);
    if (!request) return res.status(404).json({ message: "Bank approval request not found" });
    const bankEmail = normalizeEmail(request.email || request.officialEmail || request.primaryGoogleEmail || request.managerEmail);
    const now = new Date().toISOString();
    const updated = await updateRecordIfExists("pendingBankApprovals", request.id, { status: "rejected", rejectedAt: now, rejectedBy: req.user?.email || "super-admin", rejectionReason: reason });
    const pendingBankAccount = await firstAdminLookup([
      () => getRecord("pendingBankAccounts", bankEmail),
      () => findRecordsByField("pendingBankAccounts", "email", bankEmail, 5),
      () => findRecordsByField("pendingBankAccounts", "approvalRequestId", request.id, 5),
    ]);
    if (pendingBankAccount) await updateRecordIfExists("pendingBankAccounts", pendingBankAccount.id, { approvalStatus: "rejected", accountApproved: false, accountActive: false, rejectionReason: reason, rejectedAt: now, rejectedBy: req.user?.email || "super-admin" });
    await approvalLog({ req, entityType: "bank", entityId: request.id, previousStatus: request.status, newStatus: "rejected", rejectionReason: reason });
    await createNotification({ type: "bank-rejected", title: "Bank branch rejected", message: reason, recipientRole: "bank-manager", recipientId: bankEmail, partnerId: bankEmail, phoneNumber: request.mobile, priority: "high", meta: { bankName: request.bankName || request.companyName, reason } });
    await writeAuditLog({ req, actionType: "BANK_REJECTED", oldValue: request.status, newValue: "rejected", meta: { approvalId: request.id, reason } });
    clearAdminApprovalCaches();
    res.json({ message: "Bank rejected", request: updated || { ...request, status: "rejected", rejectedAt: now, rejectionReason: reason } });
  } catch (error) {
    next(error);
  }
}

export async function suspendBankApproval(req, res, next) {
  try {
    const reason = String(req.body.reason || "Suspended by Super Admin").trim();
    const request = await getRecord("pendingBankApprovals", req.params.id);
    if (!request) return res.status(404).json({ message: "Bank approval request not found" });
    const now = new Date().toISOString();
    const bankId = normalizeIfsc(request.branchIfsc || request.ifsc || request.ifscCode || request.bankIfsc) || request.email;
    const bankEmail = normalizeEmail(request.email || request.officialEmail || request.primaryGoogleEmail || request.managerEmail);
    const updated = await updateRecordIfExists("pendingBankApprovals", request.id, {
      status: "suspended",
      approvalStatus: "suspended",
      suspensionReason: reason,
      suspendedAt: now,
      suspendedBy: req.user?.email || "super-admin",
    });
    if (bankId) {
      await upsertRecord("bankPartners", bankId, { status: "suspended", active: false, accountActive: false, suspensionReason: reason, suspendedAt: now });
      await upsertRecord("banks", bankId, { status: "suspended", active: false, approvalStatus: "suspended", suspensionReason: reason, suspendedAt: now });
      await upsertRecord("branches", bankId, { status: "suspended", active: false, publicStatus: "suspended", suspensionReason: reason, suspendedAt: now });
      if (bankEmail) {
        await upsertRecord("branchManagers", bankEmail, { email: bankEmail, bankId, branchId: bankId, status: "suspended", active: false, accountActive: false, suspensionReason: reason, suspendedAt: now });
        await upsertRecord("users", bankEmail, { uid: bankEmail, email: bankEmail, role: "bank-manager", approved: true, active: false, accountActive: false, bankId, branchId: bankId, status: "suspended" });
      }
    }
    const pendingBankAccount = await firstAdminLookup([
      () => getRecord("pendingBankAccounts", request.email),
      () => findRecordsByField("pendingBankAccounts", "email", request.email, 5),
      () => findRecordsByField("pendingBankAccounts", "approvalRequestId", request.id, 5),
    ]);
    if (pendingBankAccount) await updateRecordIfExists("pendingBankAccounts", pendingBankAccount.id, { approvalStatus: "suspended", accountApproved: false, accountActive: false, suspensionReason: reason, suspendedAt: now, suspendedBy: req.user?.email || "super-admin" });
    await approvalLog({ req, entityType: "bank", entityId: request.id, previousStatus: request.status, newStatus: "suspended", rejectionReason: reason });
    await incrementPlatformCounters({ bankPartners: -1, activeBanks: -1, disabledBranches: 1 });
    recordMonitoringSignal("BRANCH-DISABLED", {
      collection: "branches",
      projectionId: bankId,
      bankId,
      branchId: bankId,
      state: request.state || "",
      location: request.bankBranchLocation || request.branchLocation || "",
    });
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.BRANCH_DISABLED,
      actor: req.user,
      data: {
        publicCatalog: true,
        bankEvent: {
          bankId,
          bankName: request.bankName || request.companyName || "",
          branchIfsc: bankId,
          branchLocation: request.bankBranchLocation || request.branchLocation || "",
          state: request.state || "",
          status: "suspended",
        },
        bankId,
        branchId: bankId,
        ifscCode: bankId,
      },
    });
    await writeAuditLog({ req, actionType: "BANK_SUSPENDED", oldValue: request.status, newValue: "suspended", meta: { approvalId: request.id, reason } });
    clearAdminApprovalCaches();
    res.json({ message: "Bank suspended", request: updated || { ...request, status: "suspended", suspendedAt: now, suspensionReason: reason } });
  } catch (error) {
    next(error);
  }
}

export async function deleteBankPermanently(req, res, next) {
  try {
    const id = String(req.params.id || "").trim();
    const request = await getRecord("pendingBankApprovals", id).catch(() => null)
      || await getRecord("bankPartners", id).catch(() => null)
      || await getRecord("banks", id).catch(() => null);
    if (!request) return res.status(404).json({ message: "Bank record not found" });

    const bankEmail = normalizeEmail(request.email || request.officialEmail || id);
    const bankName = String(request.bankName || request.companyName || request.name || "").trim().toLowerCase();
    const ifsc = String(request.ifsc || request.ifscCode || "").trim().toLowerCase();
    const deleted = {};
    const authEmails = new Set([bankEmail].filter(Boolean));
    const matchesBank = (item) => {
      const values = [
        item.id,
        item.email,
        item.officialEmail,
        item.managerEmail,
        item.bankId,
        item.branchManagerId,
        item.approvalRequestId,
      ].map(normalizeEmail);
      const names = [item.bankName, item.companyName, item.name].map((value) => String(value || "").trim().toLowerCase());
      const ifscValues = [item.ifsc, item.ifscCode].map((value) => String(value || "").trim().toLowerCase());
      return (bankEmail && values.includes(bankEmail)) || (bankName && names.includes(bankName)) || (ifsc && ifscValues.includes(ifsc));
    };

    const indexedBankQueries = [
      bankEmail ? [{ field: "email", value: bankEmail }] : null,
      bankEmail ? [{ field: "officialEmail", value: bankEmail }] : null,
      bankEmail ? [{ field: "managerEmail", value: bankEmail }] : null,
      bankEmail ? [{ field: "branchManagerId", value: bankEmail }] : null,
      id ? [{ field: "approvalRequestId", value: id }] : null,
      ifsc ? [{ field: "ifsc", value: ifsc.toUpperCase() }] : null,
      ifsc ? [{ field: "ifscCode", value: ifsc.toUpperCase() }] : null,
      bankName ? [{ field: "bankName", value: request.bankName || request.companyName || request.name }] : null,
      bankName ? [{ field: "companyName", value: request.bankName || request.companyName || request.name }] : null,
      bankName ? [{ field: "name", value: request.bankName || request.companyName || request.name }] : null,
      id ? [{ field: "bankId", value: id }] : null,
      id ? [{ field: "bankPartnerId", value: id }] : null,
    ].filter(Boolean);

    for (const collection of ["pendingBankApprovals", "pendingBankAccounts", "bankPartners", "banks", "branches", "branchManagers", "loanExecutives", "users", "dealershipBankTieUps"]) {
      const records = await candidateRecordsByQueries(collection, [id, bankEmail, ifsc].filter(Boolean), indexedBankQueries);
      const matches = records.filter(matchesBank);
      for (const record of matches) {
        const email = normalizeEmail(record.email || record.officialEmail || record.managerEmail || record.id);
        if (email && email.includes("@")) authEmails.add(email);
      }
      for (const record of matches) {
        await deleteRecord(collection, record.id);
      }
      deleted[collection] = matches.length;
    }

    const authDeleted = {};
    for (const email of authEmails) {
      await revokeUserSessions(email, "bank-permanent-delete").catch(() => {});
      authDeleted[email] = await deleteFirebaseAuthByEmail(email);
    }

    await writeAuditLog({ req, actionType: "BANK_DELETED", oldValue: request.status, newValue: "deleted", meta: { bankEmail, bankName, ifsc, deleted, authDeleted } });
    await incrementPlatformCounters({ bankPartners: -1, activeBanks: -1 });
    clearAdminApprovalCaches();
    res.json({ message: "Bank permanently deleted", deleted, authDeleted });
  } catch (error) {
    next(error);
  }
}

export async function updateAdminOnboardingRequest(req, res, next) {
  try {
    const request = await getRecord("onboardingRequests", req.params.id);
    if (!request) return res.status(404).json({ message: "Onboarding request not found" });

    const status = String(req.body.status || "").trim();
    if (!["Approved", "Rejected", "Pending Approval", "Additional Documents Requested"].includes(status)) {
      return res.status(400).json({ message: "Invalid onboarding status" });
    }

    const now = new Date().toISOString();
    const updated = await updateRecord("onboardingRequests", request.id, {
      status,
      reviewedAt: now,
      reviewedBy: req.user?.email || "super-admin",
      adminRemarks: String(req.body.adminRemarks || "").trim(),
    });

    const loginEmail = requestLoginEmail(request);
    const active = status === "Approved";
    if (loginEmail) {
      await upsertRecord("dealerships", loginEmail, {
        ...(request.dealership || {}),
        onboardingRequestId: request.id,
        loginEmail,
        status,
        active,
        approvedAt: active ? now : null,
        approvedBy: active ? req.user?.email || "super-admin" : null,
      });
      await upsertRecord("dealers", loginEmail, {
        ...(request.dealership || {}),
        onboardingRequestId: request.id,
        loginEmail,
        role: "finance-desk",
        status,
        active,
        approvedAt: active ? now : null,
        approvedBy: active ? req.user?.email || "super-admin" : null,
      });
      if (request.city) {
        await upsertRecord("cityMappings", `dealer:${request.city}:${loginEmail}`, {
          type: "dealer",
          city: request.city,
          dealershipEmail: loginEmail,
          dealershipName: request.dealershipName,
          status,
          active,
        });
      }
    }

    if (active) {
      await activateDealerAccessFromRequest({ request, req, now });
      if (loginEmail) {
        await initializeDealershipTrial({
          dealershipId: loginEmail,
          dealership: { ...(request.dealership || {}), loginEmail, dealershipName: request.dealershipName },
          approvedAt: now,
          actor: req.user,
        });
      }
    } else if (status === "Rejected") {
      const pendingAccount = await firstAdminLookup([
        () => loginEmail ? getRecord("pendingDealerAccounts", loginEmail) : null,
        () => loginEmail ? findRecordsByField("pendingDealerAccounts", "email", loginEmail, 5) : [],
        () => findRecordsByField("pendingDealerAccounts", "onboardingRequestId", request.id, 5),
        () => request.approvalRequestId ? findRecordsByField("pendingDealerAccounts", "approvalRequestId", request.approvalRequestId, 5) : [],
      ]);
      if (pendingAccount) {
        await updateRecord("pendingDealerAccounts", pendingAccount.id, {
          approvalStatus: "rejected",
          accountApproved: false,
          accountActive: false,
          rejectionReason: String(req.body.adminRemarks || "Rejected by Super Admin").trim(),
          rejectedAt: now,
          rejectedBy: req.user?.email || "super-admin",
        });
      }
    }

    await createNotification({
      type: active ? "dealer-approved" : status === "Rejected" ? "dealer-rejected" : "dealer-onboarding-update",
      title: `Dealer onboarding ${status}`,
      message: `${request.dealershipName || loginEmail} onboarding marked ${status}`,
      recipientRole: "finance-desk",
      recipientId: loginEmail,
      dealerEmail: loginEmail,
      admin: true,
      meta: { onboardingRequestId: request.id, dealershipName: request.dealershipName, status },
    });
    await writeAuditLog({ req, actionType: "DEALER_ONBOARDING_STATUS", oldValue: request.status, newValue: status, meta: { onboardingRequestId: request.id, loginEmail } });

    clearAdminApprovalCaches();
    res.json({ message: `Onboarding request ${status}`, request: updated });
  } catch (error) {
    next(error);
  }
}

async function applyAdminLeadStatusSideEffects({ req, existing, lead, status }) {
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

export async function updateAdminWorkflowSettings(req, res, next) {
  try {
    const settings = await updateWorkflowSettings(req.body);
    await writeAuditLog({ req, actionType: "SETTINGS_UPDATE", newValue: req.body });
    res.json({ message: "Workflow settings updated", settings });
  } catch (error) {
    next(error);
  }
}

export async function getAdminWorkflowSettings(_req, res, next) {
  try {
    res.json(await getWorkflowSettings());
  } catch (error) {
    next(error);
  }
}

export async function freezeAdminPartner(req, res, next) {
  try {
    const partner = await freezePartner(req.params.partnerId, Boolean(req.body.frozen));
    await writeAuditLog({ req, actionType: Boolean(req.body.frozen) ? "PARTNER_FREEZE" : "PARTNER_UNFREEZE", newValue: req.body, meta: { partnerId: req.params.partnerId } });
    res.json({ message: Boolean(req.body.frozen) ? "Partner frozen" : "Partner unfrozen", partner });
  } catch (error) {
    next(error);
  }
}

export async function getAdminWorkflowLogs(req, res, next) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const logType = String(req.query.logType || "").trim();
    const search = String(req.query.search || "").trim();
    const legacyFallback = String(req.query.legacyFallback || req.query.includeLegacyFallback || "").toLowerCase() === "true"
      || String(process.env.ALLOW_WORKFLOW_LOG_FALLBACK || "").toLowerCase() === "true";
    const where = logType ? [{ field: "logType", value: logType }] : [];
    const cacheKey = `admin:workflow-logs:${JSON.stringify({
      limit,
      cursor: req.query.cursor || "",
      logType,
      search,
      legacyFallback,
    })}`;
    const payload = await cached(cacheKey, 15000, async () => {
      const page = await queryRecords("workflowLogViews", {
        where,
        orderBy: "timestamp",
        direction: "desc",
        limit,
        maxLimit: 100,
        cursor: req.query.cursor || null,
        search,
        searchFields: ["title", "summary", "actorEmail", "leadId", "caseId", "entityId", "status", "action"],
        fields: ["id", "sourceId", "sourceCollection", "logType", "timestamp", "createdAt", "updatedAt", "leadId", "caseId", "entityId", "actorEmail", "actorName", "status", "action", "title", "summary"],
      });
      let rows = page.data || [];
      if (legacyFallback && !rows.length && !logType && !search && !req.query.cursor) {
        const fallbackLimit = Math.min(limit, 25);
        const [assignments, reassignmentLogs, payouts, commissions, notifications, settings] = await Promise.all([
          listRecentRecords("leadAssignments", { limit: fallbackLimit }),
          listRecentRecords("reassignmentLogs", { limit: fallbackLimit }),
          listRecentRecords("payouts", { limit: fallbackLimit }),
          listRecentRecords("commissions", { limit: fallbackLimit }),
          listRecentRecords("notifications", { limit: fallbackLimit }),
          listRecentRecords("settings", { limit: fallbackLimit }),
        ]);
        rows = [
          ...assignments.map((item) => ({ ...item, logType: "leadAssignments" })),
          ...reassignmentLogs.map((item) => ({ ...item, logType: "reassignmentLogs" })),
          ...payouts.map((item) => ({ ...item, logType: "payouts" })),
          ...commissions.map((item) => ({ ...item, logType: "commissions" })),
          ...notifications.map((item) => ({ ...item, logType: "notifications" })),
          ...settings.map((item) => ({ ...item, logType: "settings" })),
        ]
          .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))
          .slice(0, limit);
      }
      const grouped = {
        assignments: rows.filter((item) => item.logType === "leadAssignments"),
        reassignmentLogs: rows.filter((item) => item.logType === "reassignmentLogs"),
        payouts: rows.filter((item) => item.logType === "payouts"),
        commissions: rows.filter((item) => item.logType === "commissions"),
        notifications: rows.filter((item) => item.logType === "notifications"),
        settings: rows.filter((item) => item.logType === "settings"),
      };
      return {
        ...grouped,
        data: rows,
        pagination: {
          limit: page.limit,
          nextCursor: page.nextCursor,
          hasMore: Boolean(page.nextCursor),
        },
      };
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
}

export async function getAdminAuditLogs(req, res, next) {
  try {
    res.json(await cached(`admin:audit:${JSON.stringify(req.query || {})}`, 15000, () => getAuditLogs({ ...req.query, limit: Math.min(Number(req.query.limit || 20), 20) })));
  } catch (error) {
    next(error);
  }
}

export async function getAdminPartners(_req, res, next) {
  try {
    res.json(await cached("admin:partners:v2", 30000, () => listRecentRecords("bankPartners", {
      limit: 100,
      fields: ["id", "bankId", "bankPartnerId", "bankName", "companyName", "email", "ifsc", "ifscCode", "status", "active", "frozen", "createdAt", "updatedAt"],
    })));
  } catch (error) {
    next(error);
  }
}

export async function getAdminAnalytics(_req, res, next) {
  try {
    const metrics = await cached("admin:analytics", 15000, () => computeLeadMetrics());
    res.json({
      totalLeads: metrics.totalLeads,
      approvedLeads: metrics.approved,
      rejectedLeads: metrics.rejected,
      monthlyLeads: metrics.totalLeads,
      metrics,
    });
  } catch (error) {
    next(error);
  }
}

async function adminEcosystemPayload(req) {
    const limit = ecosystemLimit(req.query.ecosystemLimit);
    const leadLimit = Math.min(Math.max(Number(req.query.limit || 10), 1), 20);

    const overviewMetricsPromise = cached("admin:ecosystem:overview:v2", 30000, async () => {
      const metrics = await computeLeadMetrics();
      const [dealershipsCount, banksCount, pendingDealerships, pendingBanks] = await Promise.all([
        countRecords("dealerships").catch(() => 0),
        countRecords("bankPartners").catch(() => 0),
        countRecords("pendingDealershipApprovals", { where: [{ field: "status", value: "pending" }] }).catch(() => 0),
        countRecords("pendingBankApprovals", { where: [{ field: "status", value: "pending" }] }).catch(() => 0),
      ]);
      return { metrics, dealershipsCount, banksCount, pendingDealerships, pendingBanks };
    });

    const leadSummaryPromise = cached(`admin:ecosystem:leads:${leadLimit}:${req.query.cursor || ""}:v2`, 15000, async () => {
      const projected = await queryLeadProjectionForUser({ user: req.user, query: { limit: leadLimit, cursor: req.query.cursor } }).catch(() => null);
      if (projected?.data?.length) return projected;
      return queryAllLeads({ query: { limit: leadLimit, cursor: req.query.cursor } });
    });

    const recentActivityPromise = cached("admin:ecosystem:activity:v2", 30000, async () => (
      listRecentRecords("workflowLogViews", {
        limit: 5,
        orderBy: "timestamp",
        fields: ["id", "logType", "timestamp", "actorEmail", "status", "action", "title", "summary", "leadId", "caseId"],
      }).catch(() => [])
    ));

    const approvalsSummaryPromise = cached("admin:ecosystem:approvals:v2", 30000, async () => {
      const [onboardingRequests, pendingDealershipApprovals, pendingBankApprovals, pendingGoogleAccounts] = await Promise.all([
        boundedList("onboardingRequests", 5, (item) => item, ["id", "status", "dealershipName", "loginEmail", "city", "createdAt", "updatedAt"]),
        boundedList("pendingDealershipApprovals", 5, (item) => item, APPROVAL_LIST_FIELDS),
        boundedList("pendingBankApprovals", 5, (item) => item, APPROVAL_LIST_FIELDS),
        boundedList("pendingGoogleAccounts", 5, (item) => item, ["id", "email", "portal", "status", "reason", "createdAt", "updatedAt"]),
      ]);
      return { onboardingRequests, pendingDealershipApprovals, pendingBankApprovals, pendingGoogleAccounts };
    });

    const bankSummaryPromise = cached("admin:ecosystem:banks:v2", 30000, async () => {
      const [bankPartners, branches, branchManagers, loanExecutives] = await Promise.all([
        boundedList("bankPartners", 5, (item) => item, ["id", "bankId", "bankName", "companyName", "email", "ifsc", "ifscCode", "status", "active", "createdAt", "updatedAt"]),
        boundedList("bankBranchCatalog", 10, (item) => item, ["id", "bankId", "bankName", "branchName", "ifscCode", "city", "approvalStatus", "active", "updatedAt"]),
        boundedList("branchManagers", 5, (item) => item, ["id", "email", "bankId", "bankName", "branchId", "branchCity", "status", "active", "createdAt", "updatedAt"]),
        boundedList("loanExecutives", 5, (item) => item, ["id", "email", "bankId", "bankName", "branchId", "branchCity", "status", "active", "createdAt", "updatedAt"]),
      ]);
      return { bankPartners, banks: bankPartners, branches, branchManagers, loanExecutives };
    });

    const dealershipSummaryPromise = cached("admin:ecosystem:dealerships:v2", 30000, async () => {
      const [dealerships, financeDesks, dealershipManagers] = await Promise.all([
        boundedList("dealerships", 5, (item) => item, ["id", "dealershipName", "name", "city", "status", "active", "createdAt", "updatedAt"]),
        boundedList("financeDesks", 5, (item) => item, ["id", "email", "officialEmail", "dealershipEmail", "city", "status", "active", "createdAt", "updatedAt"]),
        boundedList("dealershipManagers", 5, (item) => item, ["id", "email", "fullName", "role", "dealershipEmail", "status", "active", "createdAt", "updatedAt"]),
      ]);
      return { dealerships, financeDesks, dealershipManagers };
    });

    const [overviewMetrics, leadPage, recentActivity, approvalsSummary, bankSummary, dealershipSummary] = await Promise.all([
      overviewMetricsPromise,
      leadSummaryPromise,
      recentActivityPromise,
      approvalsSummaryPromise,
      bankSummaryPromise,
      dealershipSummaryPromise,
    ]);

    const payload = {
      leads: leadPage.data || [],
      leadPagination: { nextCursor: leadPage.nextCursor, hasMore: leadPage.hasMore, limit: leadPage.limit || leadLimit },
      onboardingRequests: approvalsSummary.onboardingRequests,
      dealerships: dealershipSummary.dealerships,
      financeDesks: dealershipSummary.financeDesks,
      dealershipManagers: dealershipSummary.dealershipManagers,
      bankPartners: bankSummary.bankPartners,
      banks: bankSummary.banks,
      branches: bankSummary.branches,
      branchManagers: bankSummary.branchManagers,
      loanExecutives: bankSummary.loanExecutives,
      assignments: [],
      reassignmentLogs: [],
      documents: [],
      bankDocuments: [],
      pendingDealershipApprovals: approvalsSummary.pendingDealershipApprovals,
      pendingBankApprovals: approvalsSummary.pendingBankApprovals,
      approvalLogs: [],
      pendingGoogleAccounts: approvalsSummary.pendingGoogleAccounts,
      loginActivity: [],
      users: [],
      sections: {
        overviewMetrics,
        recentActivity,
        approvalsSummary,
        bankSummary,
        dealershipSummary,
        leadSummary: {
          totalLeads: overviewMetrics.metrics?.totalLeads || 0,
          preview: leadPage.data || [],
          pagination: { nextCursor: leadPage.nextCursor, hasMore: leadPage.hasMore, limit: leadPage.limit || leadLimit },
        },
      },
    };
    return payload;
}

export async function getAdminEcosystem(req, res, next) {
  try {
    res.json(await adminEcosystemPayload(req));
  } catch (error) {
    next(error);
  }
}

// Re-export bank admin functions from bank.admin.controller
export {
  registerBankBranchAdmin,
  approveBankBranchAdmin,
  rejectBankBranchAdmin,
  deactivateBankBranchAdmin,
  getAdminBankBranches,
  getBankBranchDetailsAdmin,
  updateBankBranchAdmin,
};
