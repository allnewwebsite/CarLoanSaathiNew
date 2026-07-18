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

export function assignmentAutomationPatch(now = new Date().toISOString()) {
  return {
    assignmentStatus: "pending",
    acceptanceDueAt: addMilliseconds(now, AUTOMATION_POLICY.acceptanceSlaMs),
    acceptedAt: null,
    lastWorkflowActionAt: now,
  };
}

export function acceptedAutomationPatch(now = new Date().toISOString()) {
  return {
    assignmentStatus: "accepted",
    acceptedAt: now,
    acceptanceDueAt: null,
    lastWorkflowActionAt: now,
  };
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
