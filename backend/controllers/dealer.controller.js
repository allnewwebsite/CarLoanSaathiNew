import { createRecord, deleteRecord, deleteRecordsByQuery, findRecordsByField, getRecord, incrementRecord, listRecords, queryRecords, updateRecord, upsertRecord } from "../services/firestore.service.js";
import { firebaseAdmin } from "../firebase/admin.js";
import { financeDeskLeadSchema } from "../validations/lead.validation.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "../services/timeline.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "../services/audit.service.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";
import { sanitizeFirestoreData } from "../utils/firestoreSanitizer.js";
import { generateLeadCaseId } from "../utils/generateCaseId.js";
import { queryDealershipLeads } from "../services/leadQuery.service.js";
import { logError, logInfo } from "../services/logger.service.js";
import { reassignLeadToNextBranchExecutive } from "../services/assignment.service.js";
import { getLeadDetailProjection, queryLeadProjectionForUser, queryStaffViewProjection, syncLeadProjectionSoon, syncStaffViewProjectionSoon } from "../services/projection.service.js";
import {
  getAvailableBankBranches,
  getDealershipBankTieUps,
  addBankTieUp,
  removeBankTieUp,
  updateDealershipBankTieUps,
  validateBranchTieUp,
} from "../services/dealership.service.js";
import crypto from "node:crypto";
import { revokeUserSessions } from "./auth.controller.js";
import { assertNoActiveIdentityCollision, upsertCanonicalUser } from "../services/identity.service.js";
import { hashTemporaryPassword } from "../services/temporaryPassword.service.js";
import { cached, clearCachedValue } from "../services/ttlCache.service.js";
import { publishRealtimeEvent, REALTIME_EVENTS } from "../services/realtime.service.js";
import { paginationParams } from "../utils/pagination.js";
import { recordMonitoringSignal } from "../services/monitoringCenter.service.js";
import { normalizeBankLocation, normalizeBankState, normalizeDealershipBrand } from "../services/bankLocationMaster.service.js";
import { queueLeadAssignedWhatsApp } from "../services/whatsapp.service.js";
import { normalizeOnboardingPlan } from "../utils/onboardingPlan.js";

function dealerEmail(req) {
  return req.user?.email || req.user?.firebase?.identities?.email?.[0] || req.user?.uid;
}

async function financeDeskContext(req) {
  const email = dealerEmail(req);
  return cached(`context:finance:${email}`, 15000, async () => {
    const desk = await getRecord("financeDesks", email).catch(() => null)
      || (await findRecordsByField("financeDesks", "officialEmail", email, 3))[0]
      || (await findRecordsByField("financeDesks", "email", email, 3))[0]
      || (await findRecordsByField("financeDesks", "dealershipEmail", email, 3))[0]
      || null;
    const dealershipEmail = desk?.dealershipEmail || email;
    const dealership = await getRecord("dealerships", dealershipEmail) || await getRecord("dealers", dealershipEmail) || {};
    return { email, dealershipEmail, desk, dealership };
  });
}

function owned(leads, email, dealershipEmail = email) {
  return leads.filter((lead) => lead.dealerEmail === dealershipEmail || lead.dealershipEmail === dealershipEmail || lead.createdBy === dealershipEmail || lead.dealerEmail === email || lead.createdBy === email);
}

function logProjectionRead(event, req, meta = {}) {
  recordMonitoringSignal(event, { endpoint: req.route?.path, path: req.originalUrl, ...meta });
  logInfo(event, {
    tag: event,
    requestId: req.requestId,
    path: req.originalUrl,
    endpoint: req.route?.path,
    ...meta,
  });
}

function logReadMetric(event, req, meta = {}) {
  recordMonitoringSignal(event, { endpoint: meta.endpoint || req.route?.path, path: req.originalUrl, ...meta });
  logInfo(event, {
    tag: event,
    requestId: req.requestId,
    path: req.originalUrl,
    ...meta,
  });
}

function dealerCanReadProjectedLead(lead, email, dealershipEmail) {
  return Boolean(
    lead
    && (
      lead.dealershipId === dealershipEmail
      || owned([lead], email, dealershipEmail).length
    )
  );
}

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

function salespersonIdFrom(value) {
  return String(value || "").trim();
}

function financeManagerIdFrom(value) {
  return String(value || "").trim();
}

async function validateDealerLeadAssignees({ salespersonId, financeManagerId, dealershipId }) {
  const [salesperson, financeManager] = await Promise.all([
    getRecord("salespersons", salespersonId),
    financeManagerId ? getRecord("financeManagers", financeManagerId) : Promise.resolve(null),
  ]);
  if (!salesperson || salesperson.dealershipId !== dealershipId || salesperson.active === false) {
    const error = new Error("Select an active salesperson from your dealership");
    error.status = 400;
    throw error;
  }
  if (financeManagerId && (!financeManager || financeManager.dealershipId !== dealershipId || financeManager.active === false)) {
    const error = new Error("Select an active Finance Manager from your dealership");
    error.status = 400;
    throw error;
  }
  return { salesperson, financeManager };
}

function clearLeadSyncCaches(leadId = "") {
  clearCachedValue("gm:salespersons:");
  clearCachedValue("gm:notifications:");
  clearCachedValue("bank:notifications:");
  clearCachedValue("bank:executives:");
  clearCachedValue("bank:executive-cases:");
  clearCachedValue("dealer:finance-managers:");
  if (leadId) {
    clearCachedValue(`lead-detail:${leadId}:`);
    clearCachedValue(`timeline:lead:${leadId}:`);
  }
}

function branchIdsFromRequest(value) {
  const items = Array.isArray(value)
    ? value
    : String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  return [...new Set(items)];
}

function required(value, label) {
  const text = String(value || "").trim();
  if (!text) {
    const error = new Error(`${label} is required`);
    error.status = 400;
    throw error;
  }
  return text;
}

function requiredGstin(value) {
  const gstin = required(value, "GSTIN number").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    const error = new Error("Enter a valid 15-character GSTIN number");
    error.status = 400;
    throw error;
  }
  return gstin;
}

function stripRemovedDealershipFields(dealership = {}) {
  const {
    officialDealershipEmail,
    ...rest
  } = dealership || {};
  return rest;
}

function generateTemporaryPassword() {
  const digits = crypto.randomInt(1000, 10000);
  const suffix = "abcdefghijkmnopqrstuvwxyz".charAt(crypto.randomInt(0, 24));
  return `CLS@${digits}${suffix}`;
}

function normalizeStaffRole(value) {
  const role = String(value || "").trim().toLowerCase();
  if (["finance-head", "finance head", "finance-desk", "finance desk"].includes(role)) return "finance-desk";
  if (["gm", "general manager"].includes(role)) return "gm";
  return "";
}

function staffRoleLabel(role) {
  if (role === "finance-desk") return "Finance Head";
  return role === "gm" ? "GM" : "";
}

function staffListRow(item) {
  return {
    id: item.id || item.email || item.officialEmail,
    fullName: item.fullName || item.name || item.headName || item.email,
    email: item.email || item.officialEmail,
    mobile: item.mobile || item.headMobile || item.officialMobile || "",
    employeeId: item.employeeId || item.jobId || item.employeeCode || "",
    role: item.role,
    roleLabel: staffRoleLabel(item.role),
    branch: item.branch || item.city || item.location || item.dealershipCity || "",
    city: item.city || item.branch || "",
    status: item.active === false || item.accountActive === false ? "inactive" : item.status || item.accountStatus || "active",
    active: item.active !== false && item.accountActive !== false,
  };
}

function mergeStaffRows(existing = {}, incoming = {}) {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    const current = merged[key];
    const hasCurrent = current !== undefined && current !== null && current !== "";
    const hasIncoming = value !== undefined && value !== null && value !== "";
    if (!hasCurrent && hasIncoming) merged[key] = value;
  }
  if (incoming.active === false) {
    merged.active = false;
    merged.status = incoming.status || "inactive";
  } else if (existing.active !== false && incoming.active === true) {
    merged.active = true;
    if (!merged.status || merged.status === "inactive") merged.status = incoming.status || "active";
  }
  return merged;
}

function staffEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function uniqueRecords(records = []) {
  const byId = new Map();
  records.flat().filter(Boolean).forEach((item) => {
    const key = item.id || item.email || item.officialEmail || JSON.stringify(item);
    if (!byId.has(key)) byId.set(key, item);
  });
  return [...byId.values()];
}

async function deleteMatchingRecords(collection, predicate, indexedQueries = []) {
  if (indexedQueries.length) {
    const counts = await Promise.all(indexedQueries.map((where) => deleteRecordsByQuery(collection, { where }).catch(() => 0)));
    return counts.reduce((sum, count) => sum + count, 0);
  }
  const records = await listRecords(collection).catch(() => []);
  const matches = records.filter(predicate);
  await Promise.all(matches.map((item) => deleteRecord(collection, item.id)));
  return matches.length;
}

async function buildDealerStaffRows(dealershipEmail, dealership = {}, currentEmail = "") {
  const [dealerStaff, financeDesks, financeDesk, dealershipManagers, users] = await Promise.all([
    findRecordsByField("dealerStaff", "dealershipId", dealershipEmail, 100),
    Promise.all([
      findRecordsByField("financeDesks", "dealershipId", dealershipEmail, 50),
      findRecordsByField("financeDesks", "dealershipEmail", dealershipEmail, 50),
      getRecord("financeDesks", dealershipEmail).catch(() => null),
    ]).then(uniqueRecords),
    Promise.all([
      findRecordsByField("financeDesk", "dealershipId", dealershipEmail, 50),
      findRecordsByField("financeDesk", "dealershipEmail", dealershipEmail, 50),
    ]).then(uniqueRecords),
    Promise.all([
      findRecordsByField("dealershipManagers", "dealershipId", dealershipEmail, 50),
      findRecordsByField("dealershipManagers", "dealershipEmail", dealershipEmail, 50),
    ]).then(uniqueRecords),
    Promise.all([
      findRecordsByField("users", "dealershipId", dealershipEmail, 100),
      findRecordsByField("users", "dealershipEmail", dealershipEmail, 100),
    ]).then(uniqueRecords),
  ]);
  const rows = new Map();
  const add = (item, source) => {
    const email = staffEmail(item.email || item.officialEmail || item.id);
    if (!email) return;
    if (item.dealershipId !== dealershipEmail && item.dealershipEmail !== dealershipEmail) return;
    const role = normalizeStaffRole(item.role);
    if (!role) return;
    const row = staffListRow({
      ...item,
      email,
      role,
      branch: item.branch || item.city || dealership.city || dealership.registeredCity || dealership.dealershipName,
      city: item.city || dealership.city || dealership.registeredCity || "",
    });
    rows.set(email, mergeStaffRows(rows.get(email), {
      ...row,
      protected: email === staffEmail(dealershipEmail) || email === staffEmail(currentEmail),
      sourceCollections: [...new Set([...(rows.get(email)?.sourceCollections || []), source])],
      uniqueEmployeeId: row.employeeId || item.uid || email,
      authAccountId: item.uid || rows.get(email)?.authAccountId || email,
      createdAt: item.createdAt || rows.get(email)?.createdAt || "",
      createdBy: item.createdByDealerAdminId || item.createdBy || rows.get(email)?.createdBy || "",
      lastLoginAt: item.lastLoginAt || rows.get(email)?.lastLoginAt || "",
      assignedDealership: item.dealershipName || dealership.dealershipName || dealership.name || dealershipEmail,
      dealershipId: item.dealershipId || item.dealershipEmail || dealershipEmail,
    }));
  };
  dealerStaff.forEach((item) => add(item, "dealerStaff"));
  financeDesks.forEach((item) => add(item, "financeDesks"));
  financeDesk.forEach((item) => add(item, "financeDesk"));
  dealershipManagers.forEach((item) => add(item, "dealershipManagers"));
  users
    .filter((item) => ["finance-desk", "gm"].includes(normalizeStaffRole(item.role)))
    .forEach((item) => add(item, "users"));
  return [...rows.values()].sort((left, right) => String(left.fullName || "").localeCompare(String(right.fullName || "")));
}

