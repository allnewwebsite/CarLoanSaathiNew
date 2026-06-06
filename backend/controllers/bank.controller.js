import { createRecord, deleteRecord, findRecordsByField, getRecord, listRecords, queryRecords, updateRecord, upsertRecord } from "../services/firestore.service.js";
import { ensureCommissionForLead } from "../services/commission.service.js";
import { createNotification } from "../services/notification.service.js";
import { reassignLeadToNextBranchExecutive } from "../services/assignment.service.js";
import { updateSlaForLead } from "../services/sla.service.js";
import { addTimelineEvent, getTimelineForLead, TIMELINE_EVENTS } from "../services/timeline.service.js";
import { createShortLivedDocumentUrl, deleteLeadDocument, uploadLeadDocument } from "../services/storage.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "../services/audit.service.js";
import { assertValidStatusTransition, LEAD_STATUSES, normalizeStatus, STATUS_LABELS } from "../utils/status.constants.js";
import { firebaseAdmin } from "../firebase/admin.js";
import { queryBankLeads, queryExecutiveLeads } from "../services/leadQuery.service.js";
import { ALERT_SEVERITY, emitOperationalAlert, recordOperationalEvent } from "../services/observability.service.js";
import { logError, logInfo } from "../services/logger.service.js";
import { syncLeadProjectionSoon } from "../services/projection.service.js";
import { paginationParams, pageResponse } from "../utils/pagination.js";
import crypto from "node:crypto";
import { revokeUserSessions } from "./auth.controller.js";
import { assertNoActiveIdentityCollision, upsertCanonicalUser } from "../services/identity.service.js";
import { cached, clearCachedValue } from "../services/ttlCache.service.js";

