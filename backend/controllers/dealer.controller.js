import { createRecord, deleteRecord, findRecordsByField, getRecord, listRecords, updateRecord, upsertRecord } from "../services/firestore.service.js";
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

const supportedDealerCities = new Set([
  "Bahadurgarh",
  "Jhajjar",
  "Rohtak",
  "Sonipat",
  "Beri",
  "Gurugram",
  "Jind",
  "Manesar",
  "Gohana",
  "Murthal",
  "Panipat",
]);

function dealerEmail(req) {
  return req.user?.email || req.user?.firebase?.identities?.email?.[0] || req.user?.uid;
}

async function financeDeskContext(req) {
  const email = dealerEmail(req);
  const desk = await getRecord("financeDesks", email).catch(() => null)
    || (await findRecordsByField("financeDesks", "officialEmail", email, 3))[0]
    || (await findRecordsByField("financeDesks", "email", email, 3))[0]
    || (await findRecordsByField("financeDesks", "dealershipEmail", email, 3))[0]
    || null;
  const dealershipEmail = desk?.dealershipEmail || email;
  const dealership = await getRecord("dealerships", dealershipEmail) || await getRecord("dealers", dealershipEmail) || {};
  return { email, dealershipEmail, desk, dealership };
}

function owned(leads, email, dealershipEmail = email) {
  return leads.filter((lead) => lead.dealerEmail === dealershipEmail || lead.dealershipEmail === dealershipEmail || lead.createdBy === dealershipEmail || lead.dealerEmail === email || lead.createdBy === email);
}

