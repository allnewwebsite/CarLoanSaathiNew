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

export {
  createRecord,
  deleteRecord,
  deleteRecordsByQuery,
  findRecordsByField,
  getRecord,
  incrementRecord,
  listRecords,
  queryRecords,
  updateRecord,
  upsertRecord,
  firebaseAdmin,
  financeDeskLeadSchema,
  addTimelineEvent,
  TIMELINE_EVENTS,
  AUDIT_ACTIONS,
  writeAuditLog,
  LEAD_STATUSES,
  normalizeStatus,
  sanitizeFirestoreData,
  generateLeadCaseId,
  queryDealershipLeads,
  logError,
  logInfo,
  reassignLeadToNextBranchExecutive,
  getLeadDetailProjection,
  queryLeadProjectionForUser,
  queryStaffViewProjection,
  syncLeadProjectionSoon,
  syncStaffViewProjectionSoon,
  getAvailableBankBranches,
  getDealershipBankTieUps,
  addBankTieUp,
  removeBankTieUp,
  updateDealershipBankTieUps,
  validateBranchTieUp,
  crypto,
  revokeUserSessions,
  assertNoActiveIdentityCollision,
  upsertCanonicalUser,
  hashTemporaryPassword,
  cached,
  clearCachedValue,
  publishRealtimeEvent,
  REALTIME_EVENTS,
  paginationParams,
  recordMonitoringSignal,
  normalizeBankLocation,
  normalizeBankState,
  normalizeDealershipBrand,
  queueLeadAssignedWhatsApp,
  normalizeOnboardingPlan,
};

export function dealerEmail(req) {
  return req.user?.email || req.user?.firebase?.identities?.email?.[0] || req.user?.uid;
}

export async function financeDeskContext(req) {
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

export function owned(leads, email, dealershipEmail = email) {
  return leads.filter((lead) => lead.dealerEmail === dealershipEmail || lead.dealershipEmail === dealershipEmail || lead.createdBy === dealershipEmail || lead.dealerEmail === email || lead.createdBy === email);
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

export function dealerCanReadProjectedLead(lead, email, dealershipEmail) {
  return Boolean(
    lead
    && (
      lead.dealershipId === dealershipEmail
      || owned([lead], email, dealershipEmail).length
    )
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

export function salespersonIdFrom(value) {
  return String(value || "").trim();
}

export function financeManagerIdFrom(value) {
  return String(value || "").trim();
}

export async function validateDealerLeadAssignees({ salespersonId, financeManagerId, dealershipId }) {
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

export function clearLeadSyncCaches(leadId = "") {
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

export function branchIdsFromRequest(value) {
  const items = Array.isArray(value)
    ? value
    : String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  return [...new Set(items)];
}

export function required(value, label) {
  const text = String(value || "").trim();
  if (!text) {
    const error = new Error(`${label} is required`);
    error.status = 400;
    throw error;
  }
  return text;
}

export function requiredGstin(value) {
  const gstin = required(value, "GSTIN number").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    const error = new Error("Enter a valid 15-character GSTIN number");
    error.status = 400;
    throw error;
  }
  return gstin;
}

export function stripRemovedDealershipFields(dealership = {}) {
  const {
    officialDealershipEmail,
    ...rest
  } = dealership || {};
  return rest;
}

export function generateTemporaryPassword() {
  const digits = crypto.randomInt(1000, 10000);
  const suffix = "abcdefghijkmnopqrstuvwxyz".charAt(crypto.randomInt(0, 24));
  return `CLS@${digits}${suffix}`;
}

export function normalizeStaffRole(value) {
  const role = String(value || "").trim().toLowerCase();
  if (["finance-head", "finance head", "finance-desk", "finance desk"].includes(role)) return "finance-desk";
  if (["gm", "general manager"].includes(role)) return "gm";
  return "";
}

export function staffRoleLabel(role) {
  if (role === "finance-desk") return "Finance Head";
  return role === "gm" ? "GM" : "";
}

export function staffListRow(item) {
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

export function mergeStaffRows(existing = {}, incoming = {}) {
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

export function staffEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function uniqueRecords(records = []) {
  const byId = new Map();
  records.flat().filter(Boolean).forEach((item) => {
    const key = item.id || item.email || item.officialEmail || JSON.stringify(item);
    if (!byId.has(key)) byId.set(key, item);
  });
  return [...byId.values()];
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

export async function buildDealerStaffRows(dealershipEmail, dealership = {}, currentEmail = "") {
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

export function staffIdentifierMatches(item = {}, identifier = "") {
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

export async function findDealerStaffEmployee({ dealershipEmail, dealership, currentEmail, identifier }) {
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

export async function deleteDealerStaffCollectionRecords(collection, { employee, dealershipEmail, email }) {
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

export function runDealerLeadSideEffects(label, tasks = []) {
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

export async function liveDealerRegistrationForAccount(account) {
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

export async function assertDealerRegistrationEmailVerified({ uid, email }) {
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

export function dealerEmailPendingPayload({ registrationId, email, selectedPlan }) {
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

export function normalizeFinanceDeskLead(body) {
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

export function financeManagerRow(manager = {}) {
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

export function readableLeadError(error) {
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

export function normalizeFinanceStatus(status) {
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

export function optionalText(value) {
  return String(value || "").trim();
}

export function optionalEmail(value) {
  return optionalText(value).toLowerCase();
}

export async function incrementDealerCounters(increments = {}) {
  return incrementRecord("metrics", "global", increments, {
    totalDealerships: 0,
    approvedDealerships: 0,
    pendingDealerships: 0,
    disabledDealerships: 0,
    activeDealerships: 0,
    updatedAt: new Date().toISOString(),
  }).catch(() => null);
}

export const DEALER_SHARED_SENTINEL = true;