const bankStatuses = [
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

function userEmail(req) {
  return req.user?.email || req.user?.uid;
}

function cleanText(value) {
  return String(value || "").trim().toLowerCase();
}

function sameText(left, right) {
  const cleanLeft = cleanText(left);
  const cleanRight = cleanText(right);
  return Boolean(cleanLeft && cleanRight && cleanLeft === cleanRight);
}

function anyMatch(values, targets) {
  return values.some((value) => targets.some((target) => sameText(value, target)));
}

async function deleteMatchingRecords(collection, predicate) {
  const records = await listRecords(collection).catch(() => []);
  const matches = records.filter(predicate);
  await Promise.all(matches.map((item) => deleteRecord(collection, item.id)));
  return matches.length;
}

async function currentPartner(req) {
  const email = userEmail(req);
  const cacheKey = `context:bank:${req.user?.role || ""}:${req.user?.uid || ""}:${email}`;
  return cached(cacheKey, 15000, async () => {
  if (req.user?.role === "loan-executive") {
    const executive = await getRecord("loanExecutives", email);
    if (executive) return { ...executive, roleType: "loan-executive" };
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
    if (manager) return { ...manager, roleType: "bank-manager" };
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

function partnerCanAccessLead(partner, lead) {
  if (!partner || !lead) return false;
  if (partner.roleType === "loan-executive") {
    return anyMatch(
      [lead.assignedExecutiveId, lead.assignedExecutiveEmail, lead.assignedExecutiveMobile, lead.assignedExecutiveName],
      [partner.id, partner.email, partner.mobile, partner.name, partner.fullName],
    );
  }

  if (partner.roleType === "bank-manager") {
    const sameBank = anyMatch(
      [
        lead.bankId,
        lead.assignedBankId,
        lead.assignedPartnerId,
        lead.branchId,
        lead.bankBranchId,
        lead.selectedBankBranchId,
        lead.ifscCode,
        lead.bankIfsc,
        lead.assignedBankIfsc,
        lead.bankName,
        lead.assignedBankName,
      ],
      [
        partner.bankId,
        partner.bankPartnerId,
        partner.partnerId,
        partner.id,
        partner.branchId,
        partner.bankBranchId,
        partner.ifsc,
        partner.ifscCode,
        partner.bankIfsc,
        partner.bankName,
        partner.companyName,
      ],
    );
    return sameBank;
  }

  const supportedBanks = Array.isArray(partner.supportedBanks) ? partner.supportedBanks : [];
  return anyMatch(
    [lead.assignedPartnerId, lead.assignedBankId, lead.bankPartner, lead.assignedBankName, lead.preferredBank],
    [partner.id, partner.email, partner.bankName, partner.companyName, ...supportedBanks],
  );
}

function leadBranchValues(lead = {}) {
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

function partnerBranchValues(partner = {}) {
  return [
    partner.branchId,
    partner.bankBranchId,
    partner.bankPartnerId,
    partner.partnerId,
    partner.id,
    partner.ifsc,
    partner.ifscCode,
    partner.bankIfsc,
    partner.bankBranchLocation,
    partner.branchLocation,
    partner.branchCity,
    partner.city,
  ];
}

function documentBelongsToLead(document, lead) {
  return anyMatch(
    [document.leadId, document.caseId],
    [lead.id, lead.caseId],
  );
}

function documentBelongsToBank(document, lead, partner) {
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

function documentBelongsToBranch(document, lead, partner) {
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

function documentBelongsToExecutive(document, lead, partner) {
  if (partner.roleType !== "loan-executive") return true;
  const executiveTargets = [partner.id, partner.email, partner.mobile, partner.name, partner.fullName];
  const leadExecutiveMatch = anyMatch(
    [lead.assignedExecutiveId, lead.assignedExecutiveEmail, lead.assignedExecutiveMobile, lead.assignedExecutiveName],
    executiveTargets,
  );
  if (!leadExecutiveMatch) return false;

  const documentExecutiveValues = [
    document.assignedExecutiveId,
    document.assignedExecutiveEmail,
    document.assignedExecutiveMobile,
    document.assignedExecutiveName,
  ].filter(Boolean);
  return !documentExecutiveValues.length || anyMatch(documentExecutiveValues, executiveTargets);
}

function bankIdentity(partner) {
  const bankId = partner.bankPartnerId || partner.partnerId || partner.bankId || partner.id || partner.email || partner.bankName;
  return {
    bankId,
    bankName: partner.bankName || partner.companyName || partner.name || bankId,
    bankIfsc: partner.ifsc || partner.bankIfsc || partner.ifscCode || null,
    bankLocation: partner.bankBranchLocation || partner.branchLocation || partner.branchCity || partner.city || partner.operatingCity,
  };
}

function generateTemporaryPassword() {
  const digits = crypto.randomInt(1000, 10000);
  const suffix = "abcdefghijkmnopqrstuvwxyz".charAt(crypto.randomInt(0, 24));
  return `CLS@${digits}${suffix}`;
}

function executiveBelongsToBank(executive, identity) {
  return executive.bankPartnerId === identity.bankId
    || executive.bankId === identity.bankId
    || executive.partnerId === identity.bankId
    || executive.bankName === identity.bankName;
}

function leadText(lead) {
  return [lead.caseId, lead.fullName, lead.customerName, lead.mobile, lead.city, lead.selectedBrand, lead.selectedModel, lead.status, lead.dealershipName, lead.dealerEmail, lead.assignedExecutiveName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function applyFilters(leads, query) {
  const search = String(query.search || "").trim().toLowerCase();
  const executive = String(query.executive || "").trim().toLowerCase();
  const dealership = String(query.dealership || "").trim().toLowerCase();
  return leads.filter((lead) => {
    const statusOk = !query.status || normalizeStatus(lead.status) === normalizeStatus(query.status) || lead.assignmentStatus === query.status;
    const dateOk = !query.date || (lead.assignmentTimestamp || lead.createdAt || "").startsWith(query.date);
    const searchOk = !search || leadText(lead).includes(search);
    const slaOk = !query.sla || (query.sla === "due" ? Boolean(lead.slaDueToday) : true);
    const executiveOk = !executive || String(lead.assignedExecutiveName || lead.assignedExecutiveId || "").toLowerCase() === executive;
    const dealershipOk = !dealership || String(lead.dealershipName || lead.dealerEmail || "").toLowerCase() === dealership;
    const pendingDocsOk = !query.pendingDocs || [LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.DOCUMENT_RECEIVED, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING].includes(normalizeStatus(lead.status));
    return statusOk && dateOk && searchOk && slaOk && executiveOk && dealershipOk && pendingDocsOk;
  });
}

async function attachExecutiveMobile(partner, leads) {
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
        [item.id, item.email, item.officialEmail, item.jobId],
        [lead.assignedExecutiveId, lead.assignedExecutiveEmail],
      )
    );
    return executive?.mobile ? { ...lead, assignedExecutiveMobile: executive.mobile, executiveMobile: executive.mobile } : lead;
  });
}

async function liveBankRegistrationForAccount(account) {
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

async function assignedLeadsForPartner(partner, query = {}) {
  if (partner.roleType === "loan-executive") {
    const result = await queryExecutiveLeads({ executiveId: partner.id, executiveEmail: partner.email, query: { ...query, limit: query.limit || 100 } });
    return attachExecutiveMobile(partner, applyFilters(result.data, query));
  }
  const identity = bankIdentity(partner);
  const result = await queryBankLeads({ bankId: identity.bankId, query: { ...query, limit: query.limit || 100 } });
  return attachExecutiveMobile(partner, applyFilters(result.data.filter((lead) => partnerCanAccessLead(partner, lead)), query));
}

async function clearExecutiveLeadAssignments({ identity, uid, email, removedAt, batchSize = 250 }) {
  const seen = new Set();
  const specs = [
    uid ? { field: "assignedExecutiveId", value: uid } : null,
    email ? { field: "assignedExecutiveEmail", value: email } : null,
    email ? { field: "assignedExecutiveId", value: email } : null,
  ].filter(Boolean);
  let affectedLeadCount = 0;

  for (const spec of specs) {
    for (;;) {
      const page = await queryRecords("leads", {
        where: [{ field: "bankId", value: identity.bankId }, spec],
        limit: batchSize,
        maxLimit: batchSize,
      }).catch(() => ({ data: [] }));
      if (!page.data.length) break;

      const uniqueLeads = page.data.filter((lead) => {
        if (seen.has(lead.id)) return false;
        seen.add(lead.id);
        return true;
      });

      await Promise.all(uniqueLeads.map((lead) => updateRecord("leads", lead.id, {
        assignedExecutiveId: null,
        assignedExecutiveEmail: null,
        assignedExecutiveName: null,
        assignedExecutiveMobile: null,
        updatedAt: removedAt,
      })));
      affectedLeadCount += uniqueLeads.length;

      if (page.data.length < batchSize) break;
    }
  }

  return affectedLeadCount;
}

async function requireAssignedLead(req) {
  const partner = await currentPartner(req);
  if (!partner) {
    const error = new Error("Bank partner profile not found");
    error.status = 404;
    throw error;
  }
  const lead = await getRecord("leads", req.params.id);
  if (!lead || !partnerCanAccessLead(partner, lead)) {
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
    const error = new Error("Lead not assigned to this bank partner");
    error.status = 403;
    throw error;
  }
  return { partner, lead };
}

function clearLeadDetailCaches(leadId) {
  clearCachedValue(`lead-detail:${leadId}:`);
  clearCachedValue(`timeline:lead:${leadId}:`);
}

function clearBankSummaryCaches() {
  clearCachedValue("bank:analytics:");
  clearCachedValue("bank:notifications:");
  clearCachedValue("bank:executives:");
  clearCachedValue("bank:executive-cases:");
  clearCachedValue("gm:notifications:");
  clearCachedValue("gm:salespersons:");
}

export async function registerBankPartner(req, res, next) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Email is required" });
    const now = new Date().toISOString();
    let pendingAccount = await getRecord("pendingBankAccounts", email).catch(() => null)
      || (await findRecordsByField("pendingBankAccounts", "email", email, 3))[0]
      || null;
    if (!pendingAccount) {
      pendingAccount = await createRecord("pendingBankAccounts", {
        uid: req.body.bankUid || email,
        email,
        authProvider: "password",
        onboardingStarted: true,
        registrationSubmitted: false,
        approvalStatus: "not-submitted",
        accountApproved: false,
        accountActive: false,
      });
    }
    const live = await liveBankRegistrationForAccount(pendingAccount);
    if (!live.live && (pendingAccount.registrationSubmitted === true || pendingAccount.approvalStatus === "pending" || pendingAccount.approvalStatus === "approved")) {
      pendingAccount = await updateRecord("pendingBankAccounts", pendingAccount.id, {
        registrationSubmitted: false,
        approvalStatus: "not-submitted",
        accountApproved: false,
        accountActive: false,
        approvalRequestId: null,
        resetAfterRemovalAt: now,
      });
    }
    if (pendingAccount.approvalStatus === "approved" || pendingAccount.accountActive === true) {
      return res.status(400).json({ message: "This bank account is already approved." });
    }
    if (pendingAccount.registrationSubmitted === true || pendingAccount.approvalStatus === "pending") {
      return res.status(409).json({ message: "Your bank registration is already submitted and pending approval." });
    }

    const supportedBanks = Array.isArray(req.body.supportedBanks)
      ? req.body.supportedBanks
      : String(req.body.supportedBanks || "").split(",").map((item) => item.trim()).filter(Boolean);
    const bankBranchLocation = String(req.body.bankBranchLocation || req.body.branchLocation || req.body.city || "").trim();
    const ifsc = String(req.body.ifsc || "").trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
      return res.status(400).json({ message: "Valid IFSC code is required for branch registration" });
    }
    if (!bankBranchLocation) {
      return res.status(400).json({ message: "Bank branch location is required" });
    }

    const request = await createRecord("pendingBankApprovals", {
      email,
      type: "bank",
      accountType: "bank",
      status: "pending",
      companyName: String(req.body.companyName || "").trim(),
      bankName: String(req.body.bankName || req.body.companyName || req.body.supportedBanks?.[0] || "").trim(),
      ifsc,
      gstin: String(req.body.gstin || "").trim().toUpperCase(),
      branchLocation: bankBranchLocation,
      bankBranchLocation,
      contactPerson: String(req.body.contactPerson || "").trim(),
      managerName: String(req.body.managerName || req.body.contactPerson || "").trim(),
      mobile: String(req.body.mobile || "").trim(),
      officialEmail: String(req.body.officialEmail || email).trim().toLowerCase(),
      landline: String(req.body.landline || "").trim(),
      state: "Haryana",
      executiveCount: String(req.body.executiveCount || "").trim(),
      monthlyLoanCapacity: String(req.body.monthlyLoanCapacity || req.body.approvalLimit || "").trim(),
      supportedBanks,
      operatingCity: bankBranchLocation,
      approvalLimit: Number.parseInt(String(req.body.monthlyLoanCapacity || req.body.approvalLimit || "100").replace(/\D/g, ""), 10) || 100,
      assignedManagers: Array.isArray(req.body.assignedManagers) ? req.body.assignedManagers : [],
      executives: Array.isArray(req.body.executives) ? req.body.executives : [],
      documents: Array.isArray(req.body.documents) ? req.body.documents : [],
      supportedBrands: ["All"],
      role: "bank-manager",
      slaScore: 100,
      submittedAt: now,
    });
    await updateRecord("pendingBankAccounts", pendingAccount.id, {
      registrationSubmitted: true,
      approvalStatus: "pending",
      accountApproved: false,
      accountActive: false,
      submittedAt: now,
      approvalRequestId: request.id,
      bankData: request,
    });

    res.status(201).json({ message: "Bank branch approval request submitted successfully.", status: "pending", approvalId: request.id });
  } catch (error) {
    next(error);
  }
}

export async function startBankRegistration(req, res, next) {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: "Firebase authentication token is required" });
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });
    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    const email = String(decoded.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Account email is required" });
    const now = new Date().toISOString();
    let existing = await getRecord("pendingBankAccounts", email).catch(() => null)
      || (await findRecordsByField("pendingBankAccounts", "email", email, 3))[0]
      || null;
    const live = existing ? await liveBankRegistrationForAccount(existing) : { live: false };
    if (existing && !live.live) {
      existing = await updateRecord("pendingBankAccounts", existing.id, {
        uid: decoded.uid || email,
        email,
        name: decoded.name || email,
        photoURL: decoded.picture || "",
        authProvider: "password",
        onboardingStarted: true,
        registrationSubmitted: false,
        approvalStatus: "not-submitted",
        accountApproved: false,
        accountActive: false,
        submittedAt: null,
        approvalRequestId: null,
        bankData: {},
        resetAfterRemovalAt: now,
        lastAuthAt: now,
      });
    }
    if (existing?.approvalStatus === "pending" && live.live) {
      await updateRecord("pendingBankAccounts", existing.id, { lastAuthAt: now });
      return res.json({ status: "submitted", registrationId: existing.id, email, message: "Your bank registration is pending Super Admin approval.", redirectTo: "/bank-registration/pending" });
    }
    if (existing?.approvalStatus === "approved" && live.live) {
      return res.json({ status: "approved", registrationId: existing.id, email, message: "Bank account already approved.", redirectTo: "/bank-registration/approved" });
    }
    const payload = {
      uid: decoded.uid || email,
      email,
      name: decoded.name || email,
      photoURL: decoded.picture || "",
      authProvider: "password",
      onboardingStarted: true,
      registrationSubmitted: false,
      approvalStatus: "not-submitted",
      accountApproved: false,
      accountActive: false,
      startedAt: existing?.startedAt || now,
      lastAuthAt: now,
      approvalRequestId: null,
      bankData: {},
    };
    const registration = existing ? await updateRecord("pendingBankAccounts", existing.id, payload) : await createRecord("pendingBankAccounts", payload);
    await assertNoActiveIdentityCollision({ uid: decoded.uid || email, email, role: "bank-manager", excludeIds: [] });
    await upsertCanonicalUser(decoded.uid || email, {
      uid: decoded.uid || email,
      email,
      role: "bank-manager",
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
    res.json({ status: "account-created", registrationId: registration.id, email, message: "Account created successfully. Continue bank registration.", redirectTo: "/bank-registration/form" });
  } catch (error) {
    recordOperationalEvent({
      type: "bank_lead_detail_fetch_failed",
      severity: error.status === 403 ? ALERT_SEVERITY.HIGH : ALERT_SEVERITY.MEDIUM,
      component: "bank-documents",
      message: "Bank lead detail fetch failed",
      entityId: req.params.id,
      requestId: req.requestId,
      meta: { status: error.status || 500, actor: userEmail(req), reason: error.message },
    }).catch(() => {});
    next(error);
  }
}

export async function getBankRegistrationStatus(req, res, next) {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: "Firebase authentication token is required" });
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });
    const decoded = await firebaseAdmin.auth().verifyIdToken(idToken);
    const email = String(decoded.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Account email is required" });
    const account = await getRecord("pendingBankAccounts", email).catch(() => null)
      || (await findRecordsByField("pendingBankAccounts", "email", email, 3))[0]
      || null;
    const live = account ? await liveBankRegistrationForAccount(account) : { live: false };
    const active = live.branchManager?.active !== false && live.bankPartner?.active !== false;
    if (account?.approvalStatus === "approved" && account.accountApproved === true && account.accountActive === true && active) {
      return res.json({ status: "approved", approvalStatus: "approved", registrationSubmitted: true, accountApproved: true, accountActive: true, email, redirectTo: "/bank-registration/approved", message: "Your bank account has been approved successfully by CarLoanSaathi." });
    }
    if (account?.registrationSubmitted === false || account?.approvalStatus === "not-submitted") {
      return res.json({ status: "not-submitted", approvalStatus: "not-submitted", registrationSubmitted: false, accountApproved: false, accountActive: false, email, registrationId: account.id, redirectTo: "/bank-registration/form", message: "Complete your bank registration form." });
    }
    if (!live.live) {
      return res.json({ status: "not-registered", approvalStatus: "not-registered", registrationSubmitted: false, accountApproved: false, accountActive: false, email, redirectTo: "/bank-registration", message: "No active bank registration was found for this account." });
    }
    res.json({ status: account?.approvalStatus || "pending", approvalStatus: account?.approvalStatus || "pending", registrationSubmitted: account?.registrationSubmitted !== false, accountApproved: account?.accountApproved === true, accountActive: account?.accountActive === true, email, registrationId: account?.id || null, redirectTo: "/bank-registration/pending", message: "Your bank account is still pending approval from CarLoanSaathi." });
  } catch (error) {
    next(error);
  }
}

