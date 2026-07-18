import { createRecord, getRecord, updateRecord } from "../services/firestore.service.js";
import { leadSchema, publicLeadSchema } from "../validations/lead.validation.js";
import { ensureCommissionForLead } from "../services/commission.service.js";
import { createNotification } from "../services/notification.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "../services/timeline.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "../services/audit.service.js";
import { assertValidStatusTransition, LEAD_STATUSES, normalizeStatus, STATUS_LABELS } from "../utils/status.constants.js";
import { generateLeadCaseId } from "../utils/generateCaseId.js";
import { ANALYTICS_EVENTS, queueSafeAnalyticsEvent } from "../services/analyticsEngine.service.js";
import { queryAllLeads, queryBankLeads, queryDealershipLeads, queryExecutiveLeads } from "../services/leadQuery.service.js";
import { ALERT_SEVERITY, emitOperationalAlert, recordOperationalEvent } from "../services/observability.service.js";
import { logError, logInfo, logSecurity } from "../services/logger.service.js";
import { queryLeadProjectionForUser, syncLeadProjection, syncLeadProjectionSoon } from "../services/projection.service.js";
import { assertLeadMutable } from "../utils/deadCase.js";
import { clearCachedTags } from "../services/ttlCache.service.js";
import { publishRealtimeEvent, REALTIME_EVENTS } from "../services/realtime.service.js";
import { queueDocumentsRequiredWhatsApp, queueStatusUpdatedWhatsApp } from "../services/whatsapp.service.js";
import { executiveQueryArgs, loanExecutiveMatchesLead } from "../services/roleIdentity.service.js";
import { statusAutomationPatch } from "../services/automationPolicy.service.js";

const suspiciousCityPattern = /test|asdf|fake|demo/i;

function publicApplicationRisk(payload, req) {
  const reasons = [];
  if (Number(payload.loanAmount) > Number(payload.carPrice) * 0.95) reasons.push("high_ltv");
  if (suspiciousCityPattern.test(payload.city)) reasons.push("suspicious_city");
  if (String(payload.fullName || "").split(/\s+/).length < 2) reasons.push("single_token_name");
  if ((req.headers["user-agent"] || "").length < 10) reasons.push("missing_user_agent");
  return reasons;
}

function runLeadSideEffects(label, tasks = []) {
  Promise.allSettled(tasks.map((task) => task())).then((results) => {
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        logError("Lead side effect failed", {
          label,
          taskIndex: index,
          error: result.reason?.message || String(result.reason || "unknown"),
        });
      }
    });
  }).catch((error) => {
    logError("Lead side effect runner failed", { label, error: error.message });
  });
}

function clearLeadMutationCaches(leadId) {
  clearCachedTags(["lead:list", "admin:summary", "bank:summary", ...(leadId ? [`lead:${leadId}`] : [])]);
}

function authenticatedDealershipId(req, fallbackEmail) {
  return String(req.user?.dealershipId || fallbackEmail || "").trim().toLowerCase();
}

async function loanExecutiveActor(user = {}) {
  if (user?.role !== "loan-executive") return user;
  const email = user.email || user.uid;
  if (!email) return user;
  const executive = await getRecord("loanExecutives", email).catch(() => null);
  return executive ? { ...user, ...executive } : user;
}

async function canAccessLead(req, lead) {
  if (req.user?.role === "super-admin") return true;
  const email = req.user?.email || req.user?.uid;
  if (["finance-desk", "gm"].includes(req.user?.role)) {
    return lead.dealershipId === req.user?.dealershipId
      || lead.dealerEmail === email
      || lead.dealershipEmail === email
      || lead.createdBy === email;
  }
  if (req.user?.role === "loan-executive") {
    return loanExecutiveMatchesLead(await loanExecutiveActor(req.user), lead);
  }
  if (req.user?.role === "bank-manager") {
    const manager = await getRecord("branchManagers", email);
    const managerCity = manager?.branchCity || manager?.city || manager?.operatingCity || req.user?.branchCity;
    const leadCity = lead.bankBranchCity || lead.branchCity || lead.routingCity || lead.dealershipCity || lead.city;
    const managerBank = manager?.bankName || manager?.bankPartnerId || req.user?.bankId || req.user?.bankName;
    const sameCity = !managerCity || managerCity === leadCity;
    const sameBank = lead.bankId === req.user?.bankId
      || lead.assignedBankId === req.user?.bankId
      || lead.assignedPartnerId === managerBank
      || lead.bankPartner === managerBank
      || lead.preferredBank === managerBank;
    return sameCity && sameBank;
  }
  return false;
}

