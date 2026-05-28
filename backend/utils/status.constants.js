export const LEAD_STATUSES = Object.freeze({
  NEW: "NEW",
  ASSIGNED: "ASSIGNED",
  ACCEPTED: "ACCEPTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  DOCS_PENDING: "DOCS_PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  DISBURSED: "DISBURSED",
  CLOSED: "CLOSED",
});

export const ALLOWED_LEAD_STATUSES = Object.values(LEAD_STATUSES);

export const STATUS_LABELS = Object.freeze({
  NEW: "New",
  ASSIGNED: "Assigned",
  ACCEPTED: "Accepted",
  UNDER_REVIEW: "Under Review",
  DOCS_PENDING: "Docs Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  DISBURSED: "Disbursed",
  CLOSED: "Closed",
});

export const LEGACY_STATUS_TO_STANDARD = Object.freeze({
  New: LEAD_STATUSES.NEW,
  Assigned: LEAD_STATUSES.ASSIGNED,
  "Under Review": LEAD_STATUSES.UNDER_REVIEW,
  "Bank Processing": LEAD_STATUSES.UNDER_REVIEW,
  "Docs Pending": LEAD_STATUSES.DOCS_PENDING,
  Approved: LEAD_STATUSES.APPROVED,
  Rejected: LEAD_STATUSES.REJECTED,
  Disbursed: LEAD_STATUSES.DISBURSED,
  Closed: LEAD_STATUSES.CLOSED,
});

export const VALID_TRANSITIONS = Object.freeze({
  NEW: ["ASSIGNED", "UNDER_REVIEW", "REJECTED", "CLOSED"],
  ASSIGNED: ["ACCEPTED", "UNDER_REVIEW", "DOCS_PENDING", "REJECTED", "CLOSED"],
  ACCEPTED: ["UNDER_REVIEW", "DOCS_PENDING", "APPROVED", "REJECTED", "CLOSED"],
  UNDER_REVIEW: ["DOCS_PENDING", "APPROVED", "REJECTED", "DISBURSED", "CLOSED"],
  DOCS_PENDING: ["UNDER_REVIEW", "APPROVED", "REJECTED", "CLOSED"],
  APPROVED: ["DISBURSED", "CLOSED"],
  REJECTED: ["ASSIGNED", "CLOSED"],
  DISBURSED: ["CLOSED"],
  CLOSED: [],
});

export const DOCUMENT_STATUSES = Object.freeze({
  UPLOADED: "Uploaded",
  APPROVED: "Approved",
  PENDING: "Pending",
  REQUESTED: "Requested",
  REJECTED: "Rejected",
});

export const ALLOWED_DOCUMENT_STATUSES = Object.values(DOCUMENT_STATUSES);

export const VALID_DOCUMENT_TRANSITIONS = Object.freeze({
  Uploaded: ["Approved", "Pending", "Requested", "Rejected"],
  Pending: ["Uploaded", "Approved", "Requested", "Rejected"],
  Requested: ["Uploaded", "Approved", "Pending", "Rejected"],
  Rejected: ["Uploaded", "Approved", "Pending", "Requested"],
  Approved: ["Pending", "Requested", "Rejected"],
});

export function normalizeStatus(status) {
  if (!status) return LEAD_STATUSES.NEW;
  return ALLOWED_LEAD_STATUSES.includes(status) ? status : LEGACY_STATUS_TO_STANDARD[status] || status;
}

export function assertValidStatusTransition(currentStatus, nextStatus) {
  const current = normalizeStatus(currentStatus);
  const next = normalizeStatus(nextStatus);
  if (!ALLOWED_LEAD_STATUSES.includes(next)) {
    const error = new Error("Invalid lead status");
    error.status = 400;
    throw error;
  }
  if (current === next) return next;
  if (!VALID_TRANSITIONS[current]?.includes(next)) {
    const error = new Error(`Invalid status transition from ${current} to ${next}`);
    error.status = 400;
    throw error;
  }
  return next;
}

export function assertValidDocumentStatusTransition(currentStatus, nextStatus) {
  const current = ALLOWED_DOCUMENT_STATUSES.includes(currentStatus) ? currentStatus : DOCUMENT_STATUSES.UPLOADED;
  const next = String(nextStatus || "").trim();
  if (!ALLOWED_DOCUMENT_STATUSES.includes(next)) {
    const error = new Error("Invalid document status");
    error.status = 400;
    throw error;
  }
  if (current === next) return next;
  if (!VALID_DOCUMENT_TRANSITIONS[current]?.includes(next)) {
    const error = new Error(`Invalid document status transition from ${current} to ${next}`);
    error.status = 400;
    throw error;
  }
  return next;
}