export async function getBankLeads(req, res, next) {
  const startedAt = Date.now();
  let authStarted, authEnded, queryStarted, queryEnded, serializeStarted, serializeEnded;
  try {
    authStarted = Date.now();
    const partner = await currentPartner(req);
    authEnded = Date.now();
    if (!partner) return res.status(404).json({ message: "Bank partner profile not found" });
    let response;
    queryStarted = Date.now();
    if (partner.roleType === "loan-executive") {
      response = await queryExecutiveLeads({ executiveId: partner.id, executiveEmail: partner.email, query: req.query });
      queryEnded = Date.now();
      serializeStarted = Date.now();
      const responseJson = JSON.stringify(response);
      serializeEnded = Date.now();
      logInfo("Bank executive lead query completed", {
        requestId: req.requestId,
        path: req.originalUrl,
        role: req.user?.role,
        totalMs: Date.now() - startedAt,
        authMs: authEnded - authStarted,
        queryMs: queryEnded - queryStarted,
        serializeMs: serializeEnded - serializeStarted,
        warmup: String(req.headers["x-cls-warmup"] || "").toLowerCase() === "true",
        dataCount: Array.isArray(response?.data) ? response.data.length : undefined,
      });
      return res.json(JSON.parse(responseJson));
    }
    const { limit } = paginationParams(req.query);
    const scopedLeads = await assignedLeadsForPartner(partner, { ...req.query, limit: Math.min(Math.max(limit * 3, limit), 100) });
    queryEnded = Date.now();
    const data = scopedLeads.slice(0, limit);
    await recordOperationalEvent({
      type: "bank_leads_scoped",
      severity: ALERT_SEVERITY.LOW,
      component: "bank-rbac",
      message: "Bank manager lead list tenant scoped",
      entityId: partner.email || partner.id,
      requestId: req.requestId,
      meta: { returned: data.length, bankId: bankIdentity(partner).bankId, branchId: partner.branchId || partner.branchCity || partner.bankBranchLocation },
    });
    const page = pageResponse({ data, limit, nextCursor: null, total: scopedLeads.length });
    serializeStarted = Date.now();
    const responseJson = JSON.stringify(page);
    serializeEnded = Date.now();
    logInfo("Bank manager lead query completed", {
      requestId: req.requestId,
      path: req.originalUrl,
      role: req.user?.role,
      totalMs: Date.now() - startedAt,
      authMs: authEnded - authStarted,
      queryMs: queryEnded - queryStarted,
      serializeMs: serializeEnded - serializeStarted,
      warmup: String(req.headers["x-cls-warmup"] || "").toLowerCase() === "true",
      dataCount: data.length,
    });
    return res.json(JSON.parse(responseJson));
  } catch (error) {
    next(error);
  }
}

