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
  enrichAdminLeadRows,
  filterLeads,
  leadDetailResponseFromProjection,
  leadText,
  sameDate,
  sameText,
} from "./adminLeadShared.controller.js";
import {
  approvalLog,
  approvalStatusOf,
  APPROVAL_LIST_FIELDS,
  APPROVAL_LIST_PROJECTION_FIELDS,
  boundedList,
  clearAdminApprovalCaches,
  clearLeadMutationCaches,
  ecosystemLimit,
  finalApprovalStatus,
  firstAdminLookup,
  incrementPlatformCounters,
  normalizeEmail,
  pendingApprovalStatus,
  runAdminSideEffects,
  safeAdminUser,
  safeDocument,
  safeLoginActivity,
  today,
} from "./adminApprovalShared.controller.js";
import {
  approveDealershipBackrefs,
  candidateRecordsByQueries,
  dealerEventPayload,
  dealerIdentityProfile,
  deleteFirebaseAuthByEmail,
  deleteMatchingRecords,
  firebaseUidForEmail,
  firestoreNotFound,
  materializeApprovedDealership,
  publishDealerEvent,
  recordDealerSignal,
  requestLoginEmail,
  safeDealershipApprovalRecord,
  stripRemovedDealershipFields,
  updateRecordIfExists,
} from "./adminMaterializationShared.controller.js";
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
  enrichAdminLeadRows,
  filterLeads,
  leadDetailResponseFromProjection,
  leadText,
  sameDate,
  sameText,
  approvalLog,
  approvalStatusOf,
  APPROVAL_LIST_FIELDS,
  APPROVAL_LIST_PROJECTION_FIELDS,
  boundedList,
  clearAdminApprovalCaches,
  clearLeadMutationCaches,
  ecosystemLimit,
  finalApprovalStatus,
  firstAdminLookup,
  incrementPlatformCounters,
  normalizeEmail,
  pendingApprovalStatus,
  runAdminSideEffects,
  safeAdminUser,
  safeDocument,
  safeLoginActivity,
  today,
  approveDealershipBackrefs,
  candidateRecordsByQueries,
  dealerEventPayload,
  dealerIdentityProfile,
  deleteFirebaseAuthByEmail,
  deleteMatchingRecords,
  firebaseUidForEmail,
  firestoreNotFound,
  materializeApprovedDealership,
  publishDealerEvent,
  recordDealerSignal,
  requestLoginEmail,
  safeDealershipApprovalRecord,
  stripRemovedDealershipFields,
  updateRecordIfExists,
  registerBankBranchAdmin,
  approveBankBranchAdmin,
  rejectBankBranchAdmin,
  deactivateBankBranchAdmin,
  getAdminBankBranches,
  getBankBranchDetailsAdmin,
  updateBankBranchAdmin,
};

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

export const ADMIN_SHARED_SENTINEL = true;
