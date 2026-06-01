import { createRecord, getRecord, updateRecord } from "../services/firestore.service.js";
import { leadSchema, publicLeadSchema } from "../validations/lead.validation.js";
import { ensureCommissionForLead } from "../services/commission.service.js";
import { createNotification } from "../services/notification.service.js";
import { updateSlaForLead } from "../services/sla.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "../services/timeline.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "../services/audit.service.js";
import { assertValidStatusTransition, LEAD_STATUSES, normalizeStatus, STATUS_LABELS } from "../utils/status.constants.js";
import { generateLeadCaseId } from "../utils/generateCaseId.js";
import { ANALYTICS_EVENTS, queueSafeAnalyticsEvent } from "../services/analyticsEngine.service.js";
import { queryAllLeads, queryBankLeads, queryDealershipLeads, queryExecutiveLeads } from "../services/leadQuery.service.js";
import { ALERT_SEVERITY, emitOperationalAlert, recordOperationalEvent } from "../services/observability.service.js";
import { logInfo, logSecurity } from "../services/logger.service.js";

const suspiciousCityPattern = /test|asdf|fake|demo/i;

function publicApplicationRisk(payload, req) {
  const reasons = [];
  if (Number(payload.loanAmount) > Number(payload.carPrice) * 0.95) reasons.push("high_ltv");
  if (suspiciousCityPattern.test(payload.city)) reasons.push("suspicious_city");
  if (String(payload.fullName || "").split(/\s+/).length < 2) reasons.push("single_token_name");
  if ((req.headers["user-agent"] || "").length < 10) reasons.push("missing_user_agent");
  return reasons;
}