function staffIdentifierMatches(item = {}, identifier = "") {
  const requested = staffEmail(identifier);
  if (!requested) return false;
  return [
    item.id,
    item.sourceId,
    item.email,
    item.officialEmail,
    item.uid,
    item.authAccountId,
    item.uniqueEmployeeId,
    item.employeeId,
  ].some((value) => staffEmail(value) === requested);
}

async function findDealerStaffEmployee({ dealershipEmail, dealership, currentEmail, identifier }) {
  const [projected, sourceRows] = await Promise.all([
    queryStaffViewProjection({ dealershipId: dealershipEmail, query: { limit: 100 } }).catch(() => null),
    buildDealerStaffRows(dealershipEmail, dealership, currentEmail),
  ]);
  const rows = [...(projected || []), ...sourceRows];
  const employee = rows.find((item) => staffIdentifierMatches(item, identifier));
  if (!employee) return null;
  const email = staffEmail(employee.email || employee.officialEmail || employee.sourceId);
  return {
    ...employee,
    email,
    protected: employee.protected === true || email === staffEmail(dealershipEmail) || email === staffEmail(currentEmail),
  };
}

async function deleteDealerStaffCollectionRecords(collection, { employee, dealershipEmail, email }) {
  const belongsToDealer = (item) => item.dealershipId === dealershipEmail || item.dealershipEmail === dealershipEmail;
  const emailMatches = (item) => staffEmail(item.email || item.officialEmail || item.id) === email;
  const indexedDeleted = await deleteMatchingRecords(collection, (item) => belongsToDealer(item) && emailMatches(item), [
    [{ field: "dealershipId", value: dealershipEmail }, { field: "email", value: email }],
    [{ field: "dealershipEmail", value: dealershipEmail }, { field: "email", value: email }],
    [{ field: "dealershipId", value: dealershipEmail }, { field: "officialEmail", value: email }],
    [{ field: "dealershipEmail", value: dealershipEmail }, { field: "officialEmail", value: email }],
  ]);
  const candidateIds = [...new Set([
    email,
    employee.sourceId,
    employee.uid,
    employee.authAccountId,
  ].map((value) => String(value || "").trim()).filter(Boolean))];
  const directRecords = await Promise.all(candidateIds.map((id) => getRecord(collection, id).catch(() => null)));
  const linkedRecords = await Promise.all([
    findRecordsByField(collection, "email", email, 20).catch(() => []),
    findRecordsByField(collection, "officialEmail", email, 20).catch(() => []),
  ]);
  const records = uniqueRecords([...directRecords, ...linkedRecords.flat()]);
  const verified = records.filter((item) =>
    emailMatches(item)
    && (belongsToDealer(item) || candidateIds.includes(String(item.id || "").trim()))
  );
  await Promise.all(verified.map((item) => deleteRecord(collection, item.id).catch(() => null)));
  return indexedDeleted + verified.length;
}

function runDealerLeadSideEffects(label, tasks = []) {
  Promise.allSettled(tasks.map((task) => task())).then((results) => {
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        logError("Dealer lead side effect failed", {
          label,
          taskIndex: index,
          error: result.reason?.message || String(result.reason || "unknown"),
        });
      }
    });
  }).catch((error) => {
    logError("Dealer lead side effect runner failed", { label, error: error.message });
  });
}

async function liveDealerRegistrationForAccount(account) {
  if (!account?.email) return { linkedOnboarding: null, linkedApproval: null, dealership: null, live: false };
  const [linkedOnboarding, linkedApproval] = await Promise.all([
    getRecord("onboardingRequests", account.onboardingRequestId || "").catch(() => null)
      .then(async (direct) => direct
        || (await findRecordsByField("onboardingRequests", "loginEmail", account.email, 3))[0]
        || (await findRecordsByField("onboardingRequests", "primaryGoogleEmail", account.email, 3))[0]
        || null),
    getRecord("pendingDealershipApprovals", account.approvalRequestId || "").catch(() => null)
      .then(async (direct) => direct
        || (account.onboardingRequestId ? (await findRecordsByField("pendingDealershipApprovals", "onboardingRequestId", account.onboardingRequestId, 3))[0] : null)
        || (await findRecordsByField("pendingDealershipApprovals", "loginEmail", account.email, 3))[0]
        || (await findRecordsByField("pendingDealershipApprovals", "primaryGoogleEmail", account.email, 3))[0]
        || null),
  ]);
  const dealership = await getRecord("dealerships", account.email) || await getRecord("approvedDealerships", account.email);
  return { linkedOnboarding, linkedApproval, dealership, live: Boolean(linkedOnboarding || linkedApproval || dealership) };
}

async function firebaseUserVerified(decoded, email) {
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

async function assertDealerRegistrationEmailVerified({ uid, email }) {
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
    const error = new Error("Verify your email address before submitting dealership registration.");
    error.status = 403;
    error.code = "EMAIL_NOT_VERIFIED";
    throw error;
  }
}

function dealerEmailPendingPayload({ registrationId, email, selectedPlan }) {
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
    message: "Verify your email address before completing dealership registration.",
    redirectTo: "/dealer-registration/verify-email",
    selectedPlan,
  };
}

export async function startDealerRegistration(req, res, next) {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: "Firebase authentication token is required" });
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });

    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    const email = String(decoded.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Account email is required" });
    const emailVerified = await firebaseUserVerified(decoded, email);

    const now = new Date().toISOString();
    const requestedPlan = normalizeOnboardingPlan(req.body.selectedPlan);
    let existing = await getRecord("pendingDealerAccounts", email).catch(() => null)
      || (await findRecordsByField("pendingDealerAccounts", "email", email, 3))[0]
      || null;
    const existingLive = existing ? await liveDealerRegistrationForAccount(existing) : { live: false };
    if (existing && !existingLive.live) {
      existing = await updateRecord("pendingDealerAccounts", existing.id, {
        uid: decoded.uid || email,
        email,
        name: decoded.name || email,
        photoURL: decoded.picture || "",
        authProvider: "password",
        onboardingStarted: true,
        registrationSubmitted: false,
        registrationCompleted: false,
        approvalStatus: "not-submitted",
        accountState: emailVerified ? "REGISTRATION_STARTED" : "EMAIL_PENDING",
        emailVerified,
        accountApproved: false,
        accountActive: false,
        submittedAt: null,
        dealershipData: {},
        documents: [],
        onboardingRequestId: null,
        approvalRequestId: null,
        dealerApprovalQueueId: null,
        selectedPlan: existing.selectedPlan || requestedPlan,
        resetAfterRemovalAt: now,
        lastAuthAt: now,
      });
    }

    if (!emailVerified) {
      const pendingPayload = {
        uid: decoded.uid || email,
        email,
        name: decoded.name || email,
        photoURL: decoded.picture || "",
        authProvider: "password",
        onboardingStarted: true,
        registrationSubmitted: false,
        registrationCompleted: false,
        approvalStatus: "email-pending",
        accountState: "EMAIL_PENDING",
        emailVerified: false,
        accountApproved: false,
        accountActive: false,
        submittedAt: null,
        dealershipData: existing?.dealershipData || {},
        documents: existing?.documents || [],
        onboardingRequestId: existing?.onboardingRequestId || null,
        approvalRequestId: existing?.approvalRequestId || null,
        dealerApprovalQueueId: existing?.dealerApprovalQueueId || null,
        selectedPlan: existing?.selectedPlan || requestedPlan,
        startedAt: existing?.startedAt || now,
        lastAuthAt: now,
      };
      const registration = existing
        ? await updateRecord("pendingDealerAccounts", existing.id, pendingPayload)
        : await createRecord("pendingDealerAccounts", pendingPayload);
      await upsertCanonicalUser(decoded.uid || email, {
        uid: decoded.uid || email,
        email,
        role: "finance-desk",
        approved: false,
        active: false,
        accountStatus: "email-pending",
        accountState: "EMAIL_PENDING",
        accountApproved: false,
        accountActive: false,
        emailVerified: false,
        dealershipId: null,
        bankId: null,
        createdAt: existing?.createdAt || now,
        lastLoginAt: null,
      });
      return res.json(dealerEmailPendingPayload({
        registrationId: registration.id,
        email,
        selectedPlan: registration.selectedPlan || requestedPlan,
      }));
    }

    if (existing?.approvalStatus === "approved" && existingLive.live) {
      return res.json({
        status: "approved",
        approvalStatus: "approved",
        accountState: "APPROVED",
        registrationSubmitted: true,
        emailVerified: true,
        registrationId: existing.id,
        email,
        message: "Account already exists.",
        redirectTo: "/dealer-registration/approved",
      });
    }

    if ((existing?.approvalStatus === "rejected" || existing?.approvalStatus === "suspended") && existingLive.live) {
      await updateRecord("pendingDealerAccounts", existing.id, { lastAuthAt: now });
      return res.json({
        status: existing.approvalStatus,
        approvalStatus: existing.approvalStatus,
        accountState: String(existing.approvalStatus).toUpperCase(),
        emailVerified: true,
        registrationId: existing.id,
        email,
        message: existing.rejectionReason || existing.suspensionReason || "Your dealership onboarding request cannot continue.",
        redirectTo: existing.approvalStatus === "rejected" ? "/dealer-registration/rejected" : "/dealer-registration/suspended",
      });
    }

    if (existing?.approvalStatus === "pending" && existingLive.live) {
      await updateRecord("pendingDealerAccounts", existing.id, { lastAuthAt: now });
      return res.json({
        status: "submitted",
        approvalStatus: "pending",
        accountState: "PENDING_APPROVAL",
        registrationSubmitted: true,
        emailVerified: true,
        registrationId: existing.id,
        email,
        message: "Your dealership onboarding request is pending Super Admin approval.",
        redirectTo: "/dealer-registration/pending",
      });
    }

    const payload = {
      uid: decoded.uid || email,
      email,
      name: decoded.name || email,
      photoURL: decoded.picture || "",
      authProvider: "password",
      onboardingStarted: true,
      registrationSubmitted: false,
      registrationCompleted: false,
      approvalStatus: "not-submitted",
      accountState: "EMAIL_VERIFIED",
      emailVerified: true,
      accountApproved: false,
      accountActive: false,
      submittedAt: null,
      startedAt: existing?.startedAt || now,
      lastAuthAt: now,
      dealershipData: {},
      documents: [],
      onboardingRequestId: null,
      approvalRequestId: null,
      dealerApprovalQueueId: null,
      selectedPlan: existing?.selectedPlan || requestedPlan,
    };
    const registration = existing
      ? await updateRecord("pendingDealerAccounts", existing.id, payload)
      : await createRecord("pendingDealerAccounts", payload);
    await assertNoActiveIdentityCollision({ uid: decoded.uid || email, email, role: "finance-desk", excludeIds: [] });
    await upsertCanonicalUser(decoded.uid || email, {
      uid: decoded.uid || email,
      email,
      role: "finance-desk",
      approved: false,
      active: false,
      accountStatus: "pending",
      accountState: "EMAIL_VERIFIED",
      emailVerified: true,
      accountApproved: false,
      accountActive: false,
      dealershipId: null,
      bankId: null,
      createdAt: existing?.createdAt || now,
      lastLoginAt: null,
    });

    res.json({
      status: "account-created",
      approvalStatus: "not-submitted",
      accountState: "EMAIL_VERIFIED",
      registrationSubmitted: false,
      emailVerified: true,
      registrationId: registration.id,
      email,
      message: "Account created successfully. Continue dealership registration.",
      redirectTo: "/dealer-registration/form",
      selectedPlan: registration.selectedPlan || requestedPlan,
    });
  } catch (error) {
    next(error);
  }
}