function salespersonIdFrom(value) {
  return String(value || "").trim();
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

function generateTemporaryPassword() {
  const digits = crypto.randomInt(1000, 10000);
  const suffix = "abcdefghijkmnopqrstuvwxyz".charAt(crypto.randomInt(0, 24));
  return `CLS@${digits}${suffix}`;
}

function normalizeStaffRole(value) {
  const role = String(value || "").trim().toLowerCase();
  if (["finance-head", "finance head", "finance-desk", "finance desk"].includes(role)) return "finance-desk";
  if (["gm", "sm", "gm-sm", "general manager", "sales manager"].includes(role)) return "gm-sm";
  return "";
}

function staffRoleLabel(role, original) {
  if (role === "finance-desk") return "Finance Head";
  const clean = String(original || "").trim().toUpperCase();
  return clean === "SM" ? "SM" : clean === "GM" ? "GM" : "GM / SM";
}

function staffListRow(item) {
  return {
    id: item.id || item.email || item.officialEmail,
    fullName: item.fullName || item.name || item.headName || item.email,
    email: item.email || item.officialEmail,
    mobile: item.mobile || item.headMobile || item.officialMobile || "",
    employeeId: item.employeeId || item.jobId || item.employeeCode || "",
    role: item.role,
    roleLabel: item.roleLabel || staffRoleLabel(item.role, item.role),
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

async function deleteMatchingRecords(collection, predicate) {
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
    .filter((item) => ["finance-desk", "gm-sm"].includes(normalizeStaffRole(item.role)))
    .forEach((item) => add(item, "users"));
  return [...rows.values()].sort((left, right) => String(left.fullName || "").localeCompare(String(right.fullName || "")));
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

export async function startDealerRegistration(req, res, next) {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: "Firebase authentication token is required" });
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });

    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    const email = String(decoded.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Account email is required" });

    const now = new Date().toISOString();
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
        accountApproved: false,
        accountActive: false,
        submittedAt: null,
        dealershipData: {},
        documents: [],
        onboardingRequestId: null,
        approvalRequestId: null,
        dealerApprovalQueueId: null,
        resetAfterRemovalAt: now,
        lastAuthAt: now,
      });
    }

    if (existing?.approvalStatus === "approved" && existingLive.live) {
      return res.json({
        status: "account-created",
        registrationId: existing.id,
        email,
        message: "Account already exists.",
        redirectTo: "/dealer-registration/form",
      });
    }

    if ((existing?.approvalStatus === "rejected" || existing?.approvalStatus === "suspended") && existingLive.live) {
      await updateRecord("pendingDealerAccounts", existing.id, { lastAuthAt: now });
      return res.json({
        status: existing.approvalStatus,
        registrationId: existing.id,
        email,
        message: existing.rejectionReason || existing.suspensionReason || "Your dealership onboarding request cannot continue.",
        redirectTo: "/dealer-registration/pending",
      });
    }

    if (existing?.approvalStatus === "pending" && existingLive.live) {
      await updateRecord("pendingDealerAccounts", existing.id, { lastAuthAt: now });
      return res.json({
        status: "submitted",
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
      accountApproved: false,
      accountActive: false,
      dealershipId: null,
      bankId: null,
      createdAt: existing?.createdAt || now,
      lastLoginAt: null,
    });

    res.json({
      status: "account-created",
      registrationId: registration.id,
      email,
      message: "Account created successfully. Continue dealership registration.",
      redirectTo: "/dealer-registration/form",
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
        registrationSubmitted: true,
        accountApproved: true,
        accountActive: true,
        email,
        dealershipEmail,
        message: "Your dealership account has been approved successfully by CarLoanSaathi.",
        redirectTo: "/dealer-registration/approved",
      });
    }

    const hasLiveRegistrationRecord = Boolean(linkedOnboarding || linkedApproval || dealership);

    if (!hasLiveRegistrationRecord) {
      return res.json({
        status: "not-registered",
        approvalStatus: "not-registered",
        registrationSubmitted: false,
        accountApproved: false,
        accountActive: false,
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
        registrationSubmitted: false,
        accountApproved: false,
        accountActive: false,
        email,
        registrationId: null,
        message: "This dealership account is inactive or deleted.",
        redirectTo: "/dealer-registration",
      });
    }

    if (account?.registrationSubmitted === false || account?.approvalStatus === "not-submitted") {
      return res.json({
        status: "not-submitted",
        approvalStatus: "not-submitted",
        registrationSubmitted: false,
        accountApproved: false,
        accountActive: false,
        email,
        registrationId: account.id,
        message: "Complete your dealership registration form.",
        redirectTo: "/dealer-registration/form",
      });
    }

    return res.json({
      status: account?.approvalStatus || "pending",
      approvalStatus: account?.approvalStatus || "pending",
      registrationSubmitted: account?.registrationSubmitted !== false,
      accountApproved: account?.accountApproved === true,
      accountActive: account?.accountActive === true,
      email,
      registrationId: account?.id || null,
      message: account?.approvalStatus === "rejected"
        ? account.rejectionReason || "Your dealership registration was rejected."
        : account?.approvalStatus === "suspended"
          ? account.suspensionReason || "Your dealership account is suspended."
          : "Your dealership account is still pending approval from CarLoanSaathi.",
      redirectTo: "/dealer-registration/pending",
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
    remarks: body.remarks,
    documents: body.documents,
    metadata: body.metadata,
  };
  return financeDeskLeadSchema.parse(normalized);
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
    CONTACTED: "Bank Processing",
    REQUEST_DOCUMENT: "Pending Documents",
    DOCUMENT_RECEIVED: "Pending Documents",
    REQUEST_PENDING_DOCUMENTS: "Pending Documents",
    ALL_DOCUMENTS_RECEIVED: "Bank Processing",
    UNDER_BANK_PROCESS: "Bank Processing",
    ASSIGNED: "New",
    ACCEPTED: "Bank Processing",
    UNDER_REVIEW: "Bank Processing",
    DOCS_PENDING: "Pending Documents",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    DISBURSED: "Disbursed",
    CLOSED: "Disbursed",
  };
  return map[normalized] || "New";
}