async function canAccessLead(req, lead) {
  if (req.user?.role === "super-admin") return true;
  const email = req.user?.email || req.user?.uid;
  if (["finance-desk", "gm-sm"].includes(req.user?.role)) {
    return lead.dealershipId === req.user?.dealershipId
      || lead.dealerEmail === email
      || lead.dealershipEmail === email
      || lead.createdBy === email;
  }
  if (req.user?.role === "loan-executive") {
    if (lead.assignedExecutiveEmail === email || lead.assignedExecutiveId === email) return true;
    const executive = await getRecord("loanExecutives", email);
    return Boolean(executive && (lead.assignedExecutiveId === executive.id || lead.assignedExecutiveEmail === executive.email));
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

export async function createLead(req, res, next) {
  try {
    const payload = leadSchema.parse(req.body);
    const actorEmail = req.user?.email || "system";
    const dealership = actorEmail !== "system"
      ? await getRecord("dealerships", actorEmail) || await getRecord("dealers", actorEmail)
      : null;
    const dealershipCity = dealership?.city || payload.dealershipCity || payload.routingCity || payload.city;
    const caseId = await generateLeadCaseId();
    const lead = await createRecord("leads", {
      ...payload,
      caseId,
      dealerEmail: payload.dealerEmail || actorEmail,
      dealershipEmail: payload.dealershipEmail || actorEmail,
      dealershipId: payload.dealershipId || req.user?.dealershipId || actorEmail,
      dealershipName: payload.dealershipName || dealership?.dealershipName || "",
      dealershipCity,
      routingCity: dealershipCity,
    });
    await writeAuditLog({
      req,
      actionType: AUDIT_ACTIONS.LEAD_CREATED,
      newValue: { caseId, customerName: lead.fullName || lead.customerName },
      leadId: lead.id,
      meta: { caseId, dealershipId: lead.dealershipId },
    });
    await addTimelineEvent({
      leadId: lead.id,
      eventType: TIMELINE_EVENTS.LEAD_CREATED,
      title: "Lead Created",
      description: "Lead created from authenticated workspace",
      actorName: actorEmail,
      actorRole: req.user?.role || "user",
      dealershipId: lead.dealershipEmail,
      metadata: { customerName: lead.fullName, dealershipName: lead.dealershipName },
    });
    queueSafeAnalyticsEvent(ANALYTICS_EVENTS.LEAD_CREATED, { lead });
    res.status(201).json(lead);
  } catch (error) {
    next(error);
  }
}

export async function createPublicLead(req, res, next) {
  try {
    const payload = publicLeadSchema.parse(req.body);
    const caseId = await generateLeadCaseId();
    const lead = await createRecord("leads", {
      ...payload,
      caseId,
      dealerEmail: payload.dealerEmail || req.user?.email || null,
      dealershipEmail: payload.dealershipEmail || req.user?.email || null,
      dealershipId: payload.dealershipId || req.user?.dealershipId || req.user?.email || null,
      status: LEAD_STATUSES.NEW,
    });
    await addTimelineEvent({
      leadId: lead.id,
      eventType: TIMELINE_EVENTS.LEAD_CREATED,
      title: "Lead Created",
      description: "Finance desk submitted a car loan lead",
      actorName: req.user?.email || "Finance Desk",
      actorRole: req.user?.role || "finance-desk",
      metadata: { customerName: lead.fullName },
    });
    await writeAuditLog({
      req,
      actionType: AUDIT_ACTIONS.LEAD_CREATED,
      newValue: { caseId, customerName: lead.fullName || lead.customerName },
      leadId: lead.id,
      meta: { caseId, dealershipId: lead.dealershipId },
    });
    queueSafeAnalyticsEvent(ANALYTICS_EVENTS.LEAD_CREATED, { lead });
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
    await addTimelineEvent({
      leadId: lead.id,
      eventType: TIMELINE_EVENTS.LEAD_CREATED,
      title: "Public Application Received",
      description: "Public loan application received for finance intake",
      actorName: "Public Applicant",
      actorRole: "public",
      dealershipId: lead.dealershipId || null,
      metadata: { caseId, source: "public-apply-loan", riskFlags: riskReasons },
      visibility: ["finance-desk", "gm-sm", "super-admin"],
    });
    await writeAuditLog({
      req,
      actorId: "public-applicant",
      actorRole: "public",
      actionType: AUDIT_ACTIONS.LEAD_CREATED,
      newValue: { caseId, intakeStatus: lead.intakeStatus },
      leadId: lead.id,
      sourcePortal: "public",
      meta: { caseId, source: "public-apply-loan", riskFlags: riskReasons },
    });
    await recordOperationalEvent({
      type: "public_lead_intake_created",
      severity: riskReasons.length ? ALERT_SEVERITY.MEDIUM : ALERT_SEVERITY.LOW,
      component: "lead-intake",
      message: "Public loan application received",
      entityId: lead.id,
      requestId: req.requestId,
      meta: { caseId, riskFlags: riskReasons },
    });
    if (riskReasons.length) {
      logSecurity("Suspicious public loan application", { requestId: req.requestId, leadId: lead.id, riskFlags: riskReasons });
      emitOperationalAlert({
        type: "suspicious_public_application",
        severity: ALERT_SEVERITY.MEDIUM,
        component: "lead-intake",
        title: "Suspicious public loan application",
        message: `Public application ${caseId} requires review`,
        entityId: lead.id,
        requestId: req.requestId,
        meta: { caseId, riskFlags: riskReasons },
      }).catch(() => {});
    }
    queueSafeAnalyticsEvent(ANALYTICS_EVENTS.LEAD_CREATED, { lead });
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
  try {
    let payload;
    if (req.user?.role === "super-admin") payload = await queryAllLeads({ query: req.query });
    else if (["finance-desk", "gm-sm"].includes(req.user?.role)) {
      const dealershipId = req.user?.dealershipId || req.user?.email || req.user?.uid;
      payload = await queryDealershipLeads({ dealershipId, query: req.query });
    } else if (req.user?.role === "bank-manager") {
      const bankId = req.user?.bankId || req.user?.bankName || req.user?.email || req.user?.uid;
      payload = await queryBankLeads({ bankId, query: req.query });
    } else if (req.user?.role === "loan-executive") {
      payload = await queryExecutiveLeads({ executiveId: req.user?.uid, executiveEmail: req.user?.email, query: req.query });
    } else {
      return res.status(403).json({ message: "Lead access denied" });
    }
    logInfo("Lead query completed", {
      requestId: req.requestId,
      path: req.originalUrl,
      role: req.user?.role,
      durationMs: Date.now() - startedAt,
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
    if (!(await canAccessLead(req, existing))) return res.status(403).json({ message: "Lead access denied" });
    const nextStatus = assertValidStatusTransition(existing?.status, req.body.status);
    const statusUpdate = {
      status: nextStatus,
      statusUpdatedAt: new Date().toISOString(),
      statusUpdatedBy: req.user?.email || req.user?.uid || null,
    };
    const lead = await updateRecord("leads", req.params.id, statusUpdate);
    const processingTimeMinutes = existing.createdAt ? Math.max(Math.round((Date.now() - new Date(existing.createdAt).getTime()) / 60000), 0) : 0;
    queueSafeAnalyticsEvent(ANALYTICS_EVENTS.STATUS_CHANGED, {
      lead,
      previousStatus: existing.status,
      nextStatus,
      processingTimeMinutes,
    });
    await updateSlaForLead(lead, nextStatus);
    await ensureCommissionForLead(lead, nextStatus);
    // Branch tie-up workflow does not perform automatic reassignment on rejection.
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
    res.json(lead);
  } catch (error) {
    next(error);
  }
}