export async function getDealerRegistrationStatus(req, res, next) {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: "Firebase authentication token is required" });
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });

    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    const email = String(decoded.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Account email is required" });

    const user = await getRecord("users", email).catch(() => null)
      || (await findRecordsByField("users", "email", email, 3))[0]
      || null;
    const dealershipEmail = user?.dealershipId || email;
    const account = await getRecord("pendingDealerAccounts", dealershipEmail).catch(() => null)
      || await getRecord("pendingDealerAccounts", email).catch(() => null)
      || (await findRecordsByField("pendingDealerAccounts", "email", dealershipEmail, 3))[0]
      || (await findRecordsByField("pendingDealerAccounts", "email", email, 3))[0]
      || null;

    if (!emailVerified) {
      return res.json(dealerEmailPendingPayload({
        registrationId: account?.id || null,
        email,
        selectedPlan: account?.selectedPlan || normalizeOnboardingPlan(),
      }));
    }

    if (account && (account.emailVerified !== true || account.accountState === "EMAIL_PENDING" || account.approvalStatus === "email-pending")) {
      const nextApprovalStatus = account.registrationSubmitted === true ? "pending" : "not-submitted";
      await updateRecord("pendingDealerAccounts", account.id, {
        emailVerified: true,
        accountState: "EMAIL_VERIFIED",
        approvalStatus: nextApprovalStatus,
        lastVerifiedAt: new Date().toISOString(),
      }).catch(() => null);
      account.emailVerified = true;
      account.accountState = "EMAIL_VERIFIED";
      account.approvalStatus = nextApprovalStatus;
    }

    const linkedOnboarding = account ? await getRecord("onboardingRequests", account.onboardingRequestId || "").catch(() => null)
      || (await findRecordsByField("onboardingRequests", "loginEmail", account.email, 3))[0]
      || (await findRecordsByField("onboardingRequests", "primaryGoogleEmail", account.email, 3))[0]
      || null : null;
    const linkedApproval = account ? await getRecord("pendingDealershipApprovals", account.approvalRequestId || "").catch(() => null)
      || (account.onboardingRequestId ? (await findRecordsByField("pendingDealershipApprovals", "onboardingRequestId", account.onboardingRequestId, 3))[0] : null)
      || (await findRecordsByField("pendingDealershipApprovals", "loginEmail", account.email, 3))[0]
      || (await findRecordsByField("pendingDealershipApprovals", "primaryGoogleEmail", account.email, 3))[0]
      || null : null;
    const dealership = await getRecord("dealerships", dealershipEmail) || await getRecord("approvedDealerships", dealershipEmail);
    const activeApprovedUser = user?.approved === true
      && user?.active === true
      && user?.accountApproved === true
      && user?.accountActive === true;
    const activeDealership = dealership
      && dealership.accountActive !== false
      && dealership.active !== false
      && !["pending", "rejected", "suspended", "deleted", "inactive"].includes(String(dealership.status || "").toLowerCase());
    const dealershipApprovedByAdmin = activeDealership
      && (dealership.approved === true || String(dealership.status || "").toLowerCase() === "approved");

    if (activeDealership && (account?.approvalStatus === "approved" || activeApprovedUser || dealershipApprovedByAdmin)) {
      if (account && account.approvalStatus !== "approved") {
        await updateRecord("pendingDealerAccounts", account.id, {
          approvalStatus: "approved",
          accountApproved: true,
          accountActive: true,
          registrationSubmitted: true,
          registrationCompleted: true,
        });
      }
      return res.json({
        status: "approved",
        approvalStatus: "approved",
        accountState: "APPROVED",
        registrationSubmitted: true,
        accountApproved: true,
        accountActive: true,
        emailVerified: true,
        email,
        dealershipEmail,
        message: "Your dealership account has been approved successfully by CarLoanSaathi.",
        redirectTo: "/dealer-registration/approved",
      });
    }

    if (account?.registrationSubmitted === false || account?.approvalStatus === "not-submitted") {
      return res.json({
        status: "not-submitted",
        approvalStatus: "not-submitted",
        accountState: "EMAIL_VERIFIED",
        registrationSubmitted: false,
        accountApproved: false,
        accountActive: false,
        emailVerified: true,
        email,
        registrationId: account.id,
        message: "Complete your dealership registration form.",
        redirectTo: "/dealer-registration/form",
      });
    }

    const hasLiveRegistrationRecord = Boolean(linkedOnboarding || linkedApproval || dealership);

    if (!hasLiveRegistrationRecord) {
      return res.json({
        status: "not-registered",
        approvalStatus: "not-registered",
        accountState: "REGISTRATION_STARTED",
        registrationSubmitted: false,
        accountApproved: false,
        accountActive: false,
        emailVerified: true,
        email,
        registrationId: null,
        message: "No active dealership registration was found for this account.",
        redirectTo: "/dealer-registration",
      });
    }

    if (!activeDealership && (user || dealership) && !account) {
      return res.json({
        status: "inactive",
        approvalStatus: "inactive",
        accountState: "DEACTIVATED",
        registrationSubmitted: false,
        accountApproved: false,
        accountActive: false,
        emailVerified: true,
        email,
        registrationId: null,
        message: "This dealership account is inactive or deleted.",
        redirectTo: "/dealer-registration",
      });
    }

    return res.json({
      status: account?.approvalStatus || "pending",
      approvalStatus: account?.approvalStatus || "pending",
      accountState: account?.approvalStatus === "rejected"
        ? "REJECTED"
        : account?.approvalStatus === "suspended"
          ? "SUSPENDED"
          : "PENDING_APPROVAL",
      registrationSubmitted: account?.registrationSubmitted !== false,
      accountApproved: account?.accountApproved === true,
      accountActive: account?.accountActive === true,
      emailVerified: true,
      email,
      registrationId: account?.id || null,
      message: account?.approvalStatus === "rejected"
        ? account.rejectionReason || "Your dealership registration was rejected."
        : account?.approvalStatus === "suspended"
          ? account.suspensionReason || "Your dealership account is suspended."
          : "Your dealership account is still pending approval from CarLoanSaathi.",
      redirectTo: account?.approvalStatus === "rejected"
        ? "/dealer-registration/rejected"
        : account?.approvalStatus === "suspended"
          ? "/dealer-registration/suspended"
          : "/dealer-registration/pending",
    });
  } catch (error) {
    next(error);
  }
}

function normalizeFinanceDeskLead(body) {
  const normalized = {
    fullName: body.fullName || body.customerName,
    mobile: body.mobile,
    city: body.city,
    selectedBrand: body.selectedBrand || body.carBrand,
    selectedModel: body.selectedModel || body.carModel || "Dealer selected vehicle",
    carPrice: body.carPrice || body.carOnRoadPrice || body.vehiclePrice || body.loanAmount,
    loanAmount: body.loanAmount || body.requiredLoanAmount,
    employmentType: body.employmentType || "Not specified",
    bankBranchId: body.bankBranchId || body.branchId || body.ifscCode || "",
    bankId: body.bankId || body.assignedBankId || "",
    bankName: body.bankName || "",
    branchName: body.branchName || "",
    ifscCode: body.ifscCode || "",
    salespersonId: body.salespersonId || "",
    assignedSalesperson: body.assignedSalesperson || body.salespersonName || "Finance desk direct",
    financeManagerId: body.financeManagerId || "",
    financeManagerName: body.financeManagerName || body.assignedFinanceManager || "",
    assignedFinanceManager: body.assignedFinanceManager || body.financeManagerName || "",
    remarks: body.remarks,
    documents: body.documents,
    metadata: body.metadata,
  };
  return financeDeskLeadSchema.parse(normalized);
}

function financeManagerRow(manager = {}) {
  return {
    id: manager.id,
    name: manager.name || manager.financeManagerName || "",
    mobile: manager.mobile || "",
    email: manager.email || "",
    employeeId: manager.employeeId || "",
    dealershipId: manager.dealershipId || "",
    dealershipName: manager.dealershipName || "",
    status: manager.active === false ? "Inactive" : "Active",
    active: manager.active !== false,
    createdAt: manager.createdAt || "",
    updatedAt: manager.updatedAt || "",
  };
}

