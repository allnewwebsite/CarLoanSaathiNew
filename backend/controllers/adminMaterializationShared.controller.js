import { deleteRecord, deleteRecordsByQuery, findRecordsByField, getRecord, listRecords, queryRecords, updateRecord, upsertRecord } from "../services/firestore.service.js";
import { firebaseAdmin } from "../firebase/admin.js";
import { assertNoActiveIdentityCollision, upsertCanonicalUser } from "../services/identity.service.js";
import { recordMonitoringSignal } from "../services/monitoringCenter.service.js";
import { publishRealtimeEvent } from "../services/realtime.service.js";
import { isProfessionalPlan, normalizeOnboardingPlan } from "../utils/onboardingPlan.js";
import { firstAdminLookup, normalizeEmail } from "./adminApprovalShared.controller.js";

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