export async function getBankExecutives(req, res, next) {
  try {
    const partner = await currentPartner(req);
    if (!partner || partner.roleType !== "bank-manager") return res.status(403).json({ message: "Only bank managers can view executives" });
    const identity = bankIdentity(partner);
    const [executivesPage, leads] = await cached(`bank:executives:${identity.bankId}:${partner.email || partner.id}`, 15000, () => Promise.all([
      queryRecords("loanExecutives", {
        where: [{ field: "bankId", value: identity.bankId }],
        orderBy: "createdAt",
        direction: "desc",
        limit: 100,
        maxLimit: 100,
      }),
      assignedLeadsForPartner(partner),
    ]));
    const executives = executivesPage.data;
    const rows = executives
      .filter((executive) => executiveBelongsToBank(executive, identity))
      .map((executive) => {
        const executiveId = executive.id || executive.jobId || executive.mobile || executive.email;
        const cases = leads.filter((lead) =>
          lead.assignedExecutiveId === executiveId
          || lead.assignedExecutiveId === executive.id
          || lead.assignedExecutiveId === executive.jobId
          || lead.assignedExecutiveEmail === executive.email
          || lead.assignedExecutiveMobile === executive.mobile
          || lead.assignedExecutiveName === executive.name
          || lead.assignedExecutiveName === executive.fullName
        );
        const activeCases = cases.filter((lead) => ![LEAD_STATUSES.REJECTED, LEAD_STATUSES.DISBURSED, LEAD_STATUSES.CLOSED].includes(normalizeStatus(lead.status)));
        return {
          ...executive,
          executiveId,
          totalAssignedCases: cases.length,
          currentActiveCases: activeCases.length,
          status: executive.active === false ? "inactive" : executive.status || "active",
        };
      });
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
}

export async function createBankExecutive(req, res, next) {
  try {
    const partner = await currentPartner(req);
    if (!partner || partner.roleType !== "bank-manager") return res.status(403).json({ message: "Only bank managers can add executives" });
    const name = String(req.body.name || req.body.executiveName || "").trim();
    const mobile = String(req.body.mobile || "").trim();
    const jobId = String(req.body.jobId || "").trim();
    const email = String(req.body.email || req.body.officialEmail || "").trim().toLowerCase();
    if (!name || !mobile || !jobId || !email) return res.status(400).json({ message: "Executive name, mobile number, job ID, and official email are required" });
    if (!/^\d{10}$/.test(mobile)) return res.status(400).json({ message: "Mobile number must be 10 digits" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: "Valid official email is required" });

    const identity = bankIdentity(partner);
    const executives = (await queryRecords("loanExecutives", {
      where: [{ field: "bankId", value: identity.bankId }],
      orderBy: "createdAt",
      direction: "desc",
      limit: 200,
      maxLimit: 200,
    })).data;
    const duplicate = executives.find((executive) => executive.active !== false && (executive.mobile === mobile || executive.jobId === jobId || executive.email === email || executive.officialEmail === email || executive.id === email));
    if (duplicate?.mobile === mobile) return res.status(409).json({ message: "Mobile number already exists for this bank" });
    if (duplicate?.jobId === jobId) return res.status(409).json({ message: "Job ID already exists for this bank" });
    if (duplicate?.email === email || duplicate?.officialEmail === email || duplicate?.id === email) return res.status(409).json({ message: "Official email already exists for an executive" });

    const now = new Date().toISOString();
    const temporaryPassword = generateTemporaryPassword();
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });
    let firebaseUser;
    try {
      firebaseUser = await firebaseAdmin.auth().createUser({
        email,
        password: temporaryPassword,
        displayName: name,
        emailVerified: true,
        disabled: false,
      });
    } catch (firebaseError) {
      if (firebaseError.code === "auth/email-already-exists") return res.status(409).json({ message: "Firebase Auth account already exists for this email" });
      throw firebaseError;
    }
    await assertNoActiveIdentityCollision({ uid: firebaseUser.uid, email, role: "loan-executive", excludeIds: [] });

    const payload = {
      id: email,
      uid: firebaseUser.uid,
      name,
      fullName: name,
      email,
      officialEmail: email,
      mobile,
      jobId,
      bankPartnerId: identity.bankId,
      bankId: identity.bankId,
      bankName: identity.bankName,
      bankIfsc: identity.bankIfsc,
      ifsc: identity.bankIfsc,
      bankLocation: identity.bankLocation,
      bankBranchLocation: identity.bankLocation,
      branch: identity.bankLocation,
      branchCity: identity.bankLocation,
      city: identity.bankLocation,
      createdByManagerId: partner.email || partner.id,
      createdByManager: true,
      firstLoginRequired: true,
      passwordChangedAt: null,
      status: "active",
      active: true,
      approved: true,
      accountApproved: true,
      accountActive: true,
      createdAt: now,
    };
    await upsertRecord("loanExecutives", email, payload);
    await upsertCanonicalUser(firebaseUser.uid, {
      uid: firebaseUser.uid,
      email,
      role: "loan-executive",
      approved: true,
      active: true,
      accountApproved: true,
      accountActive: true,
      bankId: identity.bankId,
      bankName: identity.bankName,
      bankIfsc: identity.bankIfsc,
      branchId: identity.bankLocation,
      branch: identity.bankLocation,
      city: identity.bankLocation,
      firstLoginRequired: true,
      passwordChangedAt: null,
      createdByManager: true,
      createdByManagerId: partner.email || partner.id,
      status: "active",
    });
    await firebaseAdmin.auth().setCustomUserClaims(firebaseUser.uid, {
      role: "loan-executive",
      approved: true,
      active: true,
      bankId: identity.bankId,
      branchId: identity.bankLocation || null,
    });
    const executive = await getRecord("loanExecutives", email);
    clearBankSummaryCaches();
    await writeAuditLog({ req, actionType: "BANK_EXECUTIVE_CREATED", newValue: jobId, meta: { executiveId: executive.id, bankId: identity.bankId } });
    res.status(201).json({
      ...executive,
      portalLogin: `${process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || "https://carloansaathi.com"}/executive/login`,
      temporaryPassword,
    });
  } catch (error) {
    next(error);
  }
}

export async function removeBankExecutive(req, res, next) {
  try {
    const partner = await currentPartner(req);
    if (!partner || partner.roleType !== "bank-manager") return res.status(403).json({ message: "Only bank managers can remove executives" });
    const identity = bankIdentity(partner);
    const executive = await getRecord("loanExecutives", req.params.executiveId);
    if (!executive || !executiveBelongsToBank(executive, identity)) return res.status(404).json({ message: "Executive not found for this bank" });
    const email = cleanText(executive.email || executive.officialEmail || executive.id);
    const uid = String(executive.uid || executive.authUid || "").trim();
    const deleted = {};
    const removedAt = new Date().toISOString();
    const matchesExecutive = (item = {}) => {
      const itemEmail = cleanText(item.email || item.officialEmail || item.id);
      const itemUid = String(item.uid || item.authUid || "").trim();
      return Boolean(
        (email && itemEmail === email)
        || (uid && itemUid === uid)
        || String(item.id || "") === executive.id
      );
    };

    for (const collection of ["loanExecutives", "users"]) {
      deleted[collection] = await deleteMatchingRecords(collection, matchesExecutive);
    }

    const affectedLeadCount = await clearExecutiveLeadAssignments({ identity, uid, email, removedAt });
    clearBankSummaryCaches();

    await revokeUserSessions(email, "bank-executive-permanent-delete").catch(() => {});
    let authDeleted = false;
    if (firebaseAdmin && email) {
      try {
        const firebaseUser = await firebaseAdmin.auth().getUserByEmail(email);
        await firebaseAdmin.auth().deleteUser(firebaseUser.uid);
        authDeleted = true;
      } catch (firebaseError) {
        if (firebaseError.code !== "auth/user-not-found") throw firebaseError;
      }
    }

    await writeAuditLog({
      req,
      actionType: "BANK_EXECUTIVE_REMOVED",
      oldValue: executive.status,
      newValue: "deleted",
      meta: { executiveId: executive.id, bankId: identity.bankId, email, uid, deleted, affectedLeadCount, authDeleted },
    });
    res.json({ message: "Executive permanently removed", deleted, affectedLeadCount, authDeleted });
  } catch (error) {
    next(error);
  }
}

async function updateExecutiveLinkedRecords(email, patch) {
  const account = await getRecord("users", email).catch(() => null);
  if (account) await upsertRecord("users", email, { ...account, ...patch });
  const executive = await getRecord("loanExecutives", email).catch(() => null);
  if (executive) await upsertRecord("loanExecutives", email, { ...executive, ...patch });
}