function readableLeadError(error) {
  if (!error?.issues?.length) return "Failed to create lead";
  const issue = error.issues[0];
  const field = issue.path?.[0];
  const messages = {
    fullName: "Missing customer name",
    mobile: "Invalid mobile number",
    city: "Missing city",
    selectedBrand: "Missing car brand",
    selectedModel: "Missing car model",
    carPrice: "Missing car price",
    loanAmount: "Missing loan amount",
    assignedSalesperson: "Missing assigned salesperson",
    bankBranchId: "Select a tied-up bank branch",
  };
  return messages[field] || issue.message || "Failed to create lead";
}

function normalizeFinanceStatus(status) {
  const normalized = normalizeStatus(status);
  const map = {
    NEW: "New",
    CONTACTED: "Contacted",
    REQUEST_DOCUMENT: "Pending Documents",
    DOCUMENT_RECEIVED: "Document Received",
    REQUEST_PENDING_DOCUMENTS: "Pending Documents",
    ALL_DOCUMENTS_RECEIVED: "Document Received",
    UNDER_BANK_PROCESS: "Under Bank Process",
    ASSIGNED: "New",
    ACCEPTED: "Under Bank Process",
    UNDER_REVIEW: "Under Bank Process",
    DOCS_PENDING: "Pending Documents",
    APPROVED: "Under Bank Process",
    REJECTED: "Rejected",
    DISBURSED: "Disbursed",
    CLOSED: "Disbursed",
  };
  return map[normalized] || "New";
}

export async function registerDealerOnboarding(req, res, next) {
  try {
    const loginEmail = required(req.body.primaryGoogleEmail || req.body.loginEmail, "Official login email").toLowerCase();
    const now = new Date().toISOString();
    await assertDealerRegistrationEmailVerified({ uid: req.body.dealerUid, email: loginEmail });
    const state = normalizeBankState(req.body.state || "Haryana");
    const city = normalizeBankLocation(state, req.body.city || req.body.dealerLocation || req.body.location);
    if (!state || !city) {
      return res.status(400).json({ message: "Dealer location is not supported for onboarding" });
    }
    const dealershipBrand = normalizeDealershipBrand(req.body.dealershipBrand);
    if (!dealershipBrand) {
      return res.status(400).json({ message: "Dealership brand is not supported" });
    }
    let pendingAccount = await getRecord("pendingDealerAccounts", req.body.registrationId || loginEmail).catch(() => null)
      || await getRecord("pendingDealerAccounts", req.body.dealerUid || "").catch(() => null)
      || (await findRecordsByField("pendingDealerAccounts", "email", loginEmail, 3))[0]
      || (req.body.dealerUid ? (await findRecordsByField("pendingDealerAccounts", "uid", req.body.dealerUid, 3))[0] : null)
      || null;
    if (!pendingAccount) {
      pendingAccount = await createRecord("pendingDealerAccounts", {
        uid: req.body.dealerUid || loginEmail,
        email: loginEmail,
        authProvider: "google",
        onboardingStarted: true,
        registrationSubmitted: false,
        approvalStatus: "not-submitted",
        accountState: "EMAIL_VERIFIED",
        emailVerified: true,
        accountApproved: false,
        accountActive: false,
        createdFromRegistrationSubmit: true,
        selectedPlan: normalizeOnboardingPlan(req.body.selectedPlan),
      });
    }
    const pendingAccountLive = await liveDealerRegistrationForAccount(pendingAccount);
    if (!pendingAccountLive.live && (pendingAccount.registrationSubmitted === true || pendingAccount.approvalStatus === "pending" || pendingAccount.approvalStatus === "approved")) {
      pendingAccount = await updateRecord("pendingDealerAccounts", pendingAccount.id, {
        registrationSubmitted: false,
        registrationCompleted: false,
        approvalStatus: "not-submitted",
        accountApproved: false,
        accountActive: false,
        submittedAt: null,
        dealershipData: {},
        documents: [],
        onboardingRequestId: null,
        approvalRequestId: null,
        dealerApprovalQueueId: null,
        resetAfterRemovalAt: now,
      });
    }
    if (pendingAccount.approvalStatus === "approved" || pendingAccount.accountActive === true) {
      return res.status(400).json({ message: "This dealership account is already approved." });
    }
    if (pendingAccount.registrationSubmitted === true || pendingAccount.approvalStatus === "pending") {
      return res.status(409).json({ message: "Your dealership registration is already submitted and pending approval." });
    }
    await assertNoActiveIdentityCollision({ uid: req.body.dealerUid || loginEmail, email: loginEmail, role: "finance-desk", excludeIds: [] });
    const selectedPlan = normalizeOnboardingPlan(pendingAccount.selectedPlan || req.body.selectedPlan);
    const dealership = {
      dealershipName: required(req.body.dealershipName, "Dealership name"),
      dealershipBrand,
      authorizedDealerCode: required(req.body.authorizedDealerCode, "Authorized dealer code"),
      gstinNumber: requiredGstin(req.body.gstinNumber || req.body.gstin || req.body.gstNumber),
      officialDealershipMobile: required(req.body.officialDealershipMobile, "Official dealership mobile"),
      state,
      city,
      location: city,
      pincode: required(req.body.pincode, "Pincode"),
      address: required(req.body.address, "Full dealership address"),
      landmark: String(req.body.landmark || "").trim(),
      monthlyCarSalesCapacity: required(req.body.monthlyCarSalesCapacity, "Monthly car sales capacity"),
      ...(optionalText(req.body.expectedMonthlyLoanApplications) ? { expectedMonthlyLoanApplications: optionalText(req.body.expectedMonthlyLoanApplications) } : {}),
      status: "Pending Approval",
      dealerId: loginEmail,
      dealerName: required(req.body.dealershipName, "Dealership name"),
      dealerBrand: dealershipBrand,
      dealerState: state,
      dealerLocation: city,
      dealerStatus: "pending",
      monthlySalesCapacity: required(req.body.monthlyCarSalesCapacity, "Monthly car sales capacity"),
      active: false,
      accountActive: false,
      approved: false,
      loginEmail,
      primaryGoogleEmail: loginEmail,
      createdAt: now,
      selectedPlan,
    };

    const documents = Array.isArray(req.body.documents) ? req.body.documents : [];
    const generalManager = [req.body.gmName, req.body.gmMobile, req.body.gmEmail].some((value) => optionalText(value))
      ? {
          name: optionalText(req.body.gmName),
          mobile: optionalText(req.body.gmMobile),
          email: optionalEmail(req.body.gmEmail),
        }
      : null;
    const financeDesk = [req.body.financeHeadName, req.body.financeHeadMobile, req.body.financeDeskEmail, req.body.financeTeamSize].some((value) => optionalText(value))
      ? {
          headName: optionalText(req.body.financeHeadName),
          headMobile: optionalText(req.body.financeHeadMobile),
          officialEmail: optionalEmail(req.body.financeDeskEmail) || loginEmail,
          teamSize: optionalText(req.body.financeTeamSize),
        }
      : null;
    const owner = {
      fullName: optionalText(req.body.ownerFullName) || dealership.dealershipName,
      mobile: optionalText(req.body.ownerMobile) || dealership.officialDealershipMobile,
      email: optionalEmail(req.body.ownerEmail) || loginEmail,
    };
    const registrationPayload = {
      type: "dealership",
      status: "Pending Approval",
      state,
      city,
      location: city,
      dealershipName: dealership.dealershipName,
      dealershipBrand: dealership.dealershipBrand,
      gstinNumber: dealership.gstinNumber,
      loginEmail,
      submittedAt: now,
      documents,
      dealership,
      owner,
      ...(generalManager ? { generalManager } : {}),
      ...(financeDesk ? { financeDesk } : {}),
      verification: {
        dealershipVerified: false,
      },
      selectedPlan,
    };

    const onboardingRequest = await createRecord("onboardingRequests", registrationPayload);

    const approval = await createRecord("pendingDealershipApprovals", {
      onboardingRequestId: onboardingRequest.id,
      pendingDealerAccountId: req.body.registrationId || null,
      type: "dealership",
      accountType: "dealership",
      status: "pending",
      state,
      city,
      location: city,
      dealershipName: dealership.dealershipName,
      dealershipBrand: dealership.dealershipBrand,
      gstinNumber: dealership.gstinNumber,
      loginEmail,
      primaryGoogleEmail: loginEmail,
      submittedAt: now,
      documents,
      dealership,
      owner: onboardingRequest.owner,
      ...(onboardingRequest.generalManager ? { generalManager: onboardingRequest.generalManager } : {}),
      ...(onboardingRequest.financeDesk ? { financeDesk: onboardingRequest.financeDesk } : {}),
      verification: registrationPayload.verification,
      selectedPlan,
    });

    const approvalQueue = await createRecord("dealerApprovalQueue", {
      ...registrationPayload,
      accountType: "dealership",
      pendingDealerAccountId: req.body.registrationId || null,
      pendingDealershipApprovalId: approval.id,
      approvalStatus: "pending",
      status: "pending",
      selectedPlan,
    });

    await updateRecord("pendingDealerAccounts", pendingAccount.id, {
      registrationSubmitted: true,
      approvalStatus: "pending",
      accountState: "PENDING_APPROVAL",
      emailVerified: true,
      accountApproved: false,
      accountActive: false,
      registrationCompleted: true,
      submittedAt: now,
      dealershipData: registrationPayload,
      documents,
      onboardingRequestId: onboardingRequest.id,
      approvalRequestId: approval.id,
      dealerApprovalQueueId: approvalQueue.id,
      selectedPlan,
    }, { readback: false });

    await upsertRecord("dealerRegistrations", req.body.dealerUid || loginEmail, {
      dealerUid: req.body.dealerUid || pendingAccount.uid || loginEmail,
      email: loginEmail,
      dealershipName: dealership.dealershipName,
      dealerBrand: dealership.dealershipBrand,
      state,
      city,
      dealerState: state,
      dealerLocation: city,
      mobile: dealership.officialDealershipMobile,
      registrationStatus: "pending-approval",
      submittedAt: now,
      selectedPlan,
    }, { readback: false });

    await upsertCanonicalUser(req.body.dealerUid || loginEmail, {
      uid: req.body.dealerUid || loginEmail,
      email: loginEmail,
      role: "finance-desk",
      approvalStatus: "pending",
      registrationCompleted: true,
      approved: false,
      active: false,
      accountApproved: false,
      accountActive: false,
      accountState: "PENDING_APPROVAL",
      emailVerified: true,
      dealershipId: loginEmail,
      status: "pending",
      selectedPlan,
    });

    await Promise.all(documents.map(async (document) => {
      const writes = [createRecord("dealerDocuments", {
        dealerEmail: loginEmail,
        approvalRequestId: approval.id,
        onboardingRequestId: onboardingRequest.id,
        type: document.type,
        fileName: document.fileName,
        size: document.size,
        status: "pending-verification",
      })];
      if (document.documentType || document.storagePath || document.fileUrl) {
        writes.push(upsertRecord("dealerRegistrationDocuments", `${req.body.dealerUid || loginEmail}:${document.documentType || document.type}`, {
          dealerUid: req.body.dealerUid || pendingAccount.uid || loginEmail,
          documentType: document.documentType || document.type,
          fileName: document.fileName,
          fileUrl: document.fileUrl || "",
          storagePath: document.storagePath || "",
          uploadedAt: now,
          verified: false,
        }, { readback: false }));
      }
      await Promise.all(writes);
    }));

    await incrementDealerCounters({ totalDealerships: 1, pendingDealerships: 1 });
    const dealerEvent = {
      dealerId: loginEmail,
      dealerName: dealership.dealershipName,
      dealerBrand: dealership.dealershipBrand,
      dealerState: state,
      dealerLocation: city,
      dealerStatus: "pending",
      monthlySalesCapacity: dealership.monthlyCarSalesCapacity,
    };
    recordMonitoringSignal("DEALER-CREATED", {
      dealerId: loginEmail,
      dealerBrand: dealership.dealershipBrand,
      state,
      location: city,
      monthlySalesCapacity: dealership.monthlyCarSalesCapacity,
    });
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.DEALER_CREATED,
      actor: req.user || null,
      data: {
        dealershipId: loginEmail,
        publicDealerCatalog: true,
        dealerEvent,
      },
    });
    await writeAuditLog({
      req,
      actionType: AUDIT_ACTIONS.REGISTRATION_COMPLETED,
      targetEntity: "dealershipRegistration",
      targetId: approval.id,
      newValue: { status: "pending", selectedPlan },
      meta: { dealershipId: loginEmail, onboardingRequestId: onboardingRequest.id, selectedPlan },
    });

    res.status(201).json({
      message: "Your dealership onboarding request has been submitted successfully. CarLoanSaathi verification team will review your application shortly.",
      status: "pending",
      onboardingRequestId: onboardingRequest.id,
      approvalRequestId: approval.id,
      selectedPlan,
    });
  } catch (error) {
    next(error);
  }
}