async function applyLeadStatusSideEffects({ req, existing, lead, nextStatus }) {
  const processingTimeMinutes = existing.createdAt ? Math.max(Math.round((Date.now() - new Date(existing.createdAt).getTime()) / 60000), 0) : 0;
  queueSafeAnalyticsEvent(ANALYTICS_EVENTS.STATUS_CHANGED, {
    lead,
    previousStatus: existing.status,
    nextStatus,
    processingTimeMinutes,
  });
  await ensureCommissionForLead(lead, nextStatus);
  const statusLabel = STATUS_LABELS[normalizeStatus(nextStatus)] || nextStatus;
  await addTimelineEvent({
    leadId: req.params.id,
    eventType: nextStatus === LEAD_STATUSES.APPROVED
      ? TIMELINE_EVENTS.APPROVAL
      : nextStatus === LEAD_STATUSES.REJECTED
        ? TIMELINE_EVENTS.REJECTION
        : nextStatus === LEAD_STATUSES.DISBURSED
          ? TIMELINE_EVENTS.DISBURSEMENT_MARKED
          : TIMELINE_EVENTS.STATUS_CHANGED,
    title: `Status: ${statusLabel}`,
    description: `Lead status updated to ${statusLabel}`,
    actorName: req.user?.email || "system",
    actorRole: req.user?.role || "system",
    metadata: { oldStatus: existing.status, nextStatus, status: nextStatus, customerName: lead.fullName },
  });
  await createNotification({
    type: nextStatus === LEAD_STATUSES.REJECTED ? "rejection" : nextStatus === LEAD_STATUSES.APPROVED ? "approval" : "status-update",
    title: `Lead ${statusLabel}`,
    message: `Lead ${lead.caseId || req.params.id} status updated to ${statusLabel}`,
    leadId: req.params.id,
    dealerEmail: lead.dealerEmail || lead.createdBy,
    admin: true,
    meta: { caseId: lead.caseId },
  });
  runLeadSideEffects("whatsapp-lead-status", [
    () => nextStatus === LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS
      ? queueDocumentsRequiredWhatsApp({ lead, documents: lead.pendingDocuments || [] })
      : queueStatusUpdatedWhatsApp({ lead, statusLabel }),
  ]);
  await writeAuditLog({
    req,
    actionType: nextStatus === LEAD_STATUSES.DISBURSED
      ? AUDIT_ACTIONS.DISBURSED
      : nextStatus === LEAD_STATUSES.REJECTED
        ? AUDIT_ACTIONS.REJECTED
        : AUDIT_ACTIONS.STATUS_UPDATED,
    oldValue: existing.status,
    newValue: nextStatus,
    leadId: req.params.id,
    meta: { caseId: lead.caseId, oldStatus: existing.status, newStatus: nextStatus, dealershipId: lead.dealershipId, bankId: lead.bankId },
  });
}

export async function createLead(req, res, next) {
  try {
    const payload = leadSchema.parse(req.body);
    const actorEmail = req.user?.email || "system";
    const dealershipId = authenticatedDealershipId(req, actorEmail);
    if (!dealershipId) return res.status(403).json({ message: "Dealership scope is required", code: "DEALERSHIP_SCOPE_REQUIRED" });
    const dealership = actorEmail !== "system"
      ? await getRecord("dealerships", dealershipId) || await getRecord("dealerships", actorEmail) || await getRecord("dealers", dealershipId) || await getRecord("dealers", actorEmail)
      : null;
    const dealershipCity = dealership?.city || payload.dealershipCity || payload.routingCity || payload.city;
    const caseId = await generateLeadCaseId();
    const lead = await createRecord("leads", {
      ...payload,
      caseId,
      dealerEmail: actorEmail,
      dealershipEmail: dealershipId,
      dealershipId,
      dealershipName: payload.dealershipName || dealership?.dealershipName || "",
      dealershipCity,
      routingCity: dealershipCity,
    });
    clearLeadMutationCaches(lead.id);
    await syncLeadProjection(lead).catch(() => null);
    publishRealtimeEvent({ eventType: REALTIME_EVENTS.LEAD_CREATED, lead, actor: req.user });
    runLeadSideEffects("authenticated-lead-created", [
      () => writeAuditLog({
        req,
        actionType: AUDIT_ACTIONS.LEAD_CREATED,
        newValue: { caseId, customerName: lead.fullName || lead.customerName },
        leadId: lead.id,
        meta: { caseId, dealershipId: lead.dealershipId },
      }),
      () => addTimelineEvent({
        leadId: lead.id,
        eventType: TIMELINE_EVENTS.LEAD_CREATED,
        title: "Lead Created",
        description: "Lead created from authenticated workspace",
        actorName: actorEmail,
        actorRole: req.user?.role || "user",
        dealershipId: lead.dealershipEmail,
        metadata: { customerName: lead.fullName, dealershipName: lead.dealershipName },
      }),
      () => queueSafeAnalyticsEvent(ANALYTICS_EVENTS.LEAD_CREATED, { lead }),
    ]);
    res.status(201).json(lead);
  } catch (error) {
    next(error);
  }
}

