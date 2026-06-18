import { getRecord, updateRecord } from "./firestore.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "./timeline.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "./audit.service.js";
import { createNotification } from "./notification.service.js";
import { syncLeadProjection } from "./projection.service.js";
import { publishRealtimeEvent, REALTIME_EVENTS } from "./realtime.service.js";
import { clearCachedValue } from "./ttlCache.service.js";
import { DEAD_CASE_REASONS } from "../utils/deadCase.js";

function clean(value = "") {
  return String(value || "").trim();
}

export function assertDeadReason(reason = "") {
  const value = clean(reason);
  if (!DEAD_CASE_REASONS.includes(value)) {
    const error = new Error("Valid dead case reason is required.");
    error.status = 400;
    error.code = "INVALID_DEAD_CASE_REASON";
    throw error;
  }
  return value;
}

export function assertDeadNotes(notes = "") {
  const value = clean(notes);
  if (!value) {
    const error = new Error("Dead case notes are required.");
    error.status = 400;
    error.code = "DEAD_CASE_NOTES_REQUIRED";
    throw error;
  }
  return value;
}

function assertCaseNumber(caseNumber = "") {
  const value = clean(caseNumber).toUpperCase();
  if (!value || !/^CLS-[A-Z0-9-]+$/i.test(value)) {
    const error = new Error("Invalid Case Number");
    error.status = 400;
    error.code = "INVALID_CASE_NUMBER";
    throw error;
  }
  return value;
}

function assertFinanceDesk(req) {
  if (req.user?.role === "finance-desk") return;
  const error = new Error("Only Finance Desk can modify dead cases.");
  error.status = 403;
  error.code = "DEAD_CASE_FINANCE_ONLY";
  throw error;
}

function assertDealershipAccess(req, lead = {}) {
  const dealershipId = clean(req.user?.dealershipId || req.user?.email || req.user?.uid).toLowerCase();
  const leadDealership = clean(lead.dealershipId || lead.dealershipEmail || lead.dealerEmail || lead.createdBy).toLowerCase();
  if (req.user?.role === "super-admin" || (dealershipId && leadDealership && dealershipId === leadDealership)) return;
  const error = new Error("Lead access denied.");
  error.status = 403;
  error.code = "DEAD_CASE_ACCESS_DENIED";
  throw error;
}

function clearLeadCaches(leadId) {
  clearCachedValue(`lead-detail:${leadId}:`);
  clearCachedValue(`timeline:lead:${leadId}:`);
  ["admin:", "bank:", "dealer:", "finance:", "gm:", "lead-query:"].forEach(clearCachedValue);
}

async function notifyDeadCaseChange({ lead, eventType, title, message, req }) {
  const isMarkedDead = eventType === REALTIME_EVENTS.DEAD_CASE_CREATED || eventType === REALTIME_EVENTS.LEAD_MARKED_DEAD;
  return createNotification({
    type: isMarkedDead ? "dead-case" : [REALTIME_EVENTS.DEAD_CASE_RESTORED, REALTIME_EVENTS.LEAD_RESTORED_FROM_DEAD].includes(eventType) ? "dead-case-restored" : "dead-case-updated",
    title,
    message,
    leadId: lead.id,
    dealerEmail: lead.dealerEmail || lead.dealershipEmail || req.user?.email || null,
    admin: true,
    recipientRole: "finance-desk",
    recipientId: lead.dealerEmail || lead.dealershipEmail || req.user?.email || lead.dealershipId || null,
    phoneNumber: lead.mobile || lead.customerMobile || lead.dealerMobile || null,
    priority: isMarkedDead ? "high" : "normal",
    dealershipId: lead.dealershipId || lead.dealershipEmail || null,
    bankId: lead.bankId || lead.assignedBankId || null,
    assignedExecutiveId: lead.assignedExecutiveId || lead.assignedExecutiveEmail || null,
    entityType: "lead",
    entityId: lead.id,
    source: "dead-case",
    leadSnapshot: lead,
    meta: {
      caseId: lead.caseId,
      customerName: lead.fullName || lead.customerName,
      deadCaseReason: lead.deadCaseReason || null,
      deadCaseDate: lead.deadCaseDate || null,
      navigateTo: "/finance/dead-cases",
      actor: req.user?.email || req.user?.uid || "finance-desk",
    },
  });
}