export async function createDealerLead(req, res, next) {
  try {
    const { email, dealershipEmail, dealership } = await financeDeskContext(req);
    logInfo("Finance Desk lead creation requested", { requestId: req.requestId, dealershipId: dealershipEmail });

    const dealershipId = dealership.id || dealershipEmail;
    const dealerBrand = dealership.dealershipBrand || dealership.brand || req.body.selectedBrand || req.body.carBrand;

    // ===== NEW WORKFLOW: MANDATORY BRANCH SELECTION =====
    // Get IFSC code from request - REQUIRED
    const ifscCode = String(req.body.ifscCode || req.body.bankBranchId || req.body.branchId || "").trim().toUpperCase();
    if (!ifscCode) {
      return res.status(400).json({ 
        message: "Bank branch selection is required",
        code: "IFSC_CODE_REQUIRED"
      });
    }

    // Validate IFSC format
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
      return res.status(400).json({ 
        message: "Invalid IFSC code format",
        code: "INVALID_IFSC_FORMAT"
      });
    }

    // Validate that dealership has this tie-up
    let branchTieUp;
    try {
      branchTieUp = await validateBranchTieUp(dealershipId, ifscCode);
    } catch (error) {
      return res.status(400).json({ 
        message: "Selected bank branch is not tied up with your dealership",
        code: "BRANCH_NOT_TIEDUP"
      });
    }

    // Validate salesperson
    const salespersonId = salespersonIdFrom(req.body.salespersonId);
    if (!salespersonId) {
      return res.status(400).json({ message: "Salesperson selection is required" });
    }

    const financeManagerId = financeManagerIdFrom(req.body.financeManagerId);
    if (!financeManagerId) {
      return res.status(400).json({ message: "Finance Manager selection is required" });
    }
    let salesperson;
    let financeManager;
    try {
      ({ salesperson, financeManager } = await validateDealerLeadAssignees({ salespersonId, financeManagerId, dealershipId }));
    } catch (error) {
      return res.status(error.status || 400).json({ message: error.message });
    }

    // Normalize and validate lead data
    const payload = normalizeFinanceDeskLead({ 
      ...req.body, 
      selectedBrand: dealerBrand,
      carBrand: dealerBrand,
      ifscCode,
      branchIfsc: ifscCode,
      branchId: branchTieUp.bankId || branchTieUp.id || ifscCode,
      bankBranchId: branchTieUp.bankId || branchTieUp.id || ifscCode,
      bankId: branchTieUp.bankId,
      bankName: branchTieUp.bankName,
      branchName: branchTieUp.branchName,
      branchLocation: branchTieUp.branchLocation || branchTieUp.bankBranchLocation || branchTieUp.city || branchTieUp.branchCity || "",
      state: branchTieUp.state || dealership.state || "",
      salespersonId,
      assignedSalesperson: salesperson.name,
      financeManagerId: financeManager?.id || "",
      financeManagerName: financeManager?.name || "",
      assignedFinanceManager: financeManager?.name || "Unassigned",
    });

    const dealershipCity = dealership.city || dealership.registeredCity || payload.city;
    const bankBranchCity = branchTieUp.city || branchTieUp.branchCity || branchTieUp.bankBranchCity || branchTieUp.branchName || dealershipCity;
    const now = new Date().toISOString();
    const caseId = await generateLeadCaseId();

    // Create lead with new fields
    const leadPayload = sanitizeFirestoreData({
      ...payload,
      caseId,
      selectedBrand: dealerBrand,
      carBrand: dealerBrand,
      carOnRoadPrice: payload.carPrice,
      requiredLoanAmount: payload.loanAmount,
      
      // Dealership scope
      dealerEmail: dealershipId,
      dealershipEmail: dealershipId,
      dealershipId,
      dealershipName: dealership.dealershipName || dealership.name || "",
      dealershipCity,
      routingCity: bankBranchCity,
      
      // Bank branch (new requirement)
      ifscCode,
      branchIfsc: ifscCode,
      bankIfsc: ifscCode,
      branchId: branchTieUp.bankId || branchTieUp.id || ifscCode,
      bankBranchId: branchTieUp.bankId || branchTieUp.id || ifscCode,
      bankBranchCity,
      branchCity: bankBranchCity,
      branchLocation: bankBranchCity,
      bankBranchLocation: bankBranchCity,
      state: branchTieUp.state || dealership.state || "",
      bankId: branchTieUp.bankId,
      bankName: branchTieUp.bankName,
      branchName: branchTieUp.branchName,
      assignedBankId: branchTieUp.bankId,
      assignedPartnerId: branchTieUp.bankId,
      assignedBankName: branchTieUp.bankName,
      assignedBankIfsc: ifscCode,
      selectedBankName: branchTieUp.bankName,
      selectedBranchName: branchTieUp.branchName,
      selectedBankBranchId: branchTieUp.bankId || branchTieUp.id || ifscCode,
      
      // Salesperson
      salespersonId: salesperson.id,
      salespersonName: salesperson.name,
      salespersonJobId: salesperson.jobId || "",
      salespersonEmail: salesperson.email || "",
      assignedSalesperson: salesperson.name,

      // Finance Manager ownership
      financeManagerId: financeManager?.id || "",
      financeManagerName: financeManager?.name || "",
      financeManagerMobile: financeManager?.mobile || "",
      financeManagerEmail: financeManager?.email || "",
      financeManagerEmployeeId: financeManager?.employeeId || "",
      assignedFinanceManager: financeManager?.name || "Unassigned",
      
      // Metadata
      createdBy: dealershipId,
      source: "Dealer Dashboard",
      status: LEAD_STATUSES.NEW,
      generatedDate: now.slice(0, 10),
      generatedTime: now.slice(11, 19),
      generatedAt: now,
    });

    const lead = await createRecord("leads", leadPayload);
    clearLeadSyncCaches(lead.id);

    runDealerLeadSideEffects("dealer-lead-created", [
      () => syncLeadProjectionSoon(lead),
      () => writeAuditLog({
        req,
        actionType: AUDIT_ACTIONS.LEAD_CREATED,
        newValue: { caseId: lead.caseId, customerName: lead.fullName, ifscCode },
        leadId: lead.id,
        dealershipId,
        meta: { caseId: lead.caseId, dealershipId, ifscCode, bankName: branchTieUp.bankName },
      }),
      () => addTimelineEvent({
        leadId: lead.id,
        eventType: TIMELINE_EVENTS.LEAD_CREATED,
        title: "Lead Created",
        description: `Finance Desk created lead - ${branchTieUp.bankName} ${branchTieUp.branchName}`,
        actorName: email,
        actorRole: req.user?.role || "finance-desk",
        dealershipId,
        branchId: branchTieUp.bankId,
        metadata: { 
          customerName: lead.fullName, 
          dealershipName: lead.dealershipName,
          ifscCode,
          bankName: branchTieUp.bankName,
          branchName: branchTieUp.branchName,
        },
      }),
    ]);

    runDealerLeadSideEffects("dealer-lead-auto-assignment", [
      async () => {
        try {
          const assignedLead = await reassignLeadToNextBranchExecutive(lead.id, "lead-created-auto-assignment", email);
          clearLeadSyncCaches(assignedLead.id || lead.id);
          await queueLeadAssignedWhatsApp(assignedLead);
        } catch (assignmentError) {
          logInfo("Dealer lead created without executive auto-assignment", {
            requestId: req.requestId,
            leadId: lead.id,
            caseId: lead.caseId,
            dealershipId,
            bankId: branchTieUp.bankId,
            ifscCode,
            reason: assignmentError.message,
          });
        }
      },
    ]);

    logInfo("Finance Desk lead created", { 
      requestId: req.requestId, 
      leadId: lead.id, 
      caseId: lead.caseId, 
      dealershipId,
      ifscCode,
    });
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.LEAD_CREATED,
      lead,
      actor: req.user,
      data: { dealershipId, bankId: lead.bankId || branchTieUp.bankId },
    });

    res.status(201).json({ 
      success: true,
      leadId: lead.id, 
      caseId: lead.caseId, 
      message: "Lead created successfully", 
      lead,
    });
  } catch (error) {
    if (error?.issues) {
      return res.status(400).json({ message: readableLeadError(error) });
    }
    next(error);
  }
}

