import { createRecord, getRecord, listRecords, updateRecord, upsertRecord } from "../services/firestore.service.js";
import { firebaseAdmin } from "../firebase/admin.js";
import { financeDeskLeadSchema } from "../validations/lead.validation.js";
import { assignLeadRoundRobin } from "../services/assignment.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "../services/timeline.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "../services/audit.service.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";
import { sanitizeFirestoreData } from "../utils/firestoreSanitizer.js";
import { generateLeadCaseId } from "../utils/generateCaseId.js";

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
  const desks = await listRecords("financeDesks");
  const desk = desks.find((item) => item.officialEmail === email || item.email === email || item.dealershipEmail === email || item.id === email);
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

function required(value, label) {
  const text = String(value || "").trim();
  if (!text) {
    const error = new Error(`${label} is required`);
    error.status = 400;
    throw error;
  }
  return text;
}

async function liveDealerRegistrationForAccount(account) {
  if (!account?.email) return { linkedOnboarding: null, linkedApproval: null, dealership: null, live: false };
  const [onboardingRequests, approvalRequests] = await Promise.all([
    listRecords("onboardingRequests"),
    listRecords("pendingDealershipApprovals"),
  ]);
  const linkedOnboarding = onboardingRequests.find((item) =>
    item.id === account.onboardingRequestId
    || item.loginEmail === account.email
    || item.primaryGoogleEmail === account.email
  ) || null;
  const linkedApproval = approvalRequests.find((item) =>
    item.id === account.approvalRequestId
    || item.onboardingRequestId === account.onboardingRequestId
    || item.loginEmail === account.email
    || item.primaryGoogleEmail === account.email
  ) || null;
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
    let existing = (await listRecords("pendingDealerAccounts")).find((item) => item.email === email);
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
    await upsertRecord("users", email, {
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

    const pendingAccounts = await listRecords("pendingDealerAccounts");
    const users = await listRecords("users");
    const user = users.find((item) => item.email === email);
    const dealershipEmail = user?.dealershipId || email;
    const account = pendingAccounts.find((item) => item.email === dealershipEmail || item.email === email);
    const [onboardingRequests, approvalRequests] = await Promise.all([
      listRecords("onboardingRequests"),
      listRecords("pendingDealershipApprovals"),
    ]);
    const linkedOnboarding = account ? onboardingRequests.find((item) =>
      item.id === account.onboardingRequestId
      || item.loginEmail === account.email
      || item.primaryGoogleEmail === account.email
    ) : null;
    const linkedApproval = account ? approvalRequests.find((item) =>
      item.id === account.approvalRequestId
      || item.onboardingRequestId === account.onboardingRequestId
      || item.loginEmail === account.email
      || item.primaryGoogleEmail === account.email
    ) : null;
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
    preferredBank: body.preferredBank,
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
    preferredBank: "Missing preferred bank",
  };
  return messages[field] || issue.message || "Failed to create lead";
}

function normalizeFinanceStatus(status) {
  const normalized = normalizeStatus(status);
  const map = {
    NEW: "New Lead",
    ASSIGNED: "Bank Processing",
    ACCEPTED: "Bank Processing",
    UNDER_REVIEW: "Bank Processing",
    DOCS_PENDING: "Pending Documents",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    DISBURSED: "Disbursed",
    CLOSED: "Disbursed",
  };
  return map[normalized] || "New Lead";
}

export async function registerDealerOnboarding(req, res, next) {
  try {
    const city = required(req.body.city, "City");
    if (!supportedDealerCities.has(city)) {
      return res.status(400).json({ message: "Dealer city is not supported for onboarding" });
    }

    const loginEmail = required(req.body.primaryGoogleEmail || req.body.loginEmail || req.body.officialDealershipEmail, "Official login email").toLowerCase();
    const now = new Date().toISOString();
    const pendingAccounts = await listRecords("pendingDealerAccounts");
    let pendingAccount = pendingAccounts.find((item) =>
      item.email === loginEmail
      || item.id === req.body.registrationId
      || item.uid === req.body.dealerUid
      || item.id === req.body.dealerUid
    );
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
      existingBankTieUps: String(req.body.existingBankTieUps || "None").trim(),
      preferredPartnerBanks: Array.isArray(req.body.preferredPartnerBanks) ? req.body.preferredPartnerBanks : [],
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

    await upsertRecord("users", loginEmail, {
      uid: loginEmail,
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
    console.info("Finance Desk lead incoming payload", sanitizeFirestoreData(req.body) || {});
    const { email, dealershipEmail, dealership } = await financeDeskContext(req);
    const dealerBrand = dealership.dealershipBrand || dealership.brand || req.body.selectedBrand || req.body.carBrand;
    const payload = normalizeFinanceDeskLead({ ...req.body, selectedBrand: dealerBrand, carBrand: dealerBrand });
    const dealershipCity = dealership.city || dealership.registeredCity || payload.dealershipCity || payload.city;
    const salespersonId = salespersonIdFrom(req.body.salespersonId);
    const salesperson = salespersonId ? await getRecord("salespersons", salespersonId) : null;
    if (!salesperson || salesperson.dealershipId !== dealershipEmail || salesperson.active === false) {
      return res.status(400).json({ message: "Select an active salesperson from this dealership" });
    }
    const now = new Date().toISOString();
    const caseId = await generateLeadCaseId();
    const leadPayload = sanitizeFirestoreData({
      ...payload,
      caseId,
      selectedBrand: dealerBrand,
      carBrand: dealerBrand,
      carOnRoadPrice: payload.carPrice,
      requiredLoanAmount: payload.loanAmount,
      dealerEmail: dealershipEmail,
      dealershipEmail,
      dealershipId: dealershipEmail,
      dealershipName: dealership.dealershipName || dealership.name || dealership.contactPerson || "",
      dealershipCity,
      routingCity: dealershipCity,
      createdBy: dealershipEmail,
      source: "Dealer Dashboard",
      status: LEAD_STATUSES.NEW,
      generatedDate: now.slice(0, 10),
      generatedTime: now.slice(11, 19),
      generatedAt: now,
      salespersonId: salesperson.id,
      salespersonName: salesperson.name,
      salespersonJobId: salesperson.jobId,
      assignedSalesperson: salesperson.name,
    });
    console.info("Finance Desk lead sanitized payload", leadPayload);
    const lead = await createRecord("leads", leadPayload);
    await writeAuditLog({
      req,
      actionType: AUDIT_ACTIONS.LEAD_CREATED,
      newValue: { caseId: lead.caseId, customerName: lead.fullName || lead.customerName },
      leadId: lead.id,
      meta: { caseId: lead.caseId, dealershipId: lead.dealershipId, salespersonId: lead.salespersonId },
    });
    console.info("Finance Desk lead created", { leadId: lead.id });
    await addTimelineEvent({
      leadId: lead.id,
      eventType: TIMELINE_EVENTS.LEAD_CREATED,
      title: "Lead Created",
      description: `Finance Desk created lead${lead.dealershipName ? ` - ${lead.dealershipName}` : ""}`,
      actorName: email,
      actorRole: req.user?.role || "finance-desk",
      dealershipId: dealershipEmail,
      metadata: { customerName: lead.fullName, dealershipName: lead.dealershipName, routingCity: dealershipCity },
    });
    const assignment = await assignLeadRoundRobin(lead);
    console.info("Finance Desk lead assignment result", { leadId: lead.id, assignmentId: assignment?.id || null });
    console.info("Finance Desk lead SLA start", { leadId: lead.id, startedAt: lead.assignmentTimestamp || new Date().toISOString() });
    res.status(201).json({ leadId: lead.id, caseId: lead.caseId, assignmentId: assignment?.id || null, message: "Dealer lead submitted", lead });
  } catch (error) {
    if (error?.issues) {
      return res.status(400).json({ message: readableLeadError(error) });
    }
    next(error);
  }
}

export async function getDealerLeads(req, res, next) {
  try {
    const { email, dealershipEmail } = await financeDeskContext(req);
    let leads = owned(await listRecords("leads"), email, dealershipEmail);
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const status = String(req.query.status || "").trim();
    const salesperson = String(req.query.salesperson || "").trim().toLowerCase();
    const salespersonId = String(req.query.salespersonId || "").trim();
    const bank = String(req.query.bank || "").trim().toLowerCase();
    const city = String(req.query.city || "").trim().toLowerCase();
    const date = String(req.query.date || "").trim();
    const search = String(req.query.search || "").trim().toLowerCase();

    leads = leads.filter((lead) => {
      const statusOk = !status || normalizeFinanceStatus(lead.status) === status;
      const salespersonOk = (!salesperson && !salespersonId)
        || String(lead.salespersonId || "") === salespersonId
        || String(lead.assignedSalesperson || lead.salespersonName || "").toLowerCase() === salesperson;
      const bankOk = !bank || String(lead.preferredBank || lead.bankPartner || "").toLowerCase() === bank;
      const cityOk = !city || String(lead.city || "").toLowerCase() === city;
      const dateOk = !date || String(lead.createdAt || "").startsWith(date);
      const text = [lead.caseId, lead.fullName, lead.mobile, lead.city, lead.selectedBrand, lead.selectedModel, lead.preferredBank, lead.assignedSalesperson].filter(Boolean).join(" ").toLowerCase();
      const searchOk = !search || text.includes(search);
      return statusOk && salespersonOk && bankOk && cityOk && dateOk && searchOk;
    });

    const start = (page - 1) * limit;
    res.json({
      data: leads.slice(start, start + limit),
      total: leads.length,
      page,
      limit,
    });
  } catch (error) {
    next(error);
  }
}

export async function getDealerSalespersons(req, res, next) {
  try {
    const { dealershipEmail } = await financeDeskContext(req);
    const includeInactive = String(req.query.includeInactive || "") === "true";
    const salespersons = (await listRecords("salespersons"))
      .filter((person) => person.dealershipId === dealershipEmail)
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

export async function createDealerSalesperson(req, res, next) {
  try {
    const { dealershipEmail, dealership } = await financeDeskContext(req);
    const name = required(req.body.name || req.body.salespersonName, "Salesperson name");
    const mobile = required(req.body.mobile, "Mobile number");
    const jobId = required(req.body.jobId || req.body.employeeId, "Job ID");
    const email = required(req.body.email || req.body.mailId, "Mail ID").toLowerCase();
    if (!/^[6-9]\d{9}$/.test(mobile)) return res.status(400).json({ message: "Enter a valid 10-digit mobile number" });

    const existing = (await listRecords("salespersons")).filter((person) => person.dealershipId === dealershipEmail && person.active !== false);
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
    const lead = owned(await listRecords("leads"), email, dealershipEmail).find((item) => item.id === req.params.id);
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    res.json(lead);
  } catch (error) {
    next(error);
  }
}

export async function getDealerEarnings(req, res, next) {
  try {
    const { email, dealershipEmail } = await financeDeskContext(req);
    const leads = owned(await listRecords("leads"), email, dealershipEmail);
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
        financeDesk: desk || null,
      });
    }
    const profiles = await listRecords("dealerProfiles");
    const profile = profiles.find((item) => item.email === email) || {
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
    const { email, dealershipEmail } = await financeDeskContext(req);
    const profiles = await listRecords("dealerProfiles");
    const existing = profiles.find((item) => item.email === email);
    const payload = {
      email,
      dealershipEmail,
      dealershipName: String(req.body.dealershipName || "").trim(),
      contactPerson: String(req.body.contactPerson || "").trim(),
      city: String(req.body.city || "").trim(),
      mobile: String(req.body.mobile || "").trim(),
    };
    const profile = existing
      ? await updateRecord("dealerProfiles", existing.id, payload)
      : await createRecord("dealerProfiles", payload);
    await upsertRecord("dealers", dealershipEmail, payload);
    res.json({ message: "Dealer profile saved", profile });
  } catch (error) {
    next(error);
  }
}