export async function createPublicLead(req, res, next) {
  try {
    const payload = publicLeadSchema.parse(req.body);
    const actorEmail = req.user?.email || null;
    const dealershipId = authenticatedDealershipId(req, actorEmail);
    if (!dealershipId) return res.status(403).json({ message: "Dealership scope is required", code: "DEALERSHIP_SCOPE_REQUIRED" });
    const caseId = await generateLeadCaseId();
    const lead = await createRecord("leads", {
      ...payload,
      caseId,
      dealerEmail: actorEmail,
      dealershipEmail: dealershipId,
      dealershipId,
      status: LEAD_STATUSES.NEW,
    });
    clearLeadMutationCaches(lead.id);
    await syncLeadProjection(lead).catch(() => null);
    publishRealtimeEvent({ eventType: REALTIME_EVENTS.LEAD_CREATED, lead, actor: req.user });
    runLeadSideEffects("finance-lead-created", [
      () => addTimelineEvent({
        leadId: lead.id,
        eventType: TIMELINE_EVENTS.LEAD_CREATED,
        title: "Lead Created",
        description: "Finance desk submitted a car loan lead",
        actorName: req.user?.email || "Finance Desk",
        actorRole: req.user?.role || "finance-desk",
        metadata: { customerName: lead.fullName },
      }),
      () => writeAuditLog({
        req,
        actionType: AUDIT_ACTIONS.LEAD_CREATED,
        newValue: { caseId, customerName: lead.fullName || lead.customerName },
        leadId: lead.id,
        meta: { caseId, dealershipId: lead.dealershipId },
      }),
      () => queueSafeAnalyticsEvent(ANALYTICS_EVENTS.LEAD_CREATED, { lead }),
    ]);
    res.status(201).json({
      leadId: lead.id,
      caseId: lead.caseId,
      message: "Lead submitted successfully",
      assignmentId: null,
      lead,
    });
  } catch (error) {
    next(error);
  }
}

export async function createPublicLeadIntake(req, res, next) {
  try {
    const payload = publicLeadSchema.parse(req.body);
    const riskReasons = publicApplicationRisk(payload, req);
    const caseId = await generateLeadCaseId();
    const lead = await createRecord("leads", {
      ...payload,
      email: payload.email || null,
      caseId,
      status: LEAD_STATUSES.NEW,
      intakeSource: "public-apply-loan",
      source: "Public Apply Loan",
      publicIntake: true,
      intakeStatus: riskReasons.length ? "review-required" : "new",
      riskFlags: riskReasons,
      requestId: req.requestId || null,
      userAgentHash: req.headers["user-agent"] ? Buffer.from(String(req.headers["user-agent"])).toString("base64url").slice(0, 24) : null,
    });
    runLeadSideEffects("public-lead-created", [
      () => syncLeadProjectionSoon(lead),
      () => addTimelineEvent({
        leadId: lead.id,
        eventType: TIMELINE_EVENTS.LEAD_CREATED,
        title: "Public Application Received",
        description: "Public loan application received for finance intake",
        actorName: "Public Applicant",
        actorRole: "public",
        dealershipId: lead.dealershipId || null,
        metadata: { caseId, source: "public-apply-loan", riskFlags: riskReasons },
        visibility: ["finance-desk", "gm", "super-admin"],
      }),
      () => writeAuditLog({
        req,
        actorId: "public-applicant",
        actorRole: "public",
        actionType: AUDIT_ACTIONS.LEAD_CREATED,
        newValue: { caseId, intakeStatus: lead.intakeStatus },
        leadId: lead.id,
        sourcePortal: "public",
        meta: { caseId, source: "public-apply-loan", riskFlags: riskReasons },
      }),
      () => recordOperationalEvent({
        type: "public_lead_intake_created",
        severity: riskReasons.length ? ALERT_SEVERITY.MEDIUM : ALERT_SEVERITY.LOW,
        component: "lead-intake",
        message: "Public loan application received",
        entityId: lead.id,
        requestId: req.requestId,
        meta: { caseId, riskFlags: riskReasons },
      }),
      async () => {
        if (!riskReasons.length) return null;
        logSecurity("Suspicious public loan application", { requestId: req.requestId, leadId: lead.id, riskFlags: riskReasons });
        return emitOperationalAlert({
          type: "suspicious_public_application",
          severity: ALERT_SEVERITY.MEDIUM,
          component: "lead-intake",
          title: "Suspicious public loan application",
          message: `Public application ${caseId} requires review`,
          entityId: lead.id,
          requestId: req.requestId,
          meta: { caseId, riskFlags: riskReasons },
        });
      },
      () => queueSafeAnalyticsEvent(ANALYTICS_EVENTS.LEAD_CREATED, { lead }),
    ]);
    res.status(201).json({
      leadId: lead.id,
      caseId: lead.caseId,
      message: "Application submitted successfully",
      intakeStatus: lead.intakeStatus,
    });
  } catch (error) {
    next(error);
  }
}

