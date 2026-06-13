import { LEAD_STATUSES, normalizeStatus } from "./status.constants.js";

export const ARCHIVE_RULES = Object.freeze({
  [LEAD_STATUSES.REJECTED]: {
    days: 90,
    reason: "AUTO_REJECTED_90_DAYS",
  },
  [LEAD_STATUSES.DISBURSED]: {
    days: 180,
    reason: "AUTO_DISBURSED_180_DAYS",
  },
});

export function isArchivedLead(lead = {}) {
  return lead.isArchived === true;
}

export function assertLeadMutable(lead = {}) {
  if (!isArchivedLead(lead)) return lead;
  const error = new Error("Archived cases are read-only");
  error.status = 409;
  error.code = "ARCHIVED_LEAD_IMMUTABLE";
  throw error;
}

export function archiveRuleForLead(lead = {}) {
  return ARCHIVE_RULES[normalizeStatus(lead.status)] || null;
}

export function leadArchiveReferenceDate(lead = {}) {
  return lead.statusUpdatedAt
    || (normalizeStatus(lead.status) === LEAD_STATUSES.REJECTED ? lead.rejectedAt : null)
    || (normalizeStatus(lead.status) === LEAD_STATUSES.DISBURSED ? lead.disbursementDate : null)
    || lead.updatedAt
    || lead.createdAt
    || null;
}

export function archiveEligibleAt(lead = {}) {
  const rule = archiveRuleForLead(lead);
  const reference = leadArchiveReferenceDate(lead);
  if (!rule || !reference || isArchivedLead(lead)) return null;
  const timestamp = new Date(reference).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp + rule.days * 24 * 60 * 60 * 1000);
}

export function shouldArchiveLead(lead = {}, now = new Date()) {
  const eligibleAt = archiveEligibleAt(lead);
  return Boolean(eligibleAt && eligibleAt.getTime() <= now.getTime());
}