export async function registerDealerOnboarding(req, res, next) {
  try {
    const city = required(req.body.city, "City");
    if (!supportedDealerCities.has(city)) {
      return res.status(400).json({ message: "Dealer city is not supported for onboarding" });
    }

    const loginEmail = required(req.body.primaryGoogleEmail || req.body.loginEmail || req.body.officialDealershipEmail, "Official login email").toLowerCase();
    const now = new Date().toISOString();
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
        accountApproved: false,
        accountActive: false,
        createdFromRegistrationSubmit: true,
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
    const dealership = {
      dealershipName: required(req.body.dealershipName, "Dealership name"),
      dealershipBrand: required(req.body.dealershipBrand, "Dealership brand"),
      authorizedDealerCode: required(req.body.authorizedDealerCode, "Authorized dealer code"),
      gstin: required(req.body.gstin, "GSTIN number"),
      officialDealershipEmail: required(req.body.officialDealershipEmail, "Official dealership email").toLowerCase(),
      officialDealershipMobile: required(req.body.officialDealershipMobile, "Official dealership mobile"),
      state: "Haryana",
      city,
      pincode: required(req.body.pincode, "Pincode"),
      address: required(req.body.address, "Full dealership address"),
      landmark: String(req.body.landmark || "").trim(),
      monthlyCarSalesCapacity: required(req.body.monthlyCarSalesCapacity, "Monthly car sales capacity"),
      expectedMonthlyLoanApplications: required(req.body.expectedMonthlyLoanApplications, "Expected monthly loan applications"),
      status: "Pending Approval",
      active: false,
      accountActive: false,
      approved: false,
      loginEmail,
      primaryGoogleEmail: loginEmail,
      createdAt: now,
    };

    const documents = Array.isArray(req.body.documents) ? req.body.documents : [];
    const registrationPayload = {
      type: "dealership",
      status: "Pending Approval",
      city,
      dealershipName: dealership.dealershipName,
      dealershipBrand: dealership.dealershipBrand,
      loginEmail,
      submittedAt: now,
      documents,
      dealership,
      owner: {
        fullName: required(req.body.ownerFullName, "Owner full name"),
        mobile: required(req.body.ownerMobile, "Owner mobile number"),
        email: required(req.body.ownerEmail, "Owner official email").toLowerCase(),
      },
      generalManager: {
        name: required(req.body.gmName, "General manager name"),
        mobile: required(req.body.gmMobile, "GM mobile number"),
        email: required(req.body.gmEmail, "GM official email").toLowerCase(),
      },
      financeDesk: {
        headName: required(req.body.financeHeadName, "Finance desk head name"),
        headMobile: required(req.body.financeHeadMobile, "Finance desk head mobile"),
        officialEmail: required(req.body.financeDeskEmail, "Finance desk official email").toLowerCase(),
        teamSize: required(req.body.financeTeamSize, "Finance team size"),
      },
      verification: {
        gstinVerified: false,
        dealershipVerified: false,
      },
    };

    const onboardingRequest = await createRecord("onboardingRequests", registrationPayload);

    const approval = await createRecord("pendingDealershipApprovals", {
      onboardingRequestId: onboardingRequest.id,
      pendingDealerAccountId: req.body.registrationId || null,
      type: "dealership",
      accountType: "dealership",
      status: "pending",
      city,
      dealershipName: dealership.dealershipName,
      dealershipBrand: dealership.dealershipBrand,
      loginEmail,
      primaryGoogleEmail: loginEmail,
      submittedAt: now,
      documents,
      dealership,
      owner: onboardingRequest.owner,
      generalManager: onboardingRequest.generalManager,
      financeDesk: onboardingRequest.financeDesk,
      verification: registrationPayload.verification,
    });

    const approvalQueue = await createRecord("dealerApprovalQueue", {
      ...registrationPayload,
      accountType: "dealership",
      pendingDealerAccountId: req.body.registrationId || null,
      pendingDealershipApprovalId: approval.id,
      approvalStatus: "pending",
      status: "pending",
    });

    await updateRecord("pendingDealerAccounts", pendingAccount.id, {
      registrationSubmitted: true,
      approvalStatus: "pending",
      accountApproved: false,
      accountActive: false,
      registrationCompleted: true,
      submittedAt: now,
      dealershipData: registrationPayload,
      documents,
      onboardingRequestId: onboardingRequest.id,
      approvalRequestId: approval.id,
      dealerApprovalQueueId: approvalQueue.id,
    });

    await upsertRecord("dealerRegistrations", req.body.dealerUid || loginEmail, {
      dealerUid: req.body.dealerUid || pendingAccount.uid || loginEmail,
      email: loginEmail,
      dealershipName: dealership.dealershipName,
      dealerBrand: dealership.dealershipBrand,
      city,
      mobile: dealership.officialDealershipMobile,
      registrationStatus: "pending-approval",
      submittedAt: now,
    });

    await assertNoActiveIdentityCollision({ uid: req.body.dealerUid || loginEmail, email: loginEmail, role: "finance-desk", excludeIds: [] });
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
      dealershipId: loginEmail,
      status: "pending",
    });

    for (const document of documents) {
      await createRecord("dealerDocuments", {
        dealerEmail: loginEmail,
        approvalRequestId: approval.id,
        onboardingRequestId: onboardingRequest.id,
        type: document.type,
        fileName: document.fileName,
        size: document.size,
        status: "pending-verification",
      });
      if (document.documentType || document.storagePath || document.fileUrl) {
        await upsertRecord("dealerRegistrationDocuments", `${req.body.dealerUid || loginEmail}:${document.documentType || document.type}`, {
          dealerUid: req.body.dealerUid || pendingAccount.uid || loginEmail,
          documentType: document.documentType || document.type,
          fileName: document.fileName,
          fileUrl: document.fileUrl || "",
          storagePath: document.storagePath || "",
          uploadedAt: now,
          verified: false,
        });
      }
    }

    res.status(201).json({
      message: "Your dealership onboarding request has been submitted successfully. CarLoanSaathi verification team will review your application shortly.",
      status: "pending",
      onboardingRequestId: onboardingRequest.id,
      approvalRequestId: approval.id,
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

    const salesperson = await getRecord("salespersons", salespersonId);
    if (!salesperson || salesperson.dealershipId !== dealershipId || salesperson.active === false) {
      return res.status(400).json({ message: "Select an active salesperson from your dealership" });
    }

    // Normalize and validate lead data
    const payload = normalizeFinanceDeskLead({ 
      ...req.body, 
      selectedBrand: dealerBrand,
      carBrand: dealerBrand,
      ifscCode,
      branchId: branchTieUp.bankId || branchTieUp.id || ifscCode,
      bankBranchId: branchTieUp.bankId || branchTieUp.id || ifscCode,
      bankId: branchTieUp.bankId,
      bankName: branchTieUp.bankName,
      branchName: branchTieUp.branchName,
      salespersonId,
      assignedSalesperson: salesperson.name,
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
      bankIfsc: ifscCode,
      branchId: branchTieUp.bankId || branchTieUp.id || ifscCode,
      bankBranchId: branchTieUp.bankId || branchTieUp.id || ifscCode,
      bankBranchCity,
      branchCity: bankBranchCity,
      bankBranchLocation: bankBranchCity,
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
      assignedSalesperson: salesperson.name,
      
      // Metadata
      createdBy: dealershipId,
      source: "Dealer Dashboard",
      status: LEAD_STATUSES.NEW,
      generatedDate: now.slice(0, 10),
      generatedTime: now.slice(11, 19),
      generatedAt: now,
    });

    const lead = await createRecord("leads", leadPayload);
    let responseLead = lead;
    try {
      responseLead = await reassignLeadToNextBranchExecutive(lead.id, "lead-created-auto-assignment", email);
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

    runDealerLeadSideEffects("dealer-lead-created", [
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

    logInfo("Finance Desk lead created", { 
      requestId: req.requestId, 
      leadId: lead.id, 
      caseId: lead.caseId, 
      dealershipId,
      ifscCode,
    });

    res.status(201).json({ 
      success: true,
      leadId: responseLead.id, 
      caseId: responseLead.caseId, 
      message: responseLead.assignedExecutiveId ? "Lead created and assigned to loan executive" : "Lead created successfully", 
      lead: responseLead 
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
  let authStarted, authEnded, queryStarted, queryEnded, serializeStarted, serializeEnded;
  try {
    authStarted = Date.now();
    const { dealershipEmail } = await financeDeskContext(req);
    authEnded = Date.now();
    queryStarted = Date.now();
    const page = await queryDealershipLeads({ dealershipId: dealershipEmail, query: req.query });
    queryEnded = Date.now();
    serializeStarted = Date.now();
    const responseJson = JSON.stringify(page);
    serializeEnded = Date.now();
    logInfo("Dealer lead query completed", {
      requestId: req.requestId,
      path: req.originalUrl,
      role: req.user?.role,
      totalMs: Date.now() - startedAt,
      authMs: authEnded - authStarted,
      queryMs: queryEnded - queryStarted,
      serializeMs: serializeEnded - serializeStarted,
      warmup: String(req.headers["x-cls-warmup"] || "").toLowerCase() === "true",
      dataCount: Array.isArray(page?.data) ? page.data.length : undefined,
    });
    res.json(JSON.parse(responseJson));
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

export async function getDealerStaff(req, res, next) {
  try {
    const { email, dealershipEmail, dealership } = await financeDeskContext(req);
    const staff = await buildDealerStaffRows(dealershipEmail, dealership, email);
    res.json(staff);
  } catch (error) {
    next(error);
  }
}

export async function getDealerStaffDetail(req, res, next) {
  try {
    const { email, dealershipEmail, dealership } = await financeDeskContext(req);
    const staffId = decodeURIComponent(req.params.id || "");
    const staff = await buildDealerStaffRows(dealershipEmail, dealership, email);
    const employee = staff.find((item) => item.id === staffId || staffEmail(item.email) === staffEmail(staffId));
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
    if (!role) return res.status(400).json({ message: "Select Finance Head, GM, or SM role" });
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
    if (existingUserActive && sameDealershipUser && !["finance-desk", "gm-sm"].includes(normalizeStaffRole(existingUser.role))) {
      return res.status(409).json({ message: "This email belongs to another active role" });
    }

    const now = new Date().toISOString();
    const city = String(req.body.city || req.body.branch || dealership.city || dealership.registeredCity || "").trim();
    const branch = String(req.body.branch || city || dealership.dealershipName || "").trim();
    const dealershipName = dealership.dealershipName || dealership.name || "";
    const temporaryPassword = generateTemporaryPassword();
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

    const roleLabel = staffRoleLabel(role, req.body.role);
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
      uid: firebaseUser.uid,
      email,
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
      firstLoginRequired: true,
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
    res.status(201).json({
      ...staffPayload,
      portalLogin: `${process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || "https://carloansaathi.com"}/finance/login`,
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
    const staff = await buildDealerStaffRows(dealershipEmail, dealership, actorEmail);
    const employee = staff.find((item) => item.id === staffId || staffEmail(item.email) === staffEmail(staffId));
    if (!employee) return res.status(404).json({ message: "Employee not found" });

    const email = staffEmail(employee.email);
    if (email === staffEmail(dealershipEmail) || email === staffEmail(actorEmail) || employee.protected === true) {
      return res.status(400).json({ message: "Primary Finance Desk account cannot be removed from Manage Staff." });
    }
    const belongsToDealer = (item) => item.dealershipId === dealershipEmail || item.dealershipEmail === dealershipEmail;
    const emailMatches = (item) => staffEmail(item.email || item.officialEmail || item.id) === email;
    const deleted = {};

    for (const collection of ["dealerStaff", "financeDesks", "financeDesk", "dealershipManagers", "users"]) {
      deleted[collection] = await deleteMatchingRecords(collection, (item) => belongsToDealer(item) && emailMatches(item));
    }
    for (const collection of ["loginActivity", "authAuditLogs", "notifications"]) {
      deleted[collection] = await deleteMatchingRecords(collection, (item) =>
        emailMatches(item)
        || staffEmail(item.recipientId || item.userEmail || item.actorEmail || item.createdBy || item.updatedBy) === email
      );
    }

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
    const updated = await updateRecord("salespersons", salesperson.id, {
      active: false,
      status: "inactive",
      removedAt: new Date().toISOString(),
      removedBy: dealerEmail(req),
    });
    res.json({ message: "Salesperson removed", salesperson: updated });
  } catch (error) {
    next(error);
  }
}

export async function getDealerLead(req, res, next) {
  try {
    const { email, dealershipEmail } = await financeDeskContext(req);
    const lead = await getRecord("leads", req.params.id);
    if (!lead || !owned([lead], email, dealershipEmail).length) return res.status(404).json({ message: "Lead not found" });
    res.json(lead);
  } catch (error) {
    next(error);
  }
}

export async function getDealerEarnings(req, res, next) {
  try {
    const { dealershipEmail } = await financeDeskContext(req);
    const leads = (await queryDealershipLeads({ dealershipId: dealershipEmail, query: { limit: 100 } })).data;
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
      return res.json({
        email,
        dealershipId: dealershipEmail,
        dealershipCity: dealership.city || dealership.registeredCity || desk?.city || "",
        dealershipBrand: dealership.dealershipBrand || dealership.brand || "",
        ...dealership,
        dealershipBankPartners: dealership.dealershipBankPartners || [],
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
    await upsertRecord("dealers", dealershipEmail, { ...(dealership || {}), ...payload });
    await upsertRecord("dealerships", dealershipEmail, { ...(dealership || {}), ...payload });
    res.json({ message: "Dealer profile saved", profile });
  } catch (error) {
    next(error);
  }
}