export async function getLeads(req, res, next) {
  const startedAt = Date.now();
  let queryStarted, queryEnded;
  try {
    queryStarted = Date.now();
    let payload;
    const projected = await queryLeadProjectionForUser({ user: req.user, query: req.query }).catch(() => null);
    if (req.user?.role === "loan-executive") {
      const actor = await loanExecutiveActor(req.user);
      const canonical = await queryExecutiveLeads({ ...executiveQueryArgs(actor), query: req.query });
      if (projected?.data?.length) {
        const byId = new Map();
        [...projected.data, ...canonical.data].forEach((lead) => {
          const key = lead.sourceId || lead.id || lead.caseId;
          if (key && loanExecutiveMatchesLead(actor, lead)) byId.set(key, { ...lead, id: lead.sourceId || lead.id });
        });
        payload = { ...canonical, data: [...byId.values()], total: byId.size };
      } else {
        payload = canonical;
      }
    } else if (projected) payload = projected;
    else if (req.user?.role === "super-admin") payload = await queryAllLeads({ query: req.query });
    else if (["finance-desk", "gm"].includes(req.user?.role)) {
      const dealershipId = req.user?.dealershipId || req.user?.email || req.user?.uid;
      payload = await queryDealershipLeads({ dealershipId, query: req.query });
    } else if (req.user?.role === "bank-manager") {
      const bankId = req.user?.bankId || req.user?.bankName || req.user?.email || req.user?.uid;
      payload = await queryBankLeads({ bankId, query: req.query });
    } else {
      return res.status(403).json({ message: "Lead access denied" });
    }
    queryEnded = Date.now();
    logInfo("Lead query completed", {
      requestId: req.requestId,
      path: req.originalUrl,
      role: req.user?.role,
      totalMs: Date.now() - startedAt,
      queryMs: queryEnded - queryStarted,
      serializeMs: 0,
      warmup: String(req.headers["x-cls-warmup"] || "").toLowerCase() === "true",
      dataCount: Array.isArray(payload?.data) ? payload.data.length : undefined,
    });
    return res.json(payload);
  } catch (error) {
    next(error);
  }
}

export async function updateLeadStatus(req, res, next) {
  try {
    const existing = await getRecord("leads", req.params.id);
    if (!existing) return res.status(404).json({ message: "Lead not found" });
    assertLeadMutable(existing);
    if (!(await canAccessLead(req, existing))) return res.status(403).json({ message: "Lead access denied" });
    const nextStatus = assertValidStatusTransition(existing?.status, req.body.status);
    const statusUpdate = {
      status: nextStatus,
      statusUpdatedAt: new Date().toISOString(),
      statusUpdatedBy: req.user?.email || req.user?.uid || null,
      ...statusAutomationPatch(nextStatus, new Date().toISOString(), existing),
    };
    const lead = await updateRecord("leads", req.params.id, statusUpdate);
    clearLeadMutationCaches(req.params.id);
    await syncLeadProjection(lead);
    publishRealtimeEvent({ eventType: REALTIME_EVENTS.LEAD_STATUS_UPDATED, lead, actor: req.user, data: { status: nextStatus, previousStatus: existing.status } });
    // Branch tie-up workflow does not perform automatic reassignment on rejection.
    await applyLeadStatusSideEffects({ req, existing, lead, nextStatus });
    res.json(lead);
  } catch (error) {
    next(error);
  }
}