export async function updateBankExecutiveLifecycle(req, res, next) {
  try {
    const partner = await currentPartner(req);
    if (!partner || partner.roleType !== "bank-manager") return res.status(403).json({ message: "Only bank managers can update executives" });
    const identity = bankIdentity(partner);
    const executive = await getRecord("loanExecutives", req.params.executiveId);
    if (!executive || !executiveBelongsToBank(executive, identity)) return res.status(404).json({ message: "Executive not found for this bank" });
    const action = String(req.body.action || "").trim();
    const now = new Date().toISOString();
    let patch = {};
    if (action === "suspend") patch = { active: false, accountActive: false, accountStatus: "suspended", status: "suspended", suspendedAt: now, suspendedBy: partner.email || partner.id };
    else if (action === "activate") patch = { active: true, accountActive: true, accountStatus: "active", status: "active", activatedAt: now, activatedBy: partner.email || partner.id };
    else if (action === "disable") patch = { active: false, accountActive: false, accountStatus: "disabled", status: "disabled", disabledAt: now, disabledBy: partner.email || partner.id };
    else if (action === "remove") patch = { active: false, accountActive: false, accountStatus: "removed", status: "removed", removedAt: now, removedByManagerId: partner.email || partner.id };
    else if (action === "transfer") {
      const branch = String(req.body.branch || "").trim();
      if (!branch) return res.status(400).json({ message: "Branch is required" });
      patch = { bankBranchLocation: branch, branchCity: req.body.city || branch, city: req.body.city || branch, branchTransferredAt: now, branchTransferredBy: partner.email || partner.id };
    } else return res.status(400).json({ message: "Invalid executive action" });
    await updateExecutiveLinkedRecords(executive.email, patch);
    if (["suspend", "disable", "remove", "transfer"].includes(action)) await revokeUserSessions(executive.email, `bank-executive-${action}`);
    clearBankSummaryCaches();
    await writeAuditLog({ req, actionType: `BANK_EXECUTIVE_${action.toUpperCase()}`, targetEntity: "loanExecutives", targetId: executive.email, meta: { bankId: identity.bankId, action } });
    res.json({ message: "Executive updated", executive: { ...executive, ...patch } });
  } catch (error) {
    next(error);
  }
}

export async function resetBankExecutivePassword(req, res, next) {
  try {
    const partner = await currentPartner(req);
    if (!partner || partner.roleType !== "bank-manager") return res.status(403).json({ message: "Only bank managers can reset executive passwords" });
    const identity = bankIdentity(partner);
    const executive = await getRecord("loanExecutives", req.params.executiveId);
    if (!executive || !executiveBelongsToBank(executive, identity)) return res.status(404).json({ message: "Executive not found for this bank" });
    if (!firebaseAdmin) return res.status(503).json({ message: "Firebase Admin is not configured" });
    const temporaryPassword = generateTemporaryPassword();
    const firebaseUser = await firebaseAdmin.auth().getUserByEmail(executive.email);
    await firebaseAdmin.auth().updateUser(firebaseUser.uid, { password: temporaryPassword });
    await updateExecutiveLinkedRecords(executive.email, { firstLoginRequired: true, passwordChangedAt: null, passwordResetAt: new Date().toISOString(), passwordResetBy: partner.email || partner.id });
    await revokeUserSessions(executive.email, "bank-executive-password-reset");
    clearBankSummaryCaches();
    await writeAuditLog({ req, actionType: "BANK_EXECUTIVE_PASSWORD_RESET", targetEntity: "loanExecutives", targetId: executive.email, meta: { bankId: identity.bankId } });
    res.json({ message: "Temporary password generated", temporaryPassword, portalLogin: `${process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || "https://carloansaathi.com"}/executive/login`, executive });
  } catch (error) {
    next(error);
  }
}

export async function getBankExecutiveCases(req, res, next) {
  try {
    const partner = await currentPartner(req);
    if (!partner || partner.roleType !== "bank-manager") return res.status(403).json({ message: "Only bank managers can view executive cases" });
    const identity = bankIdentity(partner);
    const executive = await getRecord("loanExecutives", req.params.executiveId);
    if (!executive || !executiveBelongsToBank(executive, identity)) return res.status(404).json({ message: "Executive not found for this bank" });
    const rows = await cached(`bank:executive-cases:${identity.bankId}:${executive.id || executive.email}:${JSON.stringify(req.query || {})}`, 10000, async () => {
      const candidates = await Promise.all([
        queryExecutiveLeads({ executiveId: executive.id || executive.jobId || executive.email, executiveEmail: executive.email, query: req.query }),
        executive.jobId && executive.jobId !== executive.id ? queryExecutiveLeads({ executiveId: executive.jobId, executiveEmail: executive.email, query: req.query }) : Promise.resolve({ data: [] }),
      ]);
      const byId = new Map();
      candidates.flatMap((page) => page.data || []).forEach((lead) => {
        if (partnerCanAccessLead(partner, lead)) byId.set(lead.id, lead);
      });
      return [...byId.values()].filter((lead) =>
        lead.assignedExecutiveId === executive.id
        || lead.assignedExecutiveId === executive.jobId
        || lead.assignedExecutiveEmail === executive.email
        || lead.assignedExecutiveMobile === executive.mobile
        || lead.assignedExecutiveName === executive.name
        || lead.assignedExecutiveName === executive.fullName
      );
    });
    res.json({ data: rows, executive });
  } catch (error) {
    next(error);
  }
}

export async function getBankLead(req, res, next) {
  try {
    const { partner, lead } = await requireAssignedLead(req);
    const [hydratedLead] = await attachExecutiveMobile(partner, [lead]);
    const { hydratedDocuments, hydratedBankDocuments } = await cached(`lead-detail:${hydratedLead.id}:bank-docs:v2`, 10000, async () => {
      const documentLeadIds = [...new Set([hydratedLead.id, hydratedLead.caseId].filter(Boolean))];
      const leadDocuments = async (collection) => {
        const pages = await Promise.all(documentLeadIds.map((leadId) => queryRecords(collection, {
          where: [{ field: "leadId", value: leadId }],
          orderBy: "leadId",
          direction: "asc",
          limit: 50,
          maxLimit: 50,
        })));
        const byId = new Map();
        pages.flatMap((page) => page.data).forEach((document) => byId.set(document.id, document));
        return [...byId.values()].sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || ""))).slice(0, 50);
      };
      const [documents, bankDocuments] = await Promise.all([
        leadDocuments("documents"),
        leadDocuments("bankDocuments"),
      ]);
      const hydrateDocumentUrls = async (rows) => Promise.all(rows.map(async (document) => ({
        ...document,
        url: document.url || document.fileUrl || document.downloadUrl || await createShortLivedDocumentUrl(document.storagePath || document.filePath),
      })));
      return {
        hydratedDocuments: await hydrateDocumentUrls(documents),
        hydratedBankDocuments: await hydrateDocumentUrls(bankDocuments),
      };
    });
    res.json({
      ...hydratedLead,
      documents: hydratedDocuments,
      bankDocuments: hydratedBankDocuments,
    });
  } catch (error) {
    next(error);
  }
}