export async function getDealerLeads(req, res, next) {
  const startedAt = Date.now();
  const requestStartedAt = Number(res.locals.startedAt || startedAt);
  let authStarted, authEnded, queryStarted, queryEnded;
  let projectionStarted, projectionEnded, fallbackStarted, fallbackEnded;
  let projectionError = null;
  let fallbackTriggered = false;
  try {
    authStarted = Date.now();
    const { dealershipEmail } = await financeDeskContext(req);
    authEnded = Date.now();
    queryStarted = Date.now();
    projectionStarted = Date.now();
    const projectionPage = await queryLeadProjectionForUser({
      user: { ...req.user, role: "finance-desk", dealershipId: dealershipEmail },
      query: req.query,
      requestId: req.requestId,
    }).catch((error) => {
      projectionError = error;
      return null;
    });
    projectionEnded = Date.now();
    let page = projectionPage;
    if (!page) {
      fallbackTriggered = true;
      fallbackStarted = Date.now();
      page = await queryDealershipLeads({ dealershipId: dealershipEmail, query: req.query, requestId: req.requestId });
      fallbackEnded = Date.now();
    }
    queryEnded = Date.now();
    const rowCount = Array.isArray(page?.data) ? page.data.length : 0;
    const fieldCounts = Array.isArray(page?.data) ? page.data.map((item) => Object.keys(item || {}).length) : [];
    const maxFieldCount = fieldCounts.length ? Math.max(...fieldCounts) : 0;
    const totalFieldCount = fieldCounts.reduce((sum, count) => sum + count, 0);
    logInfo("Dealer leads serialization breakdown", {
      tag: "SERIALIZATION-LATENCY",
      requestId: req.requestId,
      path: req.originalUrl,
      function: "getDealerLeads",
      file: "backend/controllers/dealer.controller.js",
      responseShapeDurationMs: 0,
      leadEnrichmentDurationMs: 0,
      financeManagerLookupCount: 0,
      executiveLookupCount: 0,
      dealershipLookupCount: 0,
      documentFormattingCount: 0,
      jsonStringifyDurationMs: 0,
      jsonParseDurationMs: 0,
      rowCount,
      totalFieldCount,
      maxFieldCount,
      responseBytes: null,
      fallbackTriggered,
      projectionDurationMs: projectionEnded - projectionStarted,
      fallbackDurationMs: fallbackTriggered ? fallbackEnded - fallbackStarted : 0,
      controllerDurationMs: Date.now() - startedAt,
      totalDurationMs: Date.now() - requestStartedAt,
    });
    logInfo("Dealer leads latency breakdown", {
      tag: "PROJECTION-LATENCY",
      requestId: req.requestId,
      path: req.originalUrl,
      role: req.user?.role,
      authDurationMs: startedAt - requestStartedAt,
      financeContextDurationMs: authEnded - authStarted,
      projectionDurationMs: projectionEnded - projectionStarted,
      projectionResultCount: Array.isArray(projectionPage?.data) ? projectionPage.data.length : 0,
      projectionError: projectionError ? projectionError.code || projectionError.message : null,
      fallbackTriggered,
      fallbackDurationMs: fallbackTriggered ? fallbackEnded - fallbackStarted : 0,
      fallbackResultCount: fallbackTriggered && Array.isArray(page?.data) ? page.data.length : 0,
      queryDurationMs: queryEnded - queryStarted,
      serializationDurationMs: 0,
      controllerDurationMs: Date.now() - startedAt,
      totalDurationMs: Date.now() - requestStartedAt,
      responseBytes: null,
    });
    logInfo("Dealer lead query completed", {
      requestId: req.requestId,
      path: req.originalUrl,
      role: req.user?.role,
      totalMs: Date.now() - startedAt,
      authMs: authEnded - authStarted,
      queryMs: queryEnded - queryStarted,
      serializeMs: 0,
      warmup: String(req.headers["x-cls-warmup"] || "").toLowerCase() === "true",
      dataCount: Array.isArray(page?.data) ? page.data.length : undefined,
    });
    res.json(page);
  } catch (error) {
    next(error);
  }
}

export async function getDealerSalespersons(req, res, next) {
  try {
    const { dealershipEmail } = await financeDeskContext(req);
    const includeInactive = String(req.query.includeInactive || "") === "true";
    const salespersons = (await findRecordsByField("salespersons", "dealershipId", dealershipEmail, 100))
      .filter((person) => includeInactive || person.active !== false)
      .map((person) => ({
        id: person.id,
        name: person.name,
        mobile: person.mobile,
        jobId: person.jobId,
        email: person.email,
        dealershipId: person.dealershipId,
        dealershipName: person.dealershipName,
        dealershipLocation: person.dealershipLocation,
        active: person.active !== false,
      }));
    res.json(salespersons);
  } catch (error) {
    next(error);
  }
}

export async function getDealerFinanceManagers(req, res, next) {
  try {
    const { dealershipEmail } = await financeDeskContext(req);
    const includeInactive = String(req.query.includeInactive || "") === "true";
    const page = await queryRecords("financeManagers", {
      where: [{ field: "dealershipId", value: dealershipEmail }],
      orderBy: "createdAt",
      direction: "desc",
      limit: 100,
      maxLimit: 100,
      search: req.query.search,
      searchFields: ["name", "email", "mobile", "employeeId"],
    });
    const managers = page.data
      .filter((manager) => includeInactive || manager.active !== false)
      .map(financeManagerRow);
    res.json(managers);
  } catch (error) {
    next(error);
  }
}

export async function createDealerFinanceManager(req, res, next) {
  try {
    const { dealershipEmail, dealership } = await financeDeskContext(req);
    const name = required(req.body.name || req.body.financeManagerName, "Finance Manager name");
    const mobile = required(req.body.mobile, "Mobile number").replace(/\D/g, "");
    const email = required(req.body.email, "Email ID").toLowerCase();
    const employeeId = required(req.body.employeeId, "Employee ID");
    if (!/^\d{10}$/.test(mobile)) return res.status(400).json({ message: "Enter valid 10-digit mobile number" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter valid email address" });
    const existing = await queryRecords("financeManagers", {
      where: [{ field: "dealershipId", value: dealershipEmail }],
      limit: 100,
      maxLimit: 100,
    });
    const duplicate = existing.data.find((manager) =>
      manager.active !== false
      && (String(manager.email || "").toLowerCase() === email || String(manager.employeeId || "").toLowerCase() === employeeId.toLowerCase())
    );
    if (duplicate) return res.status(409).json({ message: "Active Finance Manager with this email or employee ID already exists" });
    const now = new Date().toISOString();
    const manager = await createRecord("financeManagers", {
      name,
      mobile,
      email,
      employeeId,
      dealershipId: dealershipEmail,
      dealershipEmail,
      dealershipName: dealership.dealershipName || dealership.name || "",
      active: req.body.active === false ? false : true,
      status: req.body.active === false ? "Inactive" : "Active",
      createdBy: dealerEmail(req),
      createdAt: now,
      updatedAt: now,
    });
    clearCachedValue("dealer:finance-managers:");
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.FINANCE_MANAGER_CHANGED,
      actor: req.user,
      data: { dealershipId: dealershipEmail, financeManagerId: manager.id, action: "created" },
    });
    res.status(201).json(financeManagerRow(manager));
  } catch (error) {
    next(error);
  }
}

export async function updateDealerFinanceManager(req, res, next) {
  try {
    const { dealershipEmail } = await financeDeskContext(req);
    const manager = await getRecord("financeManagers", req.params.id);
    if (!manager || manager.dealershipId !== dealershipEmail) return res.status(404).json({ message: "Finance Manager not found" });
    const nextActive = req.body.active !== undefined ? req.body.active === true : String(req.body.status || "").toLowerCase() !== "inactive";
    const updated = await updateRecord("financeManagers", manager.id, {
      active: nextActive,
      status: nextActive ? "Active" : "Inactive",
      updatedAt: new Date().toISOString(),
    });
    clearCachedValue("dealer:finance-managers:");
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.FINANCE_MANAGER_CHANGED,
      actor: req.user,
      data: { dealershipId: dealershipEmail, financeManagerId: updated.id, action: nextActive ? "activated" : "deactivated" },
    });
    res.json(financeManagerRow(updated));
  } catch (error) {
    next(error);
  }
}

export async function deleteDealerFinanceManager(req, res, next) {
  try {
    const { dealershipEmail } = await financeDeskContext(req);
    const manager = await getRecord("financeManagers", req.params.id);
    if (!manager || manager.dealershipId !== dealershipEmail) return res.status(404).json({ message: "Finance Manager not found" });

    await deleteRecord("financeManagers", manager.id);
    clearCachedValue("dealer:finance-managers:");
    clearCachedValue("dealer:leads:");
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.FINANCE_MANAGER_CHANGED,
      actor: req.user,
      data: { dealershipId: dealershipEmail, financeManagerId: manager.id, action: "deleted" },
    });
    await writeAuditLog({
      req,
      actionType: "FINANCE_MANAGER_PERMANENT_DELETE",
      targetEntity: "financeManagers",
      targetId: manager.id,
      oldValue: manager,
      meta: { dealershipId: dealershipEmail, email: manager.email || "" },
    });
    res.json({ message: "Finance Manager permanently deleted", financeManagerId: manager.id });
  } catch (error) {
    next(error);
  }
}

export async function getDealerStaff(req, res, next) {
  try {
    const { email, dealershipEmail, dealership } = await financeDeskContext(req);
    const { limit } = paginationParams({ ...req.query, limit: req.query.limit || 100 }, { defaultLimit: 100, maxLimit: 100 });
    logReadMetric("READS-BEFORE", req, { endpoint: "GET /api/dealer/staff", estimatedReads: 200 });
    const cacheKey = `dealer:staff:${dealershipEmail}:${JSON.stringify({ ...req.query, limit })}`;
    let cacheHit = true;
    const cachedStaff = await cached(cacheKey, 30000, async () => {
      cacheHit = false;
      const projected = await queryStaffViewProjection({ dealershipId: dealershipEmail, query: { ...req.query, limit } }).catch(() => null);
      if (Array.isArray(projected)) {
        logProjectionRead("PROJECTION-HIT", req, { collection: "staffViewProjection", resultCount: projected.length });
        return projected;
      }
      logProjectionRead("PROJECTION-MISS", req, { collection: "staffViewProjection", reason: "missing_staff_projection" });
      const staff = await buildDealerStaffRows(dealershipEmail, dealership, email);
      staff.forEach((row) => syncStaffViewProjectionSoon({ ...row, dealershipId: dealershipEmail, dealershipEmail }));
      return staff.slice(0, limit);
    });
    if (cacheHit) logReadMetric("CACHE-HIT", req, { endpoint: "GET /api/dealer/staff", cacheKey });
    logReadMetric("READS-AFTER", req, { endpoint: "GET /api/dealer/staff", estimatedReads: cacheHit ? 0 : Math.min(limit, cachedStaff.length || limit), limit });
    return res.json(cachedStaff);
  } catch (error) {
    next(error);
  }
}

