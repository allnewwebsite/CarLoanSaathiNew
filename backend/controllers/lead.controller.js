import { createRecord, getRecord, updateRecord } from "../services/firestore.service.js";
import { leadSchema, publicLeadSchema } from "../validations/lead.validation.js";
import { assignLeadRoundRobin, retrieveAndReassignLead } from "../services/assignment.service.js";
import { ensureCommissionForLead } from "../services/commission.service.js";
import { createNotification } from "../services/notification.service.js";
import { updateSlaForLead } from "../services/sla.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "../services/timeline.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "../services/audit.service.js";
import { assertValidStatusTransition, LEAD_STATUSES, normalizeStatus, STATUS_LABELS } from "../utils/status.constants.js";
import { generateLeadCaseId } from "../utils/generateCaseId.js";
import { ANALYTICS_EVENTS, queueSafeAnalyticsEvent } from "../services/analyticsEngine.service.js";
import { queryAllLeads, queryBankLeads, queryDealershipLeads, queryExecutiveLeads } from "../services/leadQuery.service.js";

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
    await assignLeadRoundRobin(lead);
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
    const assignment = await assignLeadRoundRobin(lead);
    queueSafeAnalyticsEvent(ANALYTICS_EVENTS.LEAD_CREATED, { lead });
    res.status(201).json({
      leadId: lead.id,
      caseId: lead.caseId,
      message: "Lead submitted successfully",
      assignmentId: assignment?.id || null,
      lead,
    });
  } catch (error) {
    next(error);
  }
}

export async function getLeads(req, res, next) {
  try {
    if (req.user?.role === "super-admin") return res.json(await queryAllLeads({ query: req.query }));
    if (["finance-desk", "gm-sm"].includes(req.user?.role)) {
      const dealershipId = req.user?.dealershipId || req.user?.email || req.user?.uid;
      return res.json(await queryDealershipLeads({ dealershipId, query: req.query }));
    }
    if (req.user?.role === "bank-manager") {
      const bankId = req.user?.bankId || req.user?.bankName || req.user?.email || req.user?.uid;
      return res.json(await queryBankLeads({ bankId, query: req.query }));
    }
    if (req.user?.role === "loan-executive") {
      return res.json(await queryExecutiveLeads({ executiveId: req.user?.uid, executiveEmail: req.user?.email, query: req.query }));
    }
    return res.status(403).json({ message: "Lead access denied" });
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
    if (nextStatus === LEAD_STATUSES.REJECTED && req.body.finalRejection !== true) {
      await retrieveAndReassignLead(req.params.id, "partner-rejected", req.user?.email || "system");
    }
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
