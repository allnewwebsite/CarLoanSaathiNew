import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";

export const AUTOMATION_POLICY = Object.freeze({
  acceptanceSlaMs: 5 * 60 * 60 * 1000,
  inactivitySlaMs: 7 * 24 * 60 * 60 * 1000,
  terminalActiveMs: 7 * 24 * 60 * 60 * 1000,
  retentionMonths: 3,
});

export const TERMINAL_AUTOMATION_STATUSES = new Set([
  LEAD_STATUSES.REJECTED,
  LEAD_STATUSES.DISBURSED,
]);

export function addMilliseconds(value, milliseconds) {
  const start = new Date(value || Date.now());
  return new Date(start.getTime() + milliseconds).toISOString();
}

export function addCalendarMonths(value, months = AUTOMATION_POLICY.retentionMonths) {
  const date = new Date(value || Date.now());
  const targetDay = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(targetDay, lastDay));
  return date.toISOString();
}

export const OWNERSHIP_STATUS = Object.freeze({ PENDING: "PENDING", ACCEPTED: "ACCEPTED" });

export function assignmentAutomationPatch(now = new Date().toISOString()) {
  return {
    assignmentStatus: "pending",
    ownershipStatus: OWNERSHIP_STATUS.PENDING,
    accepted: false,
    acceptanceDueAt: addMilliseconds(now, AUTOMATION_POLICY.acceptanceSlaMs),
    acceptedAt: null,
    acceptedBy: null,
    acceptedExecutiveId: null,
    slaRunning: true,
    lastWorkflowActionAt: now,
  };
}

export function acceptedAutomationPatch(now = new Date().toISOString(), executive = {}) {
  return {
    assignmentStatus: "accepted",
    ownershipStatus: OWNERSHIP_STATUS.ACCEPTED,
    accepted: true,
    acceptedAt: now,
    acceptedBy: executive.email || executive.officialEmail || executive.id || executive.uid || null,
    acceptedExecutiveId: executive.id || executive.executiveId || executive.uid || executive.email || null,
    acceptanceDueAt: null,
    slaRunning: false,
    lastWorkflowActionAt: now,
  };
}

export function assertLeadAcceptanceEligible({ lead = {}, ownsLead = false, now = Date.now() } = {}) {
  const status = normalizeStatus(lead.status);
  const alreadyAccepted = lead.accepted === true
    || String(lead.assignmentStatus || "").toLowerCase() === "accepted"
    || String(lead.ownershipStatus || "").toUpperCase() === OWNERSHIP_STATUS.ACCEPTED;
  if (lead.isDeadCase === true) throw Object.assign(new Error("Lead closed."), { status: 409, code: "LEAD_DEAD" });
  if (status === LEAD_STATUSES.REJECTED) throw Object.assign(new Error("Lead closed."), { status: 409, code: "LEAD_REJECTED" });
  if (status === LEAD_STATUSES.DISBURSED || status === LEAD_STATUSES.CLOSED) throw Object.assign(new Error("Lead closed."), { status: 409, code: "LEAD_CLOSED" });
  if (alreadyAccepted) throw Object.assign(new Error("Lead already accepted."), { status: 409, code: "LEAD_ALREADY_ACCEPTED" });
  if (!ownsLead) throw Object.assign(new Error("Lead not assigned to this executive."), { status: 403, code: "LEAD_NOT_ASSIGNED" });
  if (String(lead.assignmentStatus || "").toLowerCase() !== "pending") throw Object.assign(new Error("Lead reassigned."), { status: 409, code: "LEAD_REASSIGNED" });
  if (status !== LEAD_STATUSES.NEW) throw Object.assign(new Error("Lead is no longer awaiting acceptance."), { status: 409, code: "LEAD_NOT_NEW" });
  const assignedAt = lead.assignmentTimestamp || lead.assignedAt || lead.reassignedAt || null;
  const deadline = new Date(lead.acceptanceDueAt || (assignedAt ? addMilliseconds(assignedAt, AUTOMATION_POLICY.acceptanceSlaMs) : 0)).getTime();
  if (deadline > 0 && deadline <= now) throw Object.assign(new Error("SLA expired."), { status: 409, code: "ACCEPTANCE_SLA_EXPIRED" });
  return true;
}

export function statusAutomationPatch(status, now = new Date().toISOString(), previousLead = {}) {
  const normalized = normalizeStatus(status);
  const terminal = TERMINAL_AUTOMATION_STATUSES.has(normalized);
  const existingTerminalAt = normalizeStatus(previousLead.status) === normalized
    ? previousLead.terminalStatusAt
    : null;
  const terminalAt = existingTerminalAt || now;
  return {
    lastWorkflowActionAt: now,
    ...(terminal ? {
      terminalStatusAt: terminalAt,
      terminalVisibleUntil: previousLead.terminalVisibleUntil || addMilliseconds(terminalAt, AUTOMATION_POLICY.terminalActiveMs),
      workflowLocation: "active",
      retentionDueAt: previousLead.retentionDueAt || addCalendarMonths(terminalAt),
    } : {
      terminalStatusAt: null,
      terminalVisibleUntil: null,
      workflowLocation: "active",
      retentionDueAt: null,
    }),
  };
}

export function currentWorkflowLocation(lead = {}, now = Date.now()) {
  if (lead.isDeadCase === true) return "dead-case";
  const status = normalizeStatus(lead.status);
  if (!TERMINAL_AUTOMATION_STATUSES.has(status)) return "active";
  const terminalAt = new Date(lead.terminalStatusAt || lead.statusUpdatedAt || lead.updatedAt || lead.createdAt || 0).getTime();
  if (!Number.isFinite(terminalAt) || now < terminalAt + AUTOMATION_POLICY.terminalActiveMs) return "active";
  return status === LEAD_STATUSES.REJECTED ? "rejected" : "disbursed";
}

export function retentionAnchor(lead = {}) {
  if (lead.isDeadCase === true) return lead.deadCaseDate || lead.deadCaseUpdatedAt || null;
  if (TERMINAL_AUTOMATION_STATUSES.has(normalizeStatus(lead.status))) {
    return lead.terminalStatusAt || lead.statusUpdatedAt || lead.updatedAt || null;
  }
  return null;
}

export function retentionDue(lead = {}, now = Date.now()) {
  const anchor = retentionAnchor(lead);
  if (!anchor) return false;
  return new Date(addCalendarMonths(anchor)).getTime() <= now;
}