function optionalText(value) {
  return String(value || "").trim();
}

function optionalEmail(value) {
  return optionalText(value).toLowerCase();
}

async function incrementDealerCounters(increments = {}) {
  return incrementRecord("metrics", "global", increments, {
    totalDealerships: 0,
    approvedDealerships: 0,
    pendingDealerships: 0,
    disabledDealerships: 0,
    activeDealerships: 0,
    updatedAt: new Date().toISOString(),
  }).catch(() => null);
}

export async function getDealerStaffDetail(req, res, next) {
  try {
    const { email, dealershipEmail, dealership } = await financeDeskContext(req);
    const staffId = decodeURIComponent(req.params.id || "");
    const employee = await findDealerStaffEmployee({
      dealershipEmail,
      dealership,
      currentEmail: email,
      identifier: staffId,
    });
    if (!employee) return res.status(404).json({ message: "Employee not found" });
    res.json(employee);
  } catch (error) {
    next(error);
  }
}

export async function getDealerBankTieUps(req, res, next) {
  try {
    const { dealershipEmail, dealership } = await financeDeskContext(req);
    
    // Get dealership's current tie-ups
    const currentTieUps = await getDealershipBankTieUps(dealership.id || dealershipEmail);
    
    // Get all available banks (dynamic - always fresh)
    const availableBanks = await getAvailableBankBranches();

    res.json({
      dealershipId: dealership.id || dealershipEmail,
      currentTieUps: currentTieUps || [],
      branchTieUps: currentTieUps || [],
      availableBanks: availableBanks || [],
      availableBranches: availableBanks || [],
      totalAvailable: availableBanks?.length || 0,
      totalTiedUp: currentTieUps?.length || 0,
    });
  } catch (error) {
    logError("Dealer bank tie-up load failed", {
      requestId: req.requestId,
      userEmail: dealerEmail(req),
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    next(error);
  }
}

export async function updateDealerBankTieUps(req, res, next) {
  try {
    const { dealershipEmail, dealership } = await financeDeskContext(req);
    const dealershipId = dealership.id || dealershipEmail;

    // Get the requested IFSC codes
    const requestedTieUps = req.body.bankTieUps || req.body.dealershipBankPartners || req.body.bankBranchIds || [];
    const ifscCodes = Array.isArray(requestedTieUps)
      ? requestedTieUps.map((item) => (typeof item === "string" ? item : item.ifscCode || item.bankIfsc || item.id))
      : [];

    // Update the bank tie-ups
    const result = await updateDealershipBankTieUps(dealershipId, ifscCodes, req);

    // Audit log
    await writeAuditLog({
      req,
      actionType: "BANK_TIEUPS_UPDATED",
      newValue: { count: ifscCodes.length },
      targetEntity: "dealership",
      targetId: dealershipId,
      dealershipId,
      meta: { ifscCodes },
    });

    res.json({
      success: true,
      message: "Bank tie-ups updated successfully",
      dealershipId,
      bankTieUps: result.bankTieUps,
      branchTieUps: result.bankTieUps,
      updatedAt: result.updatedAt,
    });
  } catch (error) {
    logError("Dealer bank tie-up update failed", {
      requestId: req.requestId,
      userEmail: dealerEmail(req),
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    next(error);
  }
}

export async function createDealerStaff(req, res, next) {
  try {
    const { dealershipEmail, dealership } = await financeDeskContext(req);
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });
    const fullName = required(req.body.fullName || req.body.name, "Full name");
    const email = required(req.body.email || req.body.officialEmail, "Official email").toLowerCase();
    const mobile = required(req.body.mobile, "Mobile number");
    const employeeId = required(req.body.employeeId || req.body.jobId, "Employee ID");
    const role = normalizeStaffRole(req.body.role);
    if (role !== "gm") return res.status(400).json({ message: "Only the GM role can be created." });
    if (!/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ message: "Enter a valid 10-digit mobile number" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Enter a valid official email" });

    const existingStaff = (await findRecordsByField("dealerStaff", "dealershipId", dealershipEmail, 100)).filter((item) => item.active !== false);
    if (existingStaff.some((item) => item.email === email)) return res.status(409).json({ message: "Official email already exists for this dealership" });
    if (existingStaff.some((item) => item.mobile === mobile)) return res.status(409).json({ message: "Mobile number already exists for this dealership" });
    if (existingStaff.some((item) => String(item.employeeId || "").toLowerCase() === employeeId.toLowerCase())) return res.status(409).json({ message: "Employee ID already exists for this dealership" });
    const existingUser = await getRecord("users", email).catch(() => null);
    const existingUserActive = existingUser && existingUser.active !== false && existingUser.accountActive !== false;
    const sameDealershipUser = existingUser
      && (existingUser.dealershipId === dealershipEmail || existingUser.dealershipEmail === dealershipEmail);
    if (existingUserActive && !sameDealershipUser) {
      return res.status(409).json({ message: "This email belongs to another active account" });
    }
    if (existingUserActive && sameDealershipUser && !["finance-desk", "gm"].includes(normalizeStaffRole(existingUser.role))) {
      return res.status(409).json({ message: "This email belongs to another active role" });
    }

    const now = new Date().toISOString();
    const city = String(req.body.city || req.body.branch || dealership.city || dealership.registeredCity || "").trim();
    const branch = String(req.body.branch || city || dealership.dealershipName || "").trim();
    const dealershipName = dealership.dealershipName || dealership.name || "";
    const temporaryPassword = generateTemporaryPassword();
    const temporaryPasswordHash = hashTemporaryPassword(temporaryPassword);
    let firebaseUser;
    try {
      firebaseUser = await firebaseAdmin.auth().createUser({
        email,
        password: temporaryPassword,
        displayName: fullName,
        emailVerified: true,
        disabled: false,
      });
    } catch (firebaseError) {
      if (firebaseError.code === "auth/email-already-exists") {
        firebaseUser = await firebaseAdmin.auth().getUserByEmail(email);
        await assertNoActiveIdentityCollision({ uid: firebaseUser.uid, email, role, excludeIds: [] });
        await firebaseAdmin.auth().updateUser(firebaseUser.uid, {
          password: temporaryPassword,
          displayName: fullName,
          emailVerified: true,
          disabled: false,
        });
      } else {
        throw firebaseError;
      }
    }
    await assertNoActiveIdentityCollision({ uid: firebaseUser.uid, email, role, excludeIds: [] });

    const roleLabel = staffRoleLabel(role);
    const portalType = "finance";
    const accountType = role === "finance-desk" ? "finance-head" : "dealership-management";
    const staffPayload = {
      id: email,
      uid: firebaseUser.uid,
      fullName,
      name: fullName,
      email,
      officialEmail: email,
      mobile,
      employeeId,
      role,
      roleLabel,
      portalType,
      accountType,
      dealershipId: dealershipEmail,
      dealershipEmail,
      dealershipName,
      branch,
      branchId: branch,
      city,
      createdByDealerAdmin: true,
      createdByDealerAdminId: dealerEmail(req),
      firstLoginRequired: true,
      temporaryPasswordRequired: true,
      temporaryPasswordHash,
      temporaryPasswordIssuedAt: now,
      passwordChangedAt: null,
      status: "active",
      active: true,
      approved: true,
      accountApproved: true,
      accountActive: true,
      createdAt: now,
    };
    await upsertRecord("dealerStaff", email, staffPayload);
    if (role === "finance-desk") {
      await upsertRecord("financeDesks", email, {
        ...staffPayload,
        headName: fullName,
        officialEmail: email,
      });
    } else {
      await upsertRecord("dealershipManagers", email, {
        ...staffPayload,
        dealershipEmail,
      });
    }
    await upsertCanonicalUser(firebaseUser.uid, {
      name: fullName,
      fullName,
      uid: firebaseUser.uid,
      email,
      officialEmail: email,
      mobile,
      employeeId,
      role,
      portalType,
      accountType,
      approved: true,
      active: true,
      accountApproved: true,
      accountActive: true,
      dealershipId: dealershipEmail,
      dealershipName,
      branch,
      branchId: branch,
      city,
      state: dealership.state || dealership.dealerState || "",
      address: dealership.address || "",
      createdAt: now,
      firstLoginRequired: true,
      temporaryPasswordRequired: true,
      temporaryPasswordHash,
      temporaryPasswordIssuedAt: now,
      passwordChangedAt: null,
      createdByDealerAdmin: true,
      createdByDealerAdminId: dealerEmail(req),
      status: "active",
    });
    await firebaseAdmin.auth().setCustomUserClaims(firebaseUser.uid, {
      role,
      approved: true,
      active: true,
      dealershipId: dealershipEmail,
      portalType,
      accountType,
    });
    await writeAuditLog({ req, actionType: "DEALER_STAFF_CREATED", newValue: employeeId, meta: { staffEmail: email, role, dealershipId: dealershipEmail } });
    syncStaffViewProjectionSoon(staffPayload);
    const { temporaryPasswordHash: _temporaryPasswordHash, ...safeStaffPayload } = staffPayload;
    res.status(201).json({
      ...safeStaffPayload,
      portalLogin: `${process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || "https://carloansaathi.com"}/gm/login`,
      temporaryPassword,
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteDealerStaff(req, res, next) {
  try {
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });
    const { email: actorEmail, dealershipEmail, dealership } = await financeDeskContext(req);
    const staffId = decodeURIComponent(req.params.id || "");
    const employee = await findDealerStaffEmployee({
      dealershipEmail,
      dealership,
      currentEmail: actorEmail,
      identifier: staffId,
    });
    if (!employee) return res.status(404).json({ message: "Employee not found" });

    const email = staffEmail(employee.email);
    if (!email) return res.status(409).json({ message: "Employee email mapping is missing. Repair the staff record before deletion." });
    if (email === staffEmail(dealershipEmail) || email === staffEmail(actorEmail) || employee.protected === true) {
      return res.status(400).json({ message: "Primary Finance Desk account cannot be removed from Manage Staff." });
    }
    const emailMatches = (item) => staffEmail(item.email || item.officialEmail || item.id) === email;
    const deleted = {};

    for (const collection of ["dealerStaff", "financeDesks", "financeDesk", "dealershipManagers", "users"]) {
      deleted[collection] = await deleteDealerStaffCollectionRecords(collection, {
        employee,
        dealershipEmail,
        email,
      });
    }
    for (const collection of ["loginActivity", "authAuditLogs", "notifications"]) {
      deleted[collection] = await deleteMatchingRecords(collection, (item) =>
        emailMatches(item)
        || staffEmail(item.recipientId || item.userEmail || item.actorEmail || item.createdBy || item.updatedBy) === email
      , [
        [{ field: "email", value: email }],
        [{ field: "recipientId", value: email }],
        [{ field: "userEmail", value: email }],
        [{ field: "actorEmail", value: email }],
        [{ field: "createdBy", value: email }],
        [{ field: "updatedBy", value: email }],
      ]);
    }
    deleted.staffViewProjection = await deleteRecordsByQuery("staffViewProjection", {
      where: [{ field: "dealershipId", value: dealershipEmail }, { field: "email", value: email }],
    }).catch(() => 0);
    clearCachedValue(`dealer:staff:${dealershipEmail}:`);

    await revokeUserSessions(email, "dealer-staff-permanent-delete").catch(() => {});
    let authDeleted = false;
    try {
      const firebaseUser = await firebaseAdmin.auth().getUserByEmail(email);
      await firebaseAdmin.auth().deleteUser(firebaseUser.uid);
      authDeleted = true;
    } catch (firebaseError) {
      if (firebaseError.code !== "auth/user-not-found") throw firebaseError;
    }

    await writeAuditLog({
      req,
      actionType: "DEALER_STAFF_PERMANENT_DELETE",
      targetEntity: "dealerStaff",
      targetId: email,
      oldValue: employee,
      meta: { dealershipId: dealershipEmail, deleted, authDeleted },
    });
    res.json({ message: "Employee permanently removed", employeeEmail: email, deleted, authDeleted });
  } catch (error) {
    next(error);
  }
}

export async function createDealerSalesperson(req, res, next) {
  try {
    const { dealershipEmail, dealership } = await financeDeskContext(req);
    const name = required(req.body.name || req.body.salespersonName, "Salesperson name");
    const mobile = required(req.body.mobile, "Mobile number");
    const jobId = required(req.body.jobId || req.body.employeeId, "Job ID");
    const email = required(req.body.email || req.body.mailId, "Mail ID").toLowerCase();
    if (!/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ message: "Enter a valid 10-digit mobile number" });

    const existing = (await findRecordsByField("salespersons", "dealershipId", dealershipEmail, 100)).filter((person) => person.active !== false);
    if (existing.some((person) => person.mobile === mobile)) return res.status(409).json({ message: "Mobile number already exists for this dealership" });
    if (existing.some((person) => String(person.jobId || "").toLowerCase() === jobId.toLowerCase())) return res.status(409).json({ message: "Job ID already exists for this dealership" });
    if (existing.some((person) => String(person.email || "").toLowerCase() === email)) return res.status(409).json({ message: "Mail ID already exists for this dealership" });

    const salesperson = await createRecord("salespersons", {
      name,
      mobile,
      jobId,
      email,
      dealershipId: dealershipEmail,
      dealershipName: dealership.dealershipName || dealership.name || "",
      dealershipLocation: dealership.city || dealership.registeredCity || "",
      active: true,
      status: "active",
    });
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.SALESPERSON_CHANGED,
      actor: req.user,
      data: { dealershipId: dealershipEmail, salespersonId: salesperson.id, action: "created" },
    });
    res.status(201).json(salesperson);
  } catch (error) {
    next(error);
  }
}

export async function removeDealerSalesperson(req, res, next) {
  try {
    const { dealershipEmail } = await financeDeskContext(req);
    const salesperson = await getRecord("salespersons", req.params.id);
    if (!salesperson || salesperson.dealershipId !== dealershipEmail) return res.status(404).json({ message: "Salesperson not found" });
    await deleteRecord("salespersons", salesperson.id);
    await deleteRecordsByQuery("salespersonSummaryProjection", {
      where: [{ field: "dealershipId", value: dealershipEmail }, { field: "salespersonId", value: salesperson.id }],
    }).catch(() => 0);
    clearCachedValue("gm:salespersons:");
    clearCachedValue("dealer:leads:");
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.SALESPERSON_CHANGED,
      actor: req.user,
      data: { dealershipId: dealershipEmail, salespersonId: salesperson.id, action: "deleted" },
    });
    await writeAuditLog({
      req,
      actionType: "SALESPERSON_PERMANENT_DELETE",
      targetEntity: "salespersons",
      targetId: salesperson.id,
      oldValue: salesperson,
      meta: { dealershipId: dealershipEmail, email: salesperson.email || "" },
    });
    res.json({ message: "Salesperson permanently deleted", salespersonId: salesperson.id });
  } catch (error) {
    next(error);
  }
}