export async function getBankAnalytics(req, res, next) {
  try {
    const partner = await currentPartner(req);
    if (!partner) return res.status(404).json({ message: "Bank partner profile not found" });
    const analyticsCacheKey = `bank:analytics:${partner.roleType}:${partner.bankId || partner.bankPartnerId || partner.id || ""}:${partner.email || ""}`;
    const leads = await cached(analyticsCacheKey, 15000, () => assignedLeadsForPartner(partner, { limit: 100 }));
    const today = new Date().toISOString().slice(0, 10);
    const identity = bankIdentity(partner);
    const activeStatuses = [
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
    ];
    const statusOf = (lead) => normalizeStatus(lead.status || lead.assignmentStatus);
    const activeLeads = leads.filter((lead) => activeStatuses.includes(statusOf(lead)));
    const disbursedLeads = leads.filter((lead) => statusOf(lead) === LEAD_STATUSES.DISBURSED);
    const approvedLeads = leads.filter((lead) => [LEAD_STATUSES.APPROVED, LEAD_STATUSES.DISBURSED].includes(statusOf(lead)));
    const rejectedLeads = leads.filter((lead) => statusOf(lead) === LEAD_STATUSES.REJECTED);
    const pendingDocumentLeads = leads.filter((lead) => [LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.DOCUMENT_RECEIVED, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING].includes(statusOf(lead)));
    const overdueLeads = leads.filter((lead) => slaLabelForLead(lead) === "Overdue");
    const disbursedAmount = disbursedLeads.reduce((sum, lead) => sum + Number(lead.disbursedAmount || lead.loanAmount || lead.requiredLoanAmount || 0), 0);
    const branchMap = new Map();
    const executiveMap = new Map();

    for (const lead of leads) {
      const branch = lead.bankBranchCity || lead.branchCity || lead.routingCity || lead.dealershipCity || identity.bankLocation || "Unassigned Branch";
      const branchRow = branchMap.get(branch) || {
        branch,
        assignedLeads: 0,
        activeLeads: 0,
        approvedLeads: 0,
        disbursedLeads: 0,
        rejectedLeads: 0,
        pendingDocuments: 0,
        slaOverdue: 0,
      };
      branchRow.assignedLeads += 1;
      if (activeStatuses.includes(statusOf(lead))) branchRow.activeLeads += 1;
      if ([LEAD_STATUSES.APPROVED, LEAD_STATUSES.DISBURSED].includes(statusOf(lead))) branchRow.approvedLeads += 1;
      if (statusOf(lead) === LEAD_STATUSES.DISBURSED) branchRow.disbursedLeads += 1;
      if (statusOf(lead) === LEAD_STATUSES.REJECTED) branchRow.rejectedLeads += 1;
      if ([LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.DOCUMENT_RECEIVED, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING].includes(statusOf(lead))) branchRow.pendingDocuments += 1;
      if (slaLabelForLead(lead) === "Overdue") branchRow.slaOverdue += 1;
      branchMap.set(branch, branchRow);

      const executiveId = lead.assignedExecutiveId || lead.assignedExecutiveEmail || lead.assignedExecutiveName || "unassigned";
      const executiveName = lead.assignedExecutiveName || lead.assignedExecutiveEmail || lead.assignedExecutiveId || "Unassigned";
      const executiveRow = executiveMap.get(executiveId) || {
        executiveId,
        executiveName,
        mobile: lead.assignedExecutiveMobile || lead.executiveMobile || "",
        branch,
        assignedLeads: 0,
        activeLeads: 0,
        approvedLeads: 0,
        disbursedLeads: 0,
        rejectedLeads: 0,
        pendingDocuments: 0,
        slaOverdue: 0,
      };
      executiveRow.assignedLeads += 1;
      if (activeStatuses.includes(statusOf(lead))) executiveRow.activeLeads += 1;
      if ([LEAD_STATUSES.APPROVED, LEAD_STATUSES.DISBURSED].includes(statusOf(lead))) executiveRow.approvedLeads += 1;
      if (statusOf(lead) === LEAD_STATUSES.DISBURSED) executiveRow.disbursedLeads += 1;
      if (statusOf(lead) === LEAD_STATUSES.REJECTED) executiveRow.rejectedLeads += 1;
      if ([LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.DOCUMENT_RECEIVED, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING].includes(statusOf(lead))) executiveRow.pendingDocuments += 1;
      if (slaLabelForLead(lead) === "Overdue") executiveRow.slaOverdue += 1;
      executiveMap.set(executiveId, executiveRow);
    }

    res.json({
      bankName: identity.bankName,
      branch: identity.bankLocation || null,
      assignedLeads: leads.length,
      pendingLeads: activeLeads.length,
      approvedLeads: approvedLeads.length,
      disbursedLeads: disbursedLeads.length,
      rejectedLeads: rejectedLeads.length,
      pendingDocuments: pendingDocumentLeads.length,
      slaDueToday: leads.filter((lead) => (lead.assignmentTimestamp || lead.createdAt || "").startsWith(today)).length,
      slaOverdue: overdueLeads.length,
      disbursedAmount,
      conversionRate: leads.length ? Math.round((approvedLeads.length / leads.length) * 100) : 0,
      rejectionRate: leads.length ? Math.round((rejectedLeads.length / leads.length) * 100) : 0,
      branchMetrics: [...branchMap.values()].sort((left, right) => right.assignedLeads - left.assignedLeads),
      executivePerformance: [...executiveMap.values()].sort((left, right) => right.activeLeads - left.activeLeads),
      recentCases: leads
        .slice()
        .sort((left, right) => String(right.updatedAt || right.assignmentTimestamp || right.createdAt || "").localeCompare(String(left.updatedAt || left.assignmentTimestamp || left.createdAt || "")))
        .slice(0, 10)
        .map((lead) => ({
          id: lead.id,
          caseId: lead.caseId || lead.id,
          customerName: lead.fullName || lead.customerName || "",
          status: statusOf(lead),
          executiveName: lead.assignedExecutiveName || lead.assignedExecutiveEmail || "",
          branch: lead.bankBranchCity || lead.branchCity || lead.routingCity || lead.dealershipCity || identity.bankLocation || "",
          sla: slaLabelForLead(lead),
          updatedAt: lead.updatedAt || lead.statusUpdatedAt || lead.assignmentTimestamp || lead.createdAt || null,
        })),
    });
  } catch (error) {
    next(error);
  }
}

export async function getBankNotifications(req, res, next) {
  try {
    const partner = await currentPartner(req);
    if (!partner) return res.status(404).json({ message: "Bank partner profile not found" });
    const leads = await cached(`bank:notifications:${partner.roleType}:${partner.bankId || partner.bankPartnerId || partner.id || ""}:${partner.email || ""}`, 15000, () => assignedLeadsForPartner(partner));
    const rows = leads
      .filter((lead) => {
        const status = normalizeStatus(lead.status);
        return [LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.DOCUMENT_RECEIVED, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING, LEAD_STATUSES.UNDER_BANK_PROCESS, LEAD_STATUSES.APPROVED, LEAD_STATUSES.REJECTED, LEAD_STATUSES.DISBURSED, LEAD_STATUSES.ASSIGNED].includes(status)
          || slaLabelForLead(lead) === "Overdue";
      })
      .slice(0, 40)
      .map((lead) => ({
        id: lead.id,
        caseId: lead.caseId,
        title: slaLabelForLead(lead) === "Overdue" ? "SLA alert" : `${STATUS_LABELS[normalizeStatus(lead.status)] || "Lead"} update`,
        message: `${lead.fullName || lead.customerName || "Customer"} - ${lead.assignedExecutiveName || "Auto queue"}`,
        status: normalizeStatus(lead.status),
        createdAt: lead.updatedAt || lead.createdAt || lead.assignmentTimestamp,
      }));
    res.json(rows);
  } catch (error) {
    next(error);
  }
}

function slaLabelForLead(lead) {
  const value = lead.slaAcceptDeadlineAt || lead.assignmentTimestamp;
  if (!value) return "Tracked";
  const deadline = lead.slaAcceptDeadlineAt ? new Date(value).getTime() : new Date(value).getTime() + 60 * 60 * 1000;
  return deadline <= Date.now() ? "Overdue" : "Active";
}

export async function acceptBankLead(req, res, next) {
  try {
    const { partner, lead } = await requireAssignedLead(req);
    const nextStatus = assertValidStatusTransition(lead.status, LEAD_STATUSES.ACCEPTED);
    const updated = await updateRecord("leads", lead.id, { status: nextStatus, assignmentStatus: "accepted" });
    clearLeadDetailCaches(lead.id);
    clearBankSummaryCaches();
    syncLeadProjectionSoon(updated);
    const assignments = await queryRecords("leadAssignments", {
      where: [{ field: "leadId", value: lead.id }],
      orderBy: "leadId",
      direction: "asc",
      limit: 25,
      maxLimit: 25,
    }).catch(() => ({ data: [] }));
    const assignment = assignments.data.find((item) => item.partnerId === partner.id || item.partnerId === partner.email);
    if (assignment) await updateRecord("leadAssignments", assignment.id, { status: "accepted", acceptedAt: new Date().toISOString() });
    await updateSlaForLead(updated, nextStatus);
    await addTimelineEvent({
      leadId: lead.id,
      eventType: TIMELINE_EVENTS.EXECUTIVE_ACCEPTED,
      title: "Executive Accepted Lead",
      description: `${partner.companyName || partner.bankName || partner.name || "Bank user"} accepted the lead`,
      actorName: partner.email || partner.name || partner.fullName,
      actorRole: req.user?.role || "bank",
      branchId: partner.branchId || null,
      metadata: { status: nextStatus, customerName: lead.fullName },
      leadSnapshot: lead,
    });
    await writeAuditLog({ req, actionType: "BANK_ACCEPT", newValue: nextStatus, leadId: lead.id });
    res.json({ message: "Lead accepted", lead: updated });
  } catch (error) {
    next(error);
  }
}

