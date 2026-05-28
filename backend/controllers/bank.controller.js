import { createRecord, deleteRecord, getRecord, listRecords, queryRecords, updateRecord, upsertRecord } from "../services/firestore.service.js";
import { ensureCommissionForLead } from "../services/commission.service.js";
import { createNotification } from "../services/notification.service.js";
import { reassignLeadToNextBranchExecutive, retrieveAndReassignLead } from "../services/assignment.service.js";
import { updateSlaForLead } from "../services/sla.service.js";
import { addTimelineEvent, getTimelineForLead, TIMELINE_EVENTS } from "../services/timeline.service.js";
import { deleteLeadDocument, uploadLeadDocument } from "../services/storage.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "../services/audit.service.js";
import { assertValidStatusTransition, LEAD_STATUSES, normalizeStatus, STATUS_LABELS } from "../utils/status.constants.js";
import { firebaseAdmin } from "../firebase/admin.js";
import { queryBankLeads, queryExecutiveLeads } from "../services/leadQuery.service.js";
import { ALERT_SEVERITY, emitOperationalAlert, recordOperationalEvent } from "../services/observability.service.js";
import { paginationParams, pageResponse } from "../utils/pagination.js";

const bankStatuses = [
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

async function currentPartner(req) {
  const email = userEmail(req);
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

  const partners = await listRecords("bankPartners");
  const partner = partners.find((item) => item.email === email || item.id === email) || null;
  return partner ? { ...partner, roleType: req.user?.role || partner.role } : null;
}

function partnerCanAccessLead(partner, lead) {
  if (!partner || !lead) return false;
  if (partner.roleType === "loan-executive") {
    return lead.assignedExecutiveId === partner.id
      || lead.assignedExecutiveId === partner.email
      || lead.assignedExecutiveEmail === partner.email;
  }

  if (partner.roleType === "bank-manager") {
    const partnerCity = partner.branchCity || partner.city || partner.operatingCity;
    const leadCity = lead.bankBranchCity || lead.branchCity || lead.routingCity || lead.dealershipCity;
    const sameCity = !partnerCity || partnerCity === leadCity;
    const sameBank = lead.bankId === partner.bankId
      || lead.bankId === partner.bankPartnerId
      || lead.assignedBankId === partner.bankId
      || lead.assignedPartnerId === partner.bankPartnerId
      || lead.assignedPartnerId === partner.partnerId
      || lead.assignedBankId === partner.bankPartnerId
      || lead.assignedBankId === partner.partnerId
      || lead.assignedBankId === partner.bankName
      || lead.bankPartner === partner.bankName
      || lead.assignedBankName === partner.bankName
      || lead.preferredBank === partner.bankName;
    return sameCity && sameBank;
  }

  const supportedBanks = Array.isArray(partner.supportedBanks) ? partner.supportedBanks : [];
  return lead.assignedPartnerId === partner.id
    || lead.assignedPartnerId === partner.email
    || lead.assignedBankId === partner.id
    || lead.assignedBankId === partner.email
    || lead.bankPartner === partner.bankName
    || lead.bankPartner === partner.companyName
    || lead.assignedBankName === partner.bankName
    || lead.assignedBankName === partner.companyName
    || supportedBanks.includes(lead.preferredBank)
    || supportedBanks.includes(lead.bankPartner);
}

function bankIdentity(partner) {
  const bankId = partner.bankPartnerId || partner.partnerId || partner.bankId || partner.id || partner.email || partner.bankName;
  return {
    bankId,
    bankName: partner.bankName || partner.companyName || partner.name || bankId,
    bankLocation: partner.bankBranchLocation || partner.branchLocation || partner.branchCity || partner.city || partner.operatingCity,
  };
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
    const pendingDocsOk = !query.pendingDocs || normalizeStatus(lead.status) === LEAD_STATUSES.DOCS_PENDING;
    return statusOk && dateOk && searchOk && slaOk && executiveOk && dealershipOk && pendingDocsOk;
  });
}

