import { createRecord, deleteRecord, getRecord, listRecords, updateRecord, upsertRecord } from "../services/firestore.service.js";
import { processSlaBreaches, retrieveAndReassignLead } from "../services/assignment.service.js";
import { ensureCommissionForLead } from "../services/commission.service.js";
import { createNotification } from "../services/notification.service.js";
import { freezePartner } from "../services/partner.service.js";
import { getWorkflowSettings, updateWorkflowSettings } from "../services/settings.service.js";
import { createSlaLog, updateSlaForLead } from "../services/sla.service.js";
import { getAuditLogs, writeAuditLog } from "../services/audit.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "../services/timeline.service.js";
import { assertValidStatusTransition, LEAD_STATUSES, normalizeStatus, STATUS_LABELS } from "../utils/status.constants.js";
import { firebaseAdmin } from "../firebase/admin.js";
import { queryAllLeads } from "../services/leadQuery.service.js";
import { computeLeadMetrics } from "../services/metrics.service.js";

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

function ecosystemLimit(value, fallback = 50) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : fallback;
}

async function boundedList(collection, limit, mapper = (item) => item) {
  const rows = await listRecords(collection);
  return rows.slice(0, limit).map(mapper);
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

function requestLoginEmail(request) {
  return normalizeEmail(request.loginEmail || request.primaryGoogleEmail || request.dealership?.loginEmail || request.financeDesk?.officialEmail || request.dealership?.officialDealershipEmail);
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
  await upsertRecord("users", loginEmail, {
    uid: loginEmail,
    email: loginEmail,
    role: "finance-desk",
    approved: true,
    active: true,
    accountApproved: true,
    accountActive: true,
    dealershipId: loginEmail,
    status: "active",
  });

  const gmEmail = normalizeEmail(request.generalManager?.email);
  if (gmEmail) {
    await upsertRecord("users", gmEmail, {
      uid: gmEmail,
      email: gmEmail,
      role: "gm-sm",
      approved: true,
      active: true,
      accountApproved: true,
      accountActive: true,
      dealershipId: loginEmail,
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

  const pendingAccounts = await listRecords("pendingDealerAccounts");
  const pendingAccount = pendingAccounts.find((item) =>
    item.id === request.pendingDealerAccountId
    || item.id === request.pendingDealerRegistrationId
    || item.email === loginEmail
    || item.uid === request.dealerUid
    || item.onboardingRequestId === request.id
    || item.approvalRequestId === request.approvalRequestId
  );
  if (pendingAccount) {
    await updateRecord("pendingDealerAccounts", pendingAccount.id, {
      registrationSubmitted: true,
      registrationCompleted: true,
      approvalStatus: "approved",
      accountApproved: true,
      accountActive: true,
      approvedAt: now,
      approvedBy,
    });
  }

  const approvals = await listRecords("pendingDealershipApprovals");
  const approval = approvals.find((item) =>
    item.id === request.approvalRequestId
    || item.onboardingRequestId === request.id
    || item.loginEmail === loginEmail
    || item.primaryGoogleEmail === loginEmail
  );
  if (approval) {
    await updateRecord("pendingDealershipApprovals", approval.id, {
      status: "approved",
      approvalStatus: "approved",
      gstinVerified: true,
      dealershipVerified: true,
      approvedAt: now,
      approvedBy,
    });
  }

  const queueItem = (await listRecords("dealerApprovalQueue")).find((item) =>
    item.pendingDealershipApprovalId === approval?.id
    || item.pendingDealerAccountId === pendingAccount?.id
    || item.onboardingRequestId === request.id
    || item.loginEmail === loginEmail
  );
  if (queueItem) {
    await updateRecord("dealerApprovalQueue", queueItem.id, {
      status: "approved",
      approvalStatus: "approved",
      approvedAt: now,
      approvedBy,
    });
  }

  return { loginEmail, dealership, pendingAccount, approval };
}

async function deleteMatchingRecords(collection, matcher) {
  const records = await listRecords(collection);
  const matches = records.filter(matcher);
  await Promise.all(matches.map((item) => deleteRecord(collection, item.id)));
  return matches.length;
}

export async function getAdminLeads(req, res, next) {
  try {
    res.json(await queryAllLeads({ query: req.query }));
  } catch (error) {
    next(error);
  }
}

export async function getAdminOnboardingRequests(req, res, next) {
  try {
    const requests = await listRecords("onboardingRequests");
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

export async function getPendingDealershipApprovals(req, res, next) {
  try {
    const status = String(req.query.status || "pending").trim().toLowerCase();
    const search = String(req.query.search || "").trim().toLowerCase();
    const requests = (await listRecords("pendingDealershipApprovals")).filter((item) => {
      const statusOk = !status || String(item.status || "").toLowerCase() === status;
      const typeOk = (item.accountType || item.type || "dealership") === "dealership";
      const text = [item.id, item.dealershipName, item.dealershipBrand, item.city, item.loginEmail, item.status, item.dealership?.gstin, item.dealership?.authorizedDealerCode].filter(Boolean).join(" ").toLowerCase();
      return typeOk && statusOk && (!search || text.includes(search));
    });
    const [logs, dealerships] = await Promise.all([listRecords("approvalLogs"), listRecords("dealerships")]);
    res.json({
      data: requests,
      meta: {
        pending: requests.filter((item) => item.status === "pending").length,
        approvedToday: logs.filter((item) => item.entityType === "dealership" && item.newStatus === "approved" && today(item.createdAt || item.approvedAt)).length,
        rejectedToday: logs.filter((item) => item.entityType === "dealership" && item.newStatus === "rejected" && today(item.createdAt)).length,
        activeDealerships: dealerships.filter((item) => item.active !== false).length,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getPendingBankApprovals(req, res, next) {
  try {
    const status = String(req.query.status || "pending").trim().toLowerCase();
    const search = String(req.query.search || "").trim().toLowerCase();
    const requests = (await listRecords("pendingBankApprovals")).filter((item) => {
      const statusOk = String(item.status || "").toLowerCase() === status;
      const typeOk = (item.accountType || item.type || "bank") === "bank";
      const text = [item.id, item.bankName, item.companyName, item.bankBranchLocation, item.branchLocation, item.ifsc, item.managerName, item.mobile, item.email, item.status].filter(Boolean).join(" ").toLowerCase();
      return typeOk && statusOk && (!search || text.includes(search));
    });
    res.json({ data: requests });
  } catch (error) {
    next(error);
  }
}

export async function getApprovalLogs(req, res, next) {
  try {
    const status = String(req.query.status || "").trim().toLowerCase();
    const entityType = String(req.query.entityType || "").trim().toLowerCase();
    const logs = (await listRecords("approvalLogs")).filter((item) => {
      const statusOk = !status || String(item.newStatus || "").toLowerCase() === status;
      const typeOk = !entityType || String(item.entityType || "").toLowerCase() === entityType;
      return statusOk && typeOk;
    });
    res.json(logs);
  } catch (error) {
    next(error);
  }
}

export async function approveDealershipApproval(req, res, next) {
  try {
    const request = await getRecord("pendingDealershipApprovals", req.params.id);
    if (!request) return res.status(404).json({ message: "Dealership approval request not found" });
    if (request.status !== "pending") return res.status(400).json({ message: "Application is not pending" });
    const now = new Date().toISOString();
    const loginEmail = request.loginEmail;
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
    await upsertRecord("dealerships", loginEmail, dealership);
    await upsertRecord("approvedDealerships", loginEmail, dealership);
    await upsertRecord("users", loginEmail, { uid: loginEmail, email: loginEmail, role: "finance-desk", approved: true, active: true, accountApproved: true, accountActive: true, dealershipId: loginEmail, status: "active" });
    if (request.generalManager?.email) {
      await upsertRecord("users", request.generalManager.email, { uid: request.generalManager.email, email: request.generalManager.email, role: "gm-sm", approved: true, active: true, accountApproved: true, accountActive: true, dealershipId: loginEmail, status: "active" });
    }
    await upsertRecord("dealers", loginEmail, { ...dealership, role: "finance-desk", accountActive: true });
    await upsertRecord("dealershipManagers", `${loginEmail}:owner`, { dealershipEmail: loginEmail, role: "Owner", ...(request.owner || {}), status: "active", active: true });
    await upsertRecord("dealershipManagers", `${loginEmail}:gm`, { dealershipEmail: loginEmail, role: "General Manager", fullName: request.generalManager?.name, mobile: request.generalManager?.mobile, email: request.generalManager?.email, status: "active", active: true });
    await upsertRecord("financeDesk", loginEmail, { dealershipEmail: loginEmail, city: request.city, ...(request.financeDesk || {}), status: "active", active: true });
    await upsertRecord("financeDesks", loginEmail, { dealershipEmail: loginEmail, city: request.city, ...(request.financeDesk || {}), status: "active", active: true });
    await upsertRecord("cityMappings", `dealer:${request.city}:${loginEmail}`, { type: "dealer", city: request.city, dealershipEmail: loginEmail, dealershipName: request.dealershipName, status: "approved", active: true });
    const updated = await updateRecord("pendingDealershipApprovals", request.id, {
      status: "approved",
      approvalStatus: "approved",
      gstinVerified: true,
      dealershipVerified: true,
      approvedAt: now,
      approvedBy: req.user?.email || "super-admin",
    });
    if (request.onboardingRequestId) await updateRecord("onboardingRequests", request.onboardingRequestId, { status: "Approved", active: true, accountActive: true, approvedAt: now, approvedBy: req.user?.email || "super-admin" });
    const pendingAccountId = request.pendingDealerAccountId || request.pendingDealerRegistrationId;
    if (pendingAccountId) await updateRecord("pendingDealerAccounts", pendingAccountId, { registrationSubmitted: true, approvalStatus: "approved", accountApproved: true, accountActive: true, approvedAt: now, approvedBy: req.user?.email || "super-admin" });
    if (!pendingAccountId && loginEmail) {
      const pendingAccount = (await listRecords("pendingDealerAccounts")).find((item) => item.email === loginEmail);
      if (pendingAccount) await updateRecord("pendingDealerAccounts", pendingAccount.id, { registrationSubmitted: true, approvalStatus: "approved", accountApproved: true, accountActive: true, approvedAt: now, approvedBy: req.user?.email || "super-admin" });
    }
    const queueItem = (await listRecords("dealerApprovalQueue")).find((item) => item.pendingDealershipApprovalId === request.id || item.pendingDealerAccountId === (request.pendingDealerAccountId || request.pendingDealerRegistrationId));
    if (queueItem) await updateRecord("dealerApprovalQueue", queueItem.id, { status: "approved", approvalStatus: "approved", approvedAt: now, approvedBy: req.user?.email || "super-admin" });
    await approvalLog({ req, entityType: "dealership", entityId: request.id, previousStatus: request.status, newStatus: "approved" });
    await createNotification({ type: "dealership-approved", title: "Dealership approved", message: `${request.dealershipName} approved. Login access is active.`, recipientRole: "finance-desk", recipientId: loginEmail, dealerEmail: loginEmail, phoneNumber: request.dealership?.officialDealershipMobile || request.owner?.mobile, meta: { dealershipName: request.dealershipName } });
    await writeAuditLog({ req, actionType: "DEALERSHIP_APPROVED", oldValue: request.status, newValue: "approved", meta: { approvalId: request.id, loginEmail } });
    res.json({ message: "Dealership approved", request: updated });
  } catch (error) {
    next(error);
  }
}

export async function rejectDealershipApproval(req, res, next) {
  try {
    const reason = String(req.body.reason || "").trim();
    if (!reason) return res.status(400).json({ message: "Rejection reason is required" });
    const request = await getRecord("pendingDealershipApprovals", req.params.id);
    if (!request) return res.status(404).json({ message: "Dealership approval request not found" });
    const updated = await updateRecord("pendingDealershipApprovals", request.id, { status: "rejected", rejectedAt: new Date().toISOString(), rejectedBy: req.user?.email || "super-admin", rejectionReason: reason });
    if (request.onboardingRequestId) await updateRecord("onboardingRequests", request.onboardingRequestId, { status: "Rejected", active: false, rejectionReason: reason });
    if (request.pendingDealerAccountId || request.pendingDealerRegistrationId) await updateRecord("pendingDealerAccounts", request.pendingDealerAccountId || request.pendingDealerRegistrationId, { registrationSubmitted: true, approvalStatus: "rejected", accountApproved: false, accountActive: false, rejectionReason: reason, rejectedAt: new Date().toISOString(), rejectedBy: req.user?.email || "super-admin" });
    const queueItem = (await listRecords("dealerApprovalQueue")).find((item) => item.pendingDealershipApprovalId === request.id || item.pendingDealerAccountId === (request.pendingDealerAccountId || request.pendingDealerRegistrationId));
    if (queueItem) await updateRecord("dealerApprovalQueue", queueItem.id, { status: "rejected", approvalStatus: "rejected", rejectionReason: reason, rejectedAt: new Date().toISOString(), rejectedBy: req.user?.email || "super-admin" });
    await approvalLog({ req, entityType: "dealership", entityId: request.id, previousStatus: request.status, newStatus: "rejected", rejectionReason: reason });
    await createNotification({ type: "dealership-rejected", title: "Dealership rejected", message: reason, recipientRole: "finance-desk", recipientId: request.loginEmail, dealerEmail: request.loginEmail, phoneNumber: request.dealership?.officialDealershipMobile || request.owner?.mobile, priority: "high", meta: { dealershipName: request.dealershipName, reason } });
    await writeAuditLog({ req, actionType: "DEALERSHIP_REJECTED", oldValue: request.status, newValue: "rejected", meta: { approvalId: request.id, reason } });
    res.json({ message: "Dealership rejected", request: updated });
  } catch (error) {
    next(error);
  }
}

export async function suspendDealershipApproval(req, res, next) {
  try {
    const reason = String(req.body.reason || "Suspended by Super Admin").trim();
    const request = await getRecord("pendingDealershipApprovals", req.params.id);
    if (!request) return res.status(404).json({ message: "Dealership approval request not found" });
    const loginEmail = request.loginEmail || request.primaryGoogleEmail;
    const now = new Date().toISOString();

    const updated = await updateRecord("pendingDealershipApprovals", request.id, {
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
      await upsertRecord("users", request.generalManager.email, { uid: request.generalManager.email, email: request.generalManager.email, role: "gm-sm", approved: true, active: false, accountActive: false, dealershipId: loginEmail, status: "suspended" });
    }
    if (request.onboardingRequestId) await updateRecord("onboardingRequests", request.onboardingRequestId, { status: "Suspended", active: false, accountActive: false, suspensionReason: reason });
    const pendingAccountId = request.pendingDealerAccountId || request.pendingDealerRegistrationId;
    if (pendingAccountId) await updateRecord("pendingDealerAccounts", pendingAccountId, { approvalStatus: "suspended", accountApproved: false, accountActive: false, suspensionReason: reason, suspendedAt: now, suspendedBy: req.user?.email || "super-admin" });
    const queueItem = (await listRecords("dealerApprovalQueue")).find((item) => item.pendingDealershipApprovalId === request.id || item.pendingDealerAccountId === pendingAccountId);
    if (queueItem) await updateRecord("dealerApprovalQueue", queueItem.id, { status: "suspended", approvalStatus: "suspended", suspensionReason: reason, suspendedAt: now, suspendedBy: req.user?.email || "super-admin" });
    await approvalLog({ req, entityType: "dealership", entityId: request.id, previousStatus: request.status, newStatus: "suspended", rejectionReason: reason });
    await writeAuditLog({ req, actionType: "DEALERSHIP_SUSPENDED", oldValue: request.status, newValue: "suspended", meta: { approvalId: request.id, reason } });
    res.json({ message: "Dealership suspended", request: updated });
  } catch (error) {
    next(error);
  }
}

export async function deleteDealershipPermanently(req, res, next) {
  try {
    const id = String(req.params.id || "").trim();
    const onboardingRequests = await listRecords("onboardingRequests");
    const pendingApprovals = await listRecords("pendingDealershipApprovals");
    const onboardingRequest = onboardingRequests.find((item) => item.id === id);
    const approvalRequest = pendingApprovals.find((item) => item.id === id || item.onboardingRequestId === id);
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
      deleted[collection] = (deleted[collection] || 0) + await deleteMatchingRecords(collection, matchesDealer);
    }

    if (firebaseAdmin && loginEmail) {
      try {
        const firebaseUser = await firebaseAdmin.auth().getUserByEmail(loginEmail);
        await firebaseAdmin.auth().setCustomUserClaims(firebaseUser.uid, {});
      } catch {
        // Firebase Auth user may not exist; Firestore cleanup remains the source of truth.
      }
    }

    await approvalLog({ req, entityType: "dealership", entityId: id, previousStatus: request.status || "unknown", newStatus: "deleted", rejectionReason: "Permanently deleted by Super Admin" });
    await writeAuditLog({ req, actionType: "DEALERSHIP_DELETED_PERMANENTLY", oldValue: request.status || "", newValue: "deleted", meta: { id, loginEmail, deleted, deletedAt: now } });
    res.json({ message: "Dealership permanently deleted", id, loginEmail, deleted });
  } catch (error) {
    next(error);
  }
}

export async function approveBankApproval(req, res, next) {
  try {
    const request = await getRecord("pendingBankApprovals", req.params.id);
    if (!request) return res.status(404).json({ message: "Bank approval request not found" });
    if (request.status !== "pending") return res.status(400).json({ message: "Application is not pending" });
    const now = new Date().toISOString();
    const bankEmail = normalizeEmail(request.email || request.officialEmail || request.primaryGoogleEmail || request.managerEmail);
    if (!bankEmail) return res.status(400).json({ message: "Bank manager email is missing on this approval request" });
    const bankId = request.bankId || bankEmail;
    const bankName = request.bankName || request.companyName;
    const branchLocation = request.bankBranchLocation || request.branchLocation || request.city;
    await upsertRecord("bankPartners", bankId, { ...request, id: bankId, email: bankEmail, officialEmail: bankEmail, bankId, bankName, status: "active", active: true, approved: true, frozen: false, approvedAt: now, approvedBy: req.user?.email || "super-admin" });
    await upsertRecord("banks", bankId, { id: bankId, email: bankEmail, officialEmail: bankEmail, name: bankName, bankName, status: "active", active: true, approved: true });
    await upsertRecord("branches", `${bankId}:${branchLocation}`, { bankPartnerId: bankId, bankName, bankBranchLocation: branchLocation, branchLocation, city: branchLocation, branchCity: branchLocation, state: "Haryana", status: "active", active: true });
    await upsertRecord("branchManagers", bankEmail, { email: bankEmail, officialEmail: bankEmail, bankPartnerId: bankId, bankId, bankName, bankBranchLocation: branchLocation, branchLocation, branchCity: branchLocation, city: branchLocation, state: "Haryana", name: request.managerName || request.contactPerson, mobile: request.mobile, status: "active", active: true, approved: true, accountStatus: "active", accountApproved: true, accountActive: true });
    await upsertRecord("users", bankEmail, { uid: bankEmail, email: bankEmail, role: "bank-manager", approved: true, active: true, accountStatus: "active", accountApproved: true, accountActive: true, bankId, branchId: branchLocation, status: "active" });
    if (firebaseAdmin) {
      try {
        const firebaseUser = await firebaseAdmin.auth().getUserByEmail(bankEmail);
        await firebaseAdmin.auth().setCustomUserClaims(firebaseUser.uid, {
          role: "bank-manager",
          approved: true,
          active: true,
          dealershipId: null,
          bankId,
          branchId: branchLocation || null,
        });
      } catch {
        // Firebase account may be created later; login will repair claims.
      }
    }
    for (const executive of Array.isArray(request.executives) ? request.executives : []) {
      const executiveEmail = normalizeEmail(executive.email || executive.officialEmail);
      if (executiveEmail) {
        await upsertRecord("loanExecutives", executiveEmail, { ...executive, email: executiveEmail, officialEmail: executiveEmail, bankPartnerId: bankId, bankId, bankName, branchCity: branchLocation, bankBranchLocation: branchLocation, status: "active", active: true, approved: true, accountStatus: "active", accountApproved: true, accountActive: true });
        await upsertRecord("users", executiveEmail, { uid: executiveEmail, email: executiveEmail, role: "loan-executive", approved: true, active: true, accountStatus: "active", accountApproved: true, accountActive: true, bankId, branchId: branchLocation, status: "active" });
      }
    }
    for (const city of request.supportedCities?.length ? request.supportedCities : [branchLocation].filter(Boolean)) {
      await upsertRecord("bankCityMappings", `${bankId}:${city}`, { bankPartnerId: bankId, bankName, city, bankBranchLocation: city, approvalLimit: request.approvalLimit || 100, status: "active", active: true });
    }
    const updated = await updateRecord("pendingBankApprovals", request.id, { status: "approved", approvedAt: now, approvedBy: req.user?.email || "super-admin" });
    const pendingBankAccount = (await listRecords("pendingBankAccounts")).find((item) => item.email === bankEmail || item.approvalRequestId === request.id);
    if (pendingBankAccount) await updateRecord("pendingBankAccounts", pendingBankAccount.id, { registrationSubmitted: true, approvalStatus: "approved", accountApproved: true, accountActive: true, bankId, branchId: branchLocation, approvedAt: now, approvedBy: req.user?.email || "super-admin" });
    await approvalLog({ req, entityType: "bank", entityId: request.id, previousStatus: request.status, newStatus: "approved" });
    await createNotification({ type: "bank-approved", title: "Bank branch approved", message: `${bankName} ${branchLocation} branch approved. Login access is active.`, recipientRole: "bank-manager", recipientId: bankEmail, partnerId: bankId, phoneNumber: request.mobile, meta: { bankName, city: branchLocation, bankBranchLocation: branchLocation } });
    await writeAuditLog({ req, actionType: "BANK_APPROVED", oldValue: request.status, newValue: "approved", meta: { approvalId: request.id, bankId } });
    res.json({ message: "Bank approved", request: updated });
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
    const updated = await updateRecord("pendingBankApprovals", request.id, { status: "rejected", rejectedAt: new Date().toISOString(), rejectedBy: req.user?.email || "super-admin", rejectionReason: reason });
    const pendingBankAccount = (await listRecords("pendingBankAccounts")).find((item) => item.email === bankEmail || item.approvalRequestId === request.id);
    if (pendingBankAccount) await updateRecord("pendingBankAccounts", pendingBankAccount.id, { approvalStatus: "rejected", accountApproved: false, accountActive: false, rejectionReason: reason, rejectedAt: new Date().toISOString(), rejectedBy: req.user?.email || "super-admin" });
    await approvalLog({ req, entityType: "bank", entityId: request.id, previousStatus: request.status, newStatus: "rejected", rejectionReason: reason });
    await createNotification({ type: "bank-rejected", title: "Bank branch rejected", message: reason, recipientRole: "bank-manager", recipientId: bankEmail, partnerId: bankEmail, phoneNumber: request.mobile, priority: "high", meta: { bankName: request.bankName || request.companyName, reason } });
    await writeAuditLog({ req, actionType: "BANK_REJECTED", oldValue: request.status, newValue: "rejected", meta: { approvalId: request.id, reason } });
    res.json({ message: "Bank rejected", request: updated });
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
    const bankId = request.email;
    const updated = await updateRecord("pendingBankApprovals", request.id, {
      status: "suspended",
      approvalStatus: "suspended",
      suspensionReason: reason,
      suspendedAt: now,
      suspendedBy: req.user?.email || "super-admin",
    });
    if (bankId) {
      await upsertRecord("bankPartners", bankId, { status: "suspended", active: false, accountActive: false, suspensionReason: reason, suspendedAt: now });
      await upsertRecord("branchManagers", bankId, { email: bankId, status: "suspended", active: false, accountActive: false, suspensionReason: reason, suspendedAt: now });
      await upsertRecord("users", bankId, { uid: bankId, email: bankId, role: "bank-manager", approved: true, active: false, accountActive: false, status: "suspended" });
    }
    const pendingBankAccount = (await listRecords("pendingBankAccounts")).find((item) => item.email === request.email || item.approvalRequestId === request.id);
    if (pendingBankAccount) await updateRecord("pendingBankAccounts", pendingBankAccount.id, { approvalStatus: "suspended", accountApproved: false, accountActive: false, suspensionReason: reason, suspendedAt: now, suspendedBy: req.user?.email || "super-admin" });
    await approvalLog({ req, entityType: "bank", entityId: request.id, previousStatus: request.status, newStatus: "suspended", rejectionReason: reason });
    await writeAuditLog({ req, actionType: "BANK_SUSPENDED", oldValue: request.status, newValue: "suspended", meta: { approvalId: request.id, reason } });
    res.json({ message: "Bank suspended", request: updated });
  } catch (error) {
    next(error);
  }
}

export async function deleteBankPermanently(req, res, next) {
  try {
    const id = String(req.params.id || "").trim();
    const approvals = await listRecords("pendingBankApprovals");
    const request = approvals.find((item) => item.id === id) || await getRecord("bankPartners", id) || await getRecord("banks", id);
    if (!request) return res.status(404).json({ message: "Bank record not found" });

    const bankEmail = normalizeEmail(request.email || request.officialEmail || id);
    const bankName = String(request.bankName || request.companyName || request.name || "").trim().toLowerCase();
    const ifsc = String(request.ifsc || request.ifscCode || "").trim().toLowerCase();
    const deleted = {};
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

    for (const collection of ["pendingBankApprovals", "pendingBankAccounts", "bankPartners", "banks", "branches", "branchManagers", "loanExecutives", "users"]) {
      const records = await listRecords(collection);
      const matches = records.filter(matchesBank);
      for (const record of matches) {
        await deleteRecord(collection, record.id);
      }
      deleted[collection] = matches.length;
    }

    if (firebaseAdmin && bankEmail) {
      try {
        const firebaseUser = await firebaseAdmin.auth().getUserByEmail(bankEmail);
        await firebaseAdmin.auth().setCustomUserClaims(firebaseUser.uid, {});
      } catch {
        // Firebase Auth user may not exist; database cleanup remains authoritative.
      }
    }

    await writeAuditLog({ req, actionType: "BANK_DELETED", oldValue: request.status, newValue: "deleted", meta: { bankEmail, bankName, ifsc, deleted } });
    res.json({ message: "Bank permanently deleted", deleted });
  } catch (error) {
    next(error);
  }
}

export async function updateAdminOnboardingRequest(req, res, next) {
  try {
    const requests = await listRecords("onboardingRequests");
    const request = requests.find((item) => item.id === req.params.id);
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
    } else if (status === "Rejected") {
      const pendingAccount = (await listRecords("pendingDealerAccounts")).find((item) =>
        item.email === loginEmail
        || item.onboardingRequestId === request.id
        || item.approvalRequestId === request.approvalRequestId
      );
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

    res.json({ message: `Onboarding request ${status}`, request: updated });
  } catch (error) {
    next(error);
  }
}

export async function updateAdminLeadStatus(req, res, next) {
  try {
    const existing = await getRecord("leads", req.params.id);
    if (!existing) return res.status(404).json({ message: "Lead not found" });
    const status = assertValidStatusTransition(existing?.status, req.body.status);
    const lead = await updateRecord("leads", req.params.id, { status });
    await updateSlaForLead(lead, status);
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
    await writeAuditLog({ req, actionType: "STATUS_CHANGE", newValue: status, leadId: req.params.id });
    res.json({ message: "Lead status updated", lead });
  } catch (error) {
    next(error);
  }
}

export async function reassignAdminLead(req, res, next) {
  try {
    const assignment = await retrieveAndReassignLead(req.params.id, req.body.reason || "manual-reassignment", req.user?.email || "admin");
    await addTimelineEvent({
      leadId: req.params.id,
      eventType: TIMELINE_EVENTS.LEAD_REASSIGNED,
      title: "Manual Reassignment",
      description: req.body.reason || "Manual reassignment requested by Super Admin",
      actorName: req.user?.email || "super-admin",
      actorRole: "super-admin",
      metadata: { assignmentId: assignment?.id || null, reason: req.body.reason || "manual-reassignment" },
    });
    await writeAuditLog({ req, actionType: "REASSIGNMENT", newValue: req.body.reason || "manual-reassignment", leadId: req.params.id });
    res.json({ message: "Lead reassignment requested", assignment });
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
    const [assignments, slaLogs, reassignmentLogs, payouts, commissions, notifications, settings] = await Promise.all([
      listRecords("leadAssignments"),
      listRecords("slaLogs"),
      listRecords("reassignmentLogs"),
      listRecords("payouts"),
      listRecords("commissions"),
      listRecords("notifications"),
      listRecords("settings"),
    ]);
    res.json({ assignments, slaLogs, reassignmentLogs, payouts, commissions, notifications, settings });
  } catch (error) {
    next(error);
  }
}

export async function processAdminSlaBreaches(_req, res, next) {
  try {
    const processed = await processSlaBreaches();
    res.json({ message: "SLA processor completed", processed });
  } catch (error) {
    next(error);
  }
}

export async function assignAdminLead(req, res, next) {
  try {
    const bankPartner = String(req.body.bankPartner || "").trim();
    if (!bankPartner) return res.status(400).json({ message: "Bank partner is required" });
    const now = new Date().toISOString();
    const lead = await updateRecord("leads", req.params.id, {
      bankPartner,
      preferredBank: bankPartner,
      status: LEAD_STATUSES.ASSIGNED,
      assignmentStatus: "pending",
      assignmentTimestamp: now,
      assignedAt: now,
    });
    const assignment = await createRecord("leadAssignments", {
      leadId: req.params.id,
      partnerId: bankPartner,
      partnerName: bankPartner,
      status: "pending",
      reason: "manual-admin-assignment",
      assignmentTimestamp: now,
    });
    await createSlaLog({ lead, assignment, status: "pending" });
    await addTimelineEvent({
      leadId: req.params.id,
      eventType: TIMELINE_EVENTS.LEAD_SENT_TO_BANK,
      title: "Lead Manually Assigned",
      description: `Lead manually assigned to ${bankPartner}`,
      actorName: req.user?.email || "super-admin",
      actorRole: "super-admin",
      metadata: { bankPartner, assignmentId: assignment.id },
    });
    await createNotification({
      type: "new-lead-assigned",
      title: "Lead manually assigned",
      message: `Lead ${lead.caseId || req.params.id} manually assigned to ${bankPartner}`,
      leadId: req.params.id,
      partnerId: bankPartner,
      admin: true,
      meta: { caseId: lead.caseId },
    });
    await writeAuditLog({ req, actionType: "MANUAL_ASSIGNMENT", newValue: bankPartner, leadId: req.params.id });
    res.json({ message: "Lead assigned to bank partner", lead, assignment });
  } catch (error) {
    next(error);
  }
}

export async function getAdminAuditLogs(req, res, next) {
  try {
    res.json(await getAuditLogs(req.query));
  } catch (error) {
    next(error);
  }
}

export async function getAdminPartners(_req, res, next) {
  try {
    res.json(await listRecords("bankPartners"));
  } catch (error) {
    next(error);
  }
}

export async function getAdminAnalytics(_req, res, next) {
  try {
    const metrics = await computeLeadMetrics();
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

export async function getAdminEcosystem(req, res, next) {
  try {
    const limit = ecosystemLimit(req.query.ecosystemLimit);
    const leadPage = await queryAllLeads({ query: { limit: req.query.limit || 100, cursor: req.query.cursor } });
    const [
      onboardingRequests,
      dealerships,
      financeDesks,
      dealershipManagers,
      bankPartners,
      banks,
      branches,
      branchManagers,
      loanExecutives,
      assignments,
      slaLogs,
      reassignmentLogs,
      documents,
      bankDocuments,
      pendingDealershipApprovals,
      pendingBankApprovals,
      approvalLogs,
      pendingGoogleAccounts,
      loginActivity,
      users,
    ] = await Promise.all([
      boundedList("onboardingRequests", limit),
      boundedList("dealerships", limit),
      boundedList("financeDesks", limit),
      boundedList("dealershipManagers", limit),
      boundedList("bankPartners", limit),
      boundedList("banks", limit),
      boundedList("branches", limit),
      boundedList("branchManagers", limit),
      boundedList("loanExecutives", limit),
      boundedList("leadAssignments", limit),
      boundedList("slaLogs", limit),
      boundedList("reassignmentLogs", limit),
      boundedList("documents", limit, safeDocument),
      boundedList("bankDocuments", limit, safeDocument),
      boundedList("pendingDealershipApprovals", limit),
      boundedList("pendingBankApprovals", limit),
      boundedList("approvalLogs", limit),
      boundedList("pendingGoogleAccounts", limit),
      boundedList("loginActivity", limit, safeLoginActivity),
      listRecords("users"),
    ]);
    const activeDealershipIds = new Set(dealerships
      .filter((item) => item.active !== false && item.accountActive !== false && !["deleted", "inactive", "suspended"].includes(String(item.status || "").toLowerCase()))
      .flatMap((item) => [item.id, item.loginEmail, item.primaryGoogleEmail, item.officialDealershipEmail])
      .map(normalizeEmail)
      .filter(Boolean));
    const isActiveDealerScoped = (item) => activeDealershipIds.has(normalizeEmail(item.dealershipEmail || item.dealershipId || item.loginEmail || item.id));
    const visibleFinanceDesks = financeDesks.filter(isActiveDealerScoped);
    const visibleDealershipManagers = dealershipManagers.filter(isActiveDealerScoped);
    const visibleUsers = users
      .filter((item) => !["finance-desk", "gm-sm"].includes(item.role) || isActiveDealerScoped(item))
      .slice(0, limit)
      .map(safeAdminUser);

    res.json({
      leads: leadPage.data,
      leadPagination: { nextCursor: leadPage.nextCursor, hasMore: leadPage.hasMore, limit: leadPage.limit },
      onboardingRequests,
      dealerships,
      financeDesks: visibleFinanceDesks,
      dealershipManagers: visibleDealershipManagers,
      bankPartners,
      banks,
      branches,
      branchManagers,
      loanExecutives,
      assignments,
      slaLogs,
      reassignmentLogs,
      documents,
      bankDocuments,
      pendingDealershipApprovals,
      pendingBankApprovals,
      approvalLogs,
      pendingGoogleAccounts,
      loginActivity,
      users: visibleUsers,
    });
  } catch (error) {
    next(error);
  }
}