export async function rejectBankLead(req, res, next) {
  try {
    const reason = String(req.body.reason || "").trim();
    const remarks = String(req.body.remarks || "").trim();
    if (!reason) return res.status(400).json({ message: "Rejection reason is required" });
    const { partner, lead } = await requireAssignedLead(req);
    const nextStatus = assertValidStatusTransition(lead.status, LEAD_STATUSES.REJECTED);
    const updated = await updateRecord("leads", lead.id, { status: nextStatus, rejectionReason: reason, rejectionRemarks: remarks });
    clearLeadDetailCaches(lead.id);
    clearBankSummaryCaches();
    syncLeadProjectionSoon(updated);
    await updateSlaForLead(updated, nextStatus);
    await addTimelineEvent({
      leadId: lead.id,
      eventType: TIMELINE_EVENTS.REJECTION,
      title: "Lead Rejected",
      description: remarks ? `${reason} - ${remarks}` : reason,
      actorName: partner.email || partner.name || partner.fullName,
      actorRole: req.user?.role || "bank",
      branchId: partner.branchId || null,
      metadata: { reason, remarks, status: nextStatus, customerName: lead.fullName },
      leadSnapshot: lead,
    });
    await addTimelineEvent({
      leadId: lead.id,
      eventType: TIMELINE_EVENTS.REJECTION_REASON_ADDED,
      title: "Rejection Reason Added",
      description: reason,
      actorName: partner.email || partner.name || partner.fullName,
      actorRole: req.user?.role || "bank",
      metadata: { reason, remarks },
      leadSnapshot: lead,
    });
    await createNotification({ type: "rejection", title: "Lead rejected", message: remarks ? `${reason} - ${remarks}` : reason, leadId: lead.id, partnerId: partner.id, dealerEmail: lead.dealerEmail, admin: true, recipientRole: "finance-desk", recipientId: lead.dealerEmail, phoneNumber: lead.dealerMobile, priority: "high", meta: { customerName: lead.fullName, reason, remarks } });
    await writeAuditLog({ req, actionType: "BANK_REJECT", newValue: reason, leadId: lead.id });
    res.json({ message: "Lead rejected. Manual reassignment can be performed by bank manager if needed" });
  } catch (error) {
    next(error);
  }
}

export async function reassignBankLead(req, res, next) {
  try {
    const { partner, lead } = await requireAssignedLead(req);
    if (req.user?.role !== "bank-manager" && partner.roleType !== "bank-manager") {
      return res.status(403).json({ message: "Only bank managers can reassign leads" });
    }
    const reason = String(req.body.reason || "manager-reassignment").trim();
    const updated = await reassignLeadToNextBranchExecutive(lead.id, reason, partner.email || partner.id || "bank-manager");
    clearLeadDetailCaches(lead.id);
    clearBankSummaryCaches();
    syncLeadProjectionSoon(updated);
    await writeAuditLog({ req, actionType: "BANK_MANAGER_REASSIGN", newValue: reason, leadId: lead.id });
    res.json({ message: "Lead reassigned to next same-branch executive", lead: updated });
  } catch (error) {
    next(error);
  }
}

export async function updateBankLeadStatus(req, res, next) {
  try {
    const { partner, lead } = await requireAssignedLead(req);
    const normalizedStatus = normalizeStatus(req.body.status);
    if (!bankStatuses.includes(normalizedStatus)) return res.status(400).json({ message: "Invalid bank lead status" });
    const pendingDocument = String(req.body.pendingDocument || "").trim();
    const requestedDocuments = Array.isArray(req.body.pendingDocumentsRequested)
      ? req.body.pendingDocumentsRequested.map((item) => String(item || "").trim()).filter(Boolean)
      : pendingDocument ? [pendingDocument] : [];
    const pendingDocumentReason = String(req.body.pendingDocumentReason || req.body.remarks || "").trim();
    const now = new Date().toISOString();
    const executiveName = partner.name || partner.fullName || partner.email || req.user?.email;
    const rejectionReason = String(req.body.rejectionReason || req.body.reason || req.body.remarks || "").trim();
    const statusPayload = {
      status: normalizedStatus,
      updatedAt: now,
      statusUpdatedAt: now,
      updatedByExecutiveId: partner.id || partner.email || req.user?.email,
      updatedByExecutiveName: executiveName,
      ...(normalizedStatus === LEAD_STATUSES.APPROVED ? {
        approvedAmount: req.body.approvedAmount,
        roi: req.body.roi,
        tenure: req.body.tenure,
        emi: req.body.emi,
        processingFee: req.body.processingFee,
        sanctionNumber: req.body.sanctionNumber,
        sanctionDate: req.body.sanctionDate,
        approvalRemarks: req.body.remarks,
      } : {}),
      ...(normalizedStatus === LEAD_STATUSES.REJECTED ? {
        rejectionReason,
        rejectedAt: now,
        rejectedBy: executiveName,
        rejectionRemarks: req.body.remarks,
      } : {}),
      ...(normalizedStatus === LEAD_STATUSES.DISBURSED ? {
        disbursedAmount: req.body.disbursedAmount,
        disbursementDate: req.body.disbursementDate,
        utrNumber: req.body.utrNumber,
        disbursementRemarks: req.body.remarks,
      } : {}),
      ...([LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING].includes(normalizedStatus) ? {
        pendingDocuments: requestedDocuments.length
          ? [...new Set([...(Array.isArray(lead.pendingDocuments) ? lead.pendingDocuments : []), ...requestedDocuments])]
          : lead.pendingDocuments,
        pendingDocumentsRequested: requestedDocuments.length
          ? [...(Array.isArray(lead.pendingDocumentsRequested) ? lead.pendingDocumentsRequested : []), {
            documents: requestedDocuments,
            notes: pendingDocumentReason,
            requestedByExecutiveId: partner.id || partner.email || req.user?.email,
            requestedByExecutiveName: executiveName,
            requestedAt: now,
          }]
          : lead.pendingDocumentsRequested,
        pendingDocumentReason,
      } : {}),
    };
    const updated = await updateRecord("leads", lead.id, statusPayload);
    clearLeadDetailCaches(lead.id);
    clearBankSummaryCaches();
    syncLeadProjectionSoon(updated);
    const statusLabel = STATUS_LABELS[normalizedStatus] || normalizedStatus;
    res.json({ message: "Lead status updated", lead: updated });
    setImmediate(() => {
      Promise.allSettled([
        updateSlaForLead(updated, normalizedStatus),
        ensureCommissionForLead(updated, normalizedStatus),
        addTimelineEvent({
          leadId: lead.id,
          eventType: normalizedStatus === LEAD_STATUSES.APPROVED
            ? TIMELINE_EVENTS.APPROVAL
            : normalizedStatus === LEAD_STATUSES.REJECTED
              ? TIMELINE_EVENTS.REJECTION
              : normalizedStatus === LEAD_STATUSES.DISBURSED
                ? TIMELINE_EVENTS.DISBURSEMENT_MARKED
                : [LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING].includes(normalizedStatus)
                  ? TIMELINE_EVENTS.PENDING_DOCUMENTS_REQUESTED
                  : TIMELINE_EVENTS.STATUS_CHANGED,
          title: `Status: ${statusLabel}`,
          description: pendingDocument ? `${pendingDocument}: ${pendingDocumentReason || "Document requested"}` : `Bank updated status to ${statusLabel}`,
          actorName: partner.email || partner.name || partner.fullName,
          actorRole: req.user?.role || "bank",
          branchId: partner.branchId || null,
          metadata: { status: normalizedStatus, nextStatus: normalizedStatus, customerName: lead.fullName, pendingDocument, pendingDocumentReason },
          leadSnapshot: updated,
        }),
        createNotification({ type: normalizedStatus === LEAD_STATUSES.APPROVED ? "approval" : normalizedStatus === LEAD_STATUSES.DISBURSED ? "disbursement" : [LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING].includes(normalizedStatus) ? "pending-documents" : normalizedStatus.toLowerCase().replace(/_/g, "-"), title: `Lead ${statusLabel}`, message: `Lead ${lead.caseId || lead.id} marked ${statusLabel}`, leadId: lead.id, dealerEmail: lead.dealerEmail, admin: true, recipientRole: "finance-desk", recipientId: lead.dealerEmail, phoneNumber: lead.dealerMobile, meta: { caseId: lead.caseId, customerName: lead.fullName, loanAmount: lead.loanAmount, bankName: partner.bankName || partner.companyName } }),
        writeAuditLog({
          req,
          actionType: normalizedStatus === LEAD_STATUSES.DISBURSED
            ? AUDIT_ACTIONS.DISBURSED
            : normalizedStatus === LEAD_STATUSES.REJECTED
              ? AUDIT_ACTIONS.REJECTED
              : [LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING].includes(normalizedStatus)
                ? AUDIT_ACTIONS.PENDING_DOCUMENT_REQUESTED
                : AUDIT_ACTIONS.STATUS_UPDATED,
          oldValue: lead.status,
          newValue: normalizedStatus,
          leadId: lead.id,
          meta: { caseId: lead.caseId, oldStatus: lead.status, newStatus: normalizedStatus, dealershipId: lead.dealershipId, bankId: lead.bankId, assignedExecutiveId: lead.assignedExecutiveId },
        }),
      ]).then((results) => {
        results.filter((result) => result.status === "rejected").forEach((result) => logError("Bank status side effect failed", { error: result.reason?.message || String(result.reason), leadId: lead.id, status: normalizedStatus }));
      });
    });
  } catch (error) {
    next(error);
  }
}