async function liveBankRegistrationForAccount(account) {
  if (!account?.email) return { approval: null, bankPartner: null, branchManager: null, live: false };
  const approvals = await listRecords("pendingBankApprovals");
  const approval = approvals.find((item) =>
    item.id === account.approvalRequestId
    || item.email === account.email
    || item.officialEmail === account.email
    || item.primaryGoogleEmail === account.email
  ) || null;
  const bankPartner = (await listRecords("bankPartners")).find((item) => item.email === account.email || item.officialEmail === account.email || item.id === account.email) || null;
  const branchManager = (await listRecords("branchManagers")).find((item) => item.email === account.email || item.officialEmail === account.email || item.id === account.email) || null;
  return { approval, bankPartner, branchManager, live: Boolean(approval || bankPartner || branchManager) };
}

async function assignedLeadsForPartner(partner, query = {}) {
  const attachExecutiveMobile = async (leads) => {
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
        item.id === lead.assignedExecutiveId
        || item.email === lead.assignedExecutiveEmail
        || item.officialEmail === lead.assignedExecutiveEmail
        || item.email === lead.assignedExecutiveId
      );
      return executive?.mobile ? { ...lead, assignedExecutiveMobile: executive.mobile } : lead;
    });
  };

  if (partner.roleType === "loan-executive") {
    const result = await queryExecutiveLeads({ executiveId: partner.id, executiveEmail: partner.email, query: { ...query, limit: query.limit || 100 } });
    return attachExecutiveMobile(applyFilters(result.data, query));
  }
  const identity = bankIdentity(partner);
  const result = await queryBankLeads({ bankId: identity.bankId, query: { ...query, limit: query.limit || 100 } });
  return attachExecutiveMobile(applyFilters(result.data.filter((lead) => partnerCanAccessLead(partner, lead)), query));
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