export async function getDealerLead(req, res, next) {
  try {
    const { email, dealershipEmail } = await financeDeskContext(req);
    const projection = await getLeadDetailProjection(req.params.id).catch(() => null);
    if (projection && dealerCanReadProjectedLead(projection, email, dealershipEmail) && Array.isArray(projection.bankDocuments)) {
      logProjectionRead("PROJECTION-HIT", req, { collection: "leadDetailsProjection", leadId: req.params.id });
      return res.json(leadDetailResponseFromProjection(projection, { bankDocuments: projection.bankDocuments || [] }));
    }
    logProjectionRead("PROJECTION-MISS", req, {
      collection: "leadDetailsProjection",
      leadId: req.params.id,
      reason: projection ? "invalid_or_unauthorized_projection" : "missing_projection",
    });
    logProjectionRead("CANONICAL-FALLBACK", req, { collection: "leads", leadId: req.params.id });
    const lead = await getRecord("leads", req.params.id);
    if (!lead || !owned([lead], email, dealershipEmail).length) return res.status(404).json({ message: "Lead not found" });
    const bankDocumentsPage = await queryRecords("bankDocuments", {
      where: [{ field: "leadId", value: lead.id }],
      orderBy: "createdAt",
      direction: "desc",
      limit: 50,
      maxLimit: 50,
    }).catch(() => ({ data: [] }));
    res.json({ ...lead, bankDocuments: bankDocumentsPage.data || [] });
  } catch (error) {
    next(error);
  }
}

export async function getDealerEarnings(req, res, next) {
  try {
    const { dealershipEmail } = await financeDeskContext(req);
    const projected = await queryLeadProjectionForUser({
      user: { ...req.user, role: "finance-desk", dealershipId: dealershipEmail },
      query: { limit: 100 },
      requestId: req.requestId,
      recordMetrics: false,
    }).catch(() => null);
    let leads;
    if (projected?.data) {
      logProjectionRead("PROJECTION-HIT", req, { collection: "financeViews", resultCount: projected.data.length });
      leads = projected.data;
    } else {
      logProjectionRead("PROJECTION-MISS", req, { collection: "financeViews", reason: "missing_projection_page" });
      logProjectionRead("CANONICAL-FALLBACK", req, { collection: "leads", estimatedLimit: 100 });
      leads = (await queryDealershipLeads({ dealershipId: dealershipEmail, query: { limit: 100 } })).data;
    }
    const disbursed = leads.filter((lead) => normalizeStatus(lead.status) === LEAD_STATUSES.DISBURSED);
    const approved = leads.filter((lead) => normalizeStatus(lead.status) === LEAD_STATUSES.APPROVED);
    res.json({
      totalEarnings: disbursed.reduce((sum, lead) => sum + Math.round(Number(lead.loanAmount || 0) * 0.01), 0),
      pendingEarnings: approved.reduce((sum, lead) => sum + Math.round(Number(lead.loanAmount || 0) * 0.005), 0),
      disbursedCount: disbursed.length,
      approvedCount: approved.length,
    });
  } catch (error) {
    next(error);
  }
}

export async function getDealerProfile(req, res, next) {
  try {
    const { email, dealershipEmail, desk, dealership } = await financeDeskContext(req);
    if (dealership?.dealershipName || dealership?.dealershipBrand) {
      const safeDealership = stripRemovedDealershipFields(dealership);
      return res.json({
        email,
        dealershipId: dealershipEmail,
        dealershipCity: safeDealership.city || safeDealership.registeredCity || desk?.city || "",
        dealershipBrand: safeDealership.dealershipBrand || safeDealership.brand || "",
        ...safeDealership,
        dealershipBankPartners: safeDealership.dealershipBankPartners || [],
        financeDesk: desk || null,
      });
    }
    const profile = await getRecord("dealerProfiles", email).catch(() => null)
      || (await findRecordsByField("dealerProfiles", "email", email, 3))[0]
      || {
      email,
      dealershipId: dealershipEmail,
      dealershipCity: desk?.city || "",
      dealershipName: "",
      contactPerson: "",
      city: "",
      mobile: "",
    };
    res.json(profile);
  } catch (error) {
    next(error);
  }
}

export async function updateDealerProfile(req, res, next) {
  try {
    const { email, dealershipEmail, dealership } = await financeDeskContext(req);
    const existing = await getRecord("dealerProfiles", email).catch(() => null)
      || (await findRecordsByField("dealerProfiles", "email", email, 3))[0]
      || null;
    const bankPartners = branchIdsFromRequest(req.body.dealershipBankPartners || req.body.bankBranchIds || req.body.bankBranchId || []);
    const payload = {
      email,
      dealershipEmail,
      dealershipName: String(req.body.dealershipName || "").trim(),
      contactPerson: String(req.body.contactPerson || "").trim(),
      city: String(req.body.city || "").trim(),
      mobile: String(req.body.mobile || "").trim(),
      dealershipBankPartners: bankPartners,
    };
    const profile = existing
      ? await updateRecord("dealerProfiles", existing.id, payload)
      : await createRecord("dealerProfiles", payload);
    await upsertRecord("dealers", dealershipEmail, { ...stripRemovedDealershipFields(dealership || {}), ...payload });
    await upsertRecord("dealerships", dealershipEmail, { ...stripRemovedDealershipFields(dealership || {}), ...payload });
    res.json({ message: "Dealer profile saved", profile });
  } catch (error) {
    next(error);
  }
}