export async function updateBankLeadRemarks(req, res, next) {
  try {
    const remarks = String(req.body.remarks || "").trim();
    const { partner, lead } = await requireAssignedLead(req);
    const updated = await updateRecord("leads", lead.id, { bankRemarks: remarks });
    clearLeadDetailCaches(lead.id);
    clearBankSummaryCaches();
    syncLeadProjectionSoon(updated);
    await addTimelineEvent({
      leadId: lead.id,
      eventType: TIMELINE_EVENTS.INTERNAL_REMARKS_ADDED,
      title: "Internal Remarks Added",
      description: remarks,
      actorName: partner.email || partner.name || partner.fullName,
      actorRole: req.user?.role || "bank",
      metadata: { remarks },
      leadSnapshot: lead,
    });
    await writeAuditLog({ req, actionType: "REMARKS_CHANGE", newValue: remarks, leadId: lead.id });
    res.json({ message: "Remarks saved", lead: updated });
  } catch (error) {
    next(error);
  }
}

export async function uploadBankLeadDocument(req, res, next) {
  try {
    const { partner, lead } = await requireAssignedLead(req);
    if (!req.file) return res.status(400).json({ message: "Document file is required" });
    const uploaded = await uploadLeadDocument(req.file, lead.id, {
      dealershipId: lead.dealershipId,
      caseId: lead.caseId,
      bankId: lead.bankId || partner.bankId || partner.bankPartnerId || partner.id,
      assignedExecutiveId: lead.assignedExecutiveId,
      assignedExecutiveEmail: lead.assignedExecutiveEmail,
      uploadedBy: partner.email,
    });
    const document = await createRecord("bankDocuments", {
      leadId: lead.id,
      caseId: lead.caseId || lead.id,
      partnerId: partner.id,
      uploadedBy: partner.email,
      dealershipId: lead.dealershipId || null,
      bankId: lead.bankId || partner.bankId || partner.bankPartnerId || partner.id,
      assignedExecutiveId: lead.assignedExecutiveId || null,
      documentType: req.body.documentType || "query-document",
      ...uploaded,
    });
    clearLeadDetailCaches(lead.id);
    clearBankSummaryCaches();
    const isSanction = String(document.documentType || "").includes("sanction");
    if (isSanction) {
      const updatedLead = await updateRecord("leads", lead.id, {
        sanctionLetterUrl: uploaded?.url || null,
        sanctionLetterStoragePath: uploaded?.storagePath || null,
        sanctionLetterDocumentId: document.id,
        sanctionLetterUploadedAt: document.createdAt || new Date().toISOString(),
        sanctionLetterUploadedBy: partner.email || req.user?.email || null,
        updatedAt: new Date().toISOString(),
      });
      syncLeadProjectionSoon(updatedLead);
    }
    await addTimelineEvent({
      leadId: lead.id,
      eventType: isSanction ? TIMELINE_EVENTS.SANCTION_LETTER_UPLOADED : TIMELINE_EVENTS.DOCUMENT_UPLOADED,
      title: isSanction ? "Sanction Letter Uploaded" : "Document Uploaded",
      description: document.documentType,
      actorName: partner.email || partner.name || partner.fullName,
      actorRole: req.user?.role || "bank",
      metadata: { documentId: document.id, documentType: document.documentType },
      leadSnapshot: lead,
    });
    await createNotification({ type: "documents-uploaded", title: "Document uploaded", message: `${document.documentType} uploaded for lead ${lead.caseId || lead.id}`, leadId: lead.id, dealerEmail: lead.dealerEmail, recipientRole: "finance-desk", recipientId: lead.dealerEmail, phoneNumber: lead.dealerMobile, meta: { caseId: lead.caseId, customerName: lead.fullName, documents: [document.documentType] } });
    await writeAuditLog({ req, actionType: "DOCUMENT_UPLOAD", newValue: document.documentType, leadId: lead.id });
    res.status(201).json({ message: "Document uploaded", document });
  } catch (error) {
    next(error);
  }
}

export async function deleteBankLeadDocument(req, res, next) {
  try {
    const { partner, lead } = await requireAssignedLead(req);
    const document = await getRecord("bankDocuments", req.params.documentId);
    if (
      !document
      || !documentBelongsToLead(document, lead)
      || !documentBelongsToBank(document, lead, partner)
      || !documentBelongsToBranch(document, lead, partner)
      || !documentBelongsToExecutive(document, lead, partner)
    ) {
      recordOperationalEvent({
        type: "bank_document_delete_blocked",
        severity: ALERT_SEVERITY.HIGH,
        component: "bank-rbac",
        message: "Blocked bank document deletion outside lead ownership scope",
        entityId: req.params.documentId,
        requestId: req.requestId,
        meta: {
          actor: partner.email || partner.id,
          roleType: partner.roleType,
          leadId: lead.id,
          documentLeadId: document?.leadId || null,
          documentPartnerId: document?.partnerId || null,
        },
      }).catch(() => {});
      return res.status(404).json({ message: "Document not found" });
    }
    await deleteLeadDocument(document.storagePath);
    await deleteRecord("bankDocuments", document.id);
    clearLeadDetailCaches(lead.id);
    clearBankSummaryCaches();
    await addTimelineEvent({ leadId: lead.id, eventType: TIMELINE_EVENTS.DOCUMENT_REPLACED, title: "Document Removed", description: document.documentType, actorName: partner.email || partner.name || partner.fullName, actorRole: req.user?.role || "bank", metadata: { documentType: document.documentType }, leadSnapshot: lead });
    await writeAuditLog({ req, actionType: "DOCUMENT_DELETE", oldValue: document.documentType, leadId: lead.id });
    res.json({ message: "Document deleted" });
  } catch (error) {
    next(error);
  }
}

export async function getBankLeadTimeline(req, res, next) {
  try {
    await requireAssignedLead(req);
    res.json(await getTimelineForLead(req.params.id));
  } catch (error) {
    next(error);
  }
}