export async function registerBankPartner(req, res, next) {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Email is required" });
    const now = new Date().toISOString();
    let pendingAccount = (await listRecords("pendingBankAccounts")).find((item) => item.email === email);
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

    const request = await createRecord("pendingBankApprovals", {
      email,
      type: "bank",
      accountType: "bank",
      status: "pending",
      companyName: String(req.body.companyName || "").trim(),
      bankName: String(req.body.bankName || req.body.companyName || req.body.supportedBanks?.[0] || "").trim(),
      ifsc: String(req.body.ifsc || "").trim().toUpperCase(),
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
    let existing = (await listRecords("pendingBankAccounts")).find((item) => item.email === email);
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
    await upsertRecord("users", email, {
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
    const account = (await listRecords("pendingBankAccounts")).find((item) => item.email === email);
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
  try {
    const partner = await currentPartner(req);
    if (!partner) return res.status(404).json({ message: "Bank partner profile not found" });
    if (partner.roleType === "loan-executive") {
      return res.json(await queryExecutiveLeads({ executiveId: partner.id, executiveEmail: partner.email, query: req.query }));
    }
    const { limit } = paginationParams(req.query);
    const scopedLeads = await assignedLeadsForPartner(partner, { ...req.query, limit: Math.min(Math.max(limit * 3, limit), 100) });
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
    return res.json(pageResponse({ data, limit, nextCursor: null, total: scopedLeads.length }));
  } catch (error) {
    next(error);
  }
}

export async function getBankExecutives(req, res, next) {
  try {
    const partner = await currentPartner(req);
    if (!partner || partner.roleType !== "bank-manager") return res.status(403).json({ message: "Only bank managers can view executives" });
    const identity = bankIdentity(partner);
    const [executivesPage, leads] = await Promise.all([
      queryRecords("loanExecutives", {
        where: [{ field: "bankId", value: identity.bankId }],
        orderBy: "createdAt",
        direction: "desc",
        limit: 100,
        maxLimit: 100,
      }),
      assignedLeadsForPartner(partner),
    ]);
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
    const payload = {
      id: email,
      name,
      fullName: name,
      email,
      officialEmail: email,
      mobile,
      jobId,
      bankPartnerId: identity.bankId,
      bankId: identity.bankId,
      bankName: identity.bankName,
      bankLocation: identity.bankLocation,
      bankBranchLocation: identity.bankLocation,
      branchCity: identity.bankLocation,
      createdByManagerId: partner.email || partner.id,
      status: "active",
      active: true,
      accountActive: true,
      createdAt: now,
    };
    await upsertRecord("loanExecutives", email, payload);
    await upsertRecord("users", email, {
      uid: email,
      email,
      role: "loan-executive",
      approved: true,
      active: true,
      accountApproved: true,
      accountActive: true,
      bankId: identity.bankId,
      branchId: identity.bankLocation,
      status: "active",
    });
    const executive = await getRecord("loanExecutives", email);
    await writeAuditLog({ req, actionType: "BANK_EXECUTIVE_CREATED", newValue: jobId, meta: { executiveId: executive.id, bankId: identity.bankId } });
    res.status(201).json(executive);
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
    const updated = await updateRecord("loanExecutives", executive.id, {
      active: false,
      accountActive: false,
      status: "inactive",
      removedAt: new Date().toISOString(),
      removedByManagerId: partner.email || partner.id,
    });
    if (executive.email) {
      await upsertRecord("users", executive.email, {
        uid: executive.email,
        email: executive.email,
        role: "loan-executive",
        approved: true,
        active: false,
        accountApproved: true,
        accountActive: false,
        bankId: identity.bankId,
        branchId: identity.bankLocation,
        status: "inactive",
      });
    }
    await writeAuditLog({ req, actionType: "BANK_EXECUTIVE_REMOVED", oldValue: executive.status, newValue: "inactive", meta: { executiveId: executive.id, bankId: identity.bankId } });
    res.json({ message: "Executive removed", executive: updated });
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
    const leads = await assignedLeadsForPartner(partner, req.query);
    const rows = leads.filter((lead) =>
      lead.assignedExecutiveId === executive.id
      || lead.assignedExecutiveId === executive.jobId
      || lead.assignedExecutiveEmail === executive.email
      || lead.assignedExecutiveMobile === executive.mobile
      || lead.assignedExecutiveName === executive.name
      || lead.assignedExecutiveName === executive.fullName
    );
    res.json({ data: rows, executive });
  } catch (error) {
    next(error);
  }
}

export async function getBankLead(req, res, next) {
  try {
    const { lead } = await requireAssignedLead(req);
    const [documents, bankDocuments] = await Promise.all([
      queryRecords("documents", {
        where: [{ field: "leadId", value: lead.id }],
        orderBy: "createdAt",
        direction: "desc",
        limit: 50,
        maxLimit: 50,
      }),
      queryRecords("bankDocuments", {
        where: [{ field: "leadId", value: lead.id }],
        orderBy: "createdAt",
        direction: "desc",
        limit: 50,
        maxLimit: 50,
      }),
    ]);
    res.json({
      ...lead,
      documents: documents.data,
      bankDocuments: bankDocuments.data,
    });
  } catch (error) {
    next(error);
  }
}

export async function getBankAnalytics(req, res, next) {
  try {
    const partner = await currentPartner(req);
    if (!partner) return res.status(404).json({ message: "Bank partner profile not found" });
    const leads = await assignedLeadsForPartner(partner);
    const today = new Date().toISOString().slice(0, 10);
    res.json({
      assignedLeads: leads.length,
      pendingLeads: leads.filter((lead) => [LEAD_STATUSES.NEW, LEAD_STATUSES.ASSIGNED, LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW].includes(normalizeStatus(lead.status || lead.assignmentStatus))).length,
      approvedLeads: leads.filter((lead) => [LEAD_STATUSES.APPROVED, LEAD_STATUSES.DISBURSED].includes(normalizeStatus(lead.status))).length,
      rejectedLeads: leads.filter((lead) => normalizeStatus(lead.status) === LEAD_STATUSES.REJECTED).length,
      slaDueToday: leads.filter((lead) => (lead.assignmentTimestamp || lead.createdAt || "").startsWith(today)).length,
    });
  } catch (error) {
    next(error);
  }
}

export async function getBankNotifications(req, res, next) {
  try {
    const partner = await currentPartner(req);
    if (!partner) return res.status(404).json({ message: "Bank partner profile not found" });
    const leads = await assignedLeadsForPartner(partner);
    const rows = leads
      .filter((lead) => {
        const status = normalizeStatus(lead.status);
        return [LEAD_STATUSES.DOCS_PENDING, LEAD_STATUSES.APPROVED, LEAD_STATUSES.REJECTED, LEAD_STATUSES.DISBURSED, LEAD_STATUSES.ASSIGNED].includes(status)
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
    const assignments = await listRecords("leadAssignments");
    const assignment = assignments.find((item) => item.leadId === lead.id && (item.partnerId === partner.id || item.partnerId === partner.email));
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
    });
    await addTimelineEvent({
      leadId: lead.id,
      eventType: TIMELINE_EVENTS.REJECTION_REASON_ADDED,
      title: "Rejection Reason Added",
      description: reason,
      actorName: partner.email || partner.name || partner.fullName,
      actorRole: req.user?.role || "bank",
      metadata: { reason, remarks },
    });
    await createNotification({ type: "rejection", title: "Lead rejected", message: remarks ? `${reason} - ${remarks}` : reason, leadId: lead.id, partnerId: partner.id, dealerEmail: lead.dealerEmail, admin: true, recipientRole: "finance-desk", recipientId: lead.dealerEmail, phoneNumber: lead.dealerMobile, priority: "high", meta: { customerName: lead.fullName, reason, remarks } });
    const assignment = await retrieveAndReassignLead(lead.id, "bank-partner-rejected", partner.email);
    await writeAuditLog({ req, actionType: "BANK_REJECT", newValue: reason, leadId: lead.id });
    res.json({ message: "Lead rejected and reassignment triggered", assignment });
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
    await writeAuditLog({ req, actionType: "BANK_MANAGER_REASSIGN", newValue: reason, leadId: lead.id });
    res.json({ message: "Lead reassigned to next same-branch executive", lead: updated });
  } catch (error) {
    next(error);
  }
}

export async function updateBankLeadStatus(req, res, next) {
  try {
    const { partner, lead } = await requireAssignedLead(req);
    const normalizedStatus = assertValidStatusTransition(lead.status, req.body.status);
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
      ...(normalizedStatus === LEAD_STATUSES.DOCS_PENDING ? {
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
    await updateSlaForLead(updated, normalizedStatus);
    await ensureCommissionForLead(updated, normalizedStatus);
    const statusLabel = STATUS_LABELS[normalizedStatus] || normalizedStatus;
    await addTimelineEvent({
      leadId: lead.id,
      eventType: normalizedStatus === LEAD_STATUSES.APPROVED
        ? TIMELINE_EVENTS.APPROVAL
        : normalizedStatus === LEAD_STATUSES.REJECTED
          ? TIMELINE_EVENTS.REJECTION
          : normalizedStatus === LEAD_STATUSES.DISBURSED
            ? TIMELINE_EVENTS.DISBURSEMENT_MARKED
            : normalizedStatus === LEAD_STATUSES.DOCS_PENDING
              ? TIMELINE_EVENTS.PENDING_DOCUMENTS_REQUESTED
              : TIMELINE_EVENTS.STATUS_CHANGED,
      title: `Status: ${statusLabel}`,
      description: pendingDocument ? `${pendingDocument}: ${pendingDocumentReason || "Document requested"}` : `Bank updated status to ${statusLabel}`,
      actorName: partner.email || partner.name || partner.fullName,
      actorRole: req.user?.role || "bank",
      branchId: partner.branchId || null,
      metadata: { status: normalizedStatus, nextStatus: normalizedStatus, customerName: lead.fullName, pendingDocument, pendingDocumentReason },
    });
    await createNotification({ type: normalizedStatus === LEAD_STATUSES.APPROVED ? "approval" : normalizedStatus === LEAD_STATUSES.DISBURSED ? "disbursement" : normalizedStatus === LEAD_STATUSES.DOCS_PENDING ? "pending-documents" : normalizedStatus.toLowerCase().replace(/_/g, "-"), title: `Lead ${statusLabel}`, message: `Lead ${lead.caseId || lead.id} marked ${statusLabel}`, leadId: lead.id, dealerEmail: lead.dealerEmail, admin: true, recipientRole: "finance-desk", recipientId: lead.dealerEmail, phoneNumber: lead.dealerMobile, meta: { caseId: lead.caseId, customerName: lead.fullName, loanAmount: lead.loanAmount, bankName: partner.bankName || partner.companyName } });
    await writeAuditLog({
      req,
      actionType: normalizedStatus === LEAD_STATUSES.DISBURSED
        ? AUDIT_ACTIONS.DISBURSED
        : normalizedStatus === LEAD_STATUSES.REJECTED
          ? AUDIT_ACTIONS.REJECTED
          : normalizedStatus === LEAD_STATUSES.DOCS_PENDING
            ? AUDIT_ACTIONS.PENDING_DOCUMENT_REQUESTED
            : AUDIT_ACTIONS.STATUS_UPDATED,
      oldValue: lead.status,
      newValue: normalizedStatus,
      leadId: lead.id,
      meta: { caseId: lead.caseId, oldStatus: lead.status, newStatus: normalizedStatus, dealershipId: lead.dealershipId, bankId: lead.bankId, assignedExecutiveId: lead.assignedExecutiveId },
    });
    res.json({ message: "Lead status updated", lead: updated });
  } catch (error) {
    next(error);
  }
}

export async function updateBankLeadRemarks(req, res, next) {
  try {
    const remarks = String(req.body.remarks || "").trim();
    const { partner, lead } = await requireAssignedLead(req);
    const updated = await updateRecord("leads", lead.id, { bankRemarks: remarks });
    await addTimelineEvent({
      leadId: lead.id,
      eventType: TIMELINE_EVENTS.INTERNAL_REMARKS_ADDED,
      title: "Internal Remarks Added",
      description: remarks,
      actorName: partner.email || partner.name || partner.fullName,
      actorRole: req.user?.role || "bank",
      metadata: { remarks },
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
    const isSanction = String(document.documentType || "").includes("sanction");
    await addTimelineEvent({
      leadId: lead.id,
      eventType: isSanction ? TIMELINE_EVENTS.SANCTION_LETTER_UPLOADED : TIMELINE_EVENTS.DOCUMENT_UPLOADED,
      title: isSanction ? "Sanction Letter Uploaded" : "Document Uploaded",
      description: document.documentType,
      actorName: partner.email || partner.name || partner.fullName,
      actorRole: req.user?.role || "bank",
      metadata: { documentId: document.id, documentType: document.documentType },
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
    if (!document || document.partnerId !== partner.id) return res.status(404).json({ message: "Document not found" });
    await deleteLeadDocument(document.storagePath);
    await deleteRecord("bankDocuments", document.id);
    await addTimelineEvent({ leadId: lead.id, eventType: TIMELINE_EVENTS.DOCUMENT_REPLACED, title: "Document Removed", description: document.documentType, actorName: partner.email || partner.name || partner.fullName, actorRole: req.user?.role || "bank", metadata: { documentType: document.documentType } });
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