async function persistDeadCaseChange({ req, lead, patch, actionType, timelineEventType, timelineTitle, timelineDescription, eventType }) {
  const updated = await updateRecord("leads", lead.id, patch, { mutationRole: "finance-desk" });
  clearLeadCaches(lead.id);
  await syncLeadProjection(updated);
  await addTimelineEvent({
    leadId: lead.id,
    eventType: timelineEventType || eventType,
    title: timelineTitle,
    description: timelineDescription,
    actorName: req.user?.email || req.user?.uid || "Finance Desk",
    actorRole: req.user?.role || "finance-desk",
    dealershipId: updated.dealershipId || updated.dealershipEmail || null,
    metadata: {
      caseId: updated.caseId,
      deadCaseReason: updated.deadCaseReason || null,
      deadCaseNotes: updated.deadCaseNotes || null,
      previousStatus: lead.status || null,
    },
  });
  await writeAuditLog({
    req,
    actionType,
    leadId: lead.id,
    oldValue: {
      isDeadCase: lead.isDeadCase === true,
      deadCaseReason: lead.deadCaseReason || null,
      deadCaseNotes: lead.deadCaseNotes || null,
      status: lead.status || null,
    },
    newValue: {
      isDeadCase: updated.isDeadCase === true,
      deadCaseReason: updated.deadCaseReason || null,
      deadCaseNotes: updated.deadCaseNotes || null,
      status: updated.status || null,
    },
    meta: {
      caseId: updated.caseId,
      dealershipId: updated.dealershipId,
      bankId: updated.bankId,
      deadCaseReason: updated.deadCaseReason || null,
    },
  });
  await notifyDeadCaseChange({
    lead: updated,
    eventType,
    title: timelineTitle,
    message: `${updated.caseId || updated.id}: ${timelineDescription}`,
    req,
  });
  publishRealtimeEvent({
    eventType,
    lead: updated,
    actor: req.user,
    data: {
      isDeadCase: updated.isDeadCase === true,
      deadCaseDate: updated.deadCaseDate || null,
      deadCaseReason: updated.deadCaseReason || null,
    },
  });
  return updated;
}

export async function moveLeadToDeadCase({ req, leadId, reason, notes }) {
  assertFinanceDesk(req);
  const lead = await getRecord("leads", leadId);
  if (!lead) {
    const error = new Error("Case Not Found");
    error.status = 404;
    error.code = "CASE_NOT_FOUND";
    throw error;
  }
  assertDealershipAccess(req, lead);
  if (lead.isDeadCase === true) {
    const error = new Error("Case Already In Dead Cases");
    error.status = 409;
    error.code = "CASE_ALREADY_DEAD";
    throw error;
  }
  const now = new Date().toISOString();
  const actor = req.user?.email || req.user?.uid || "finance-desk";
  return persistDeadCaseChange({
    req,
    lead,
    patch: {
      isDeadCase: true,
      deadCaseDate: lead.deadCaseDate || now,
      deadCaseBy: actor,
      deadCaseByRole: req.user?.role || "finance-desk",
      deadCaseReason: assertDeadReason(reason),
      deadCaseNotes: assertDeadNotes(notes),
      deadCaseUpdatedAt: now,
    },
    actionType: AUDIT_ACTIONS.LEAD_MARKED_DEAD,
    timelineEventType: TIMELINE_EVENTS.DEAD_CASE_MARKED,
    timelineTitle: "Moved To Dead Cases",
    timelineDescription: "Finance Desk marked this case as no longer actively pursued.",
    eventType: REALTIME_EVENTS.DEAD_CASE_CREATED,
  });
}

export async function moveCaseNumberToDeadCase({ req, caseNumber, reason, notes }) {
  const validCaseNumber = assertCaseNumber(caseNumber);
  return moveLeadToDeadCase({
    req,
    leadId: validCaseNumber,
    reason,
    notes,
  });
}

export async function restoreDeadCase({ req, leadId }) {
  assertFinanceDesk(req);
  const lead = await getRecord("leads", leadId);
  if (!lead) {
    const error = new Error("Lead not found.");
    error.status = 404;
    throw error;
  }
  assertDealershipAccess(req, lead);
  return persistDeadCaseChange({
    req,
    lead,
    patch: {
      isDeadCase: false,
      deadCaseUpdatedAt: new Date().toISOString(),
      restoredFromDeadCaseAt: new Date().toISOString(),
      restoredFromDeadCaseBy: req.user?.email || req.user?.uid || "finance-desk",
    },
    actionType: AUDIT_ACTIONS.LEAD_RESTORED_FROM_DEAD,
    timelineEventType: TIMELINE_EVENTS.DEAD_CASE_RESTORED,
    timelineTitle: "Restored From Dead Cases",
    timelineDescription: "Finance Desk restored this case to the active workflow.",
    eventType: REALTIME_EVENTS.DEAD_CASE_RESTORED,
  });
}

export async function updateDeadCaseMetadata({ req, leadId, reason, notes }) {
  assertFinanceDesk(req);
  const lead = await getRecord("leads", leadId);
  if (!lead) {
    const error = new Error("Lead not found.");
    error.status = 404;
    throw error;
  }
  assertDealershipAccess(req, lead);
  if (lead.isDeadCase !== true) {
    const error = new Error("Only dead cases can be updated here.");
    error.status = 409;
    error.code = "NOT_A_DEAD_CASE";
    throw error;
  }
  return persistDeadCaseChange({
    req,
    lead,
      patch: {
        deadCaseReason: assertDeadReason(reason),
        deadCaseNotes: assertDeadNotes(notes),
      deadCaseUpdatedAt: new Date().toISOString(),
    },
    actionType: AUDIT_ACTIONS.DEAD_CASE_UPDATED,
    timelineEventType: TIMELINE_EVENTS.DEAD_CASE_UPDATED,
    timelineTitle: "Dead Case Details Updated",
    timelineDescription: "Finance Desk updated the dead case reason or notes.",
    eventType: REALTIME_EVENTS.DEAD_CASE_UPDATED,
  });
}
