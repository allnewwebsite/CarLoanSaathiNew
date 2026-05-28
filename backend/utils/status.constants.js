export const LEAD_STATUSES = Object.freeze({
  NEW: "NEW",
  CONTACTED: "CONTACTED",
  REQUEST_DOCUMENT: "REQUEST_DOCUMENT",
  DOCUMENT_RECEIVED: "DOCUMENT_RECEIVED",
  REQUEST_PENDING_DOCUMENTS: "REQUEST_PENDING_DOCUMENTS",
  ALL_DOCUMENTS_RECEIVED: "ALL_DOCUMENTS_RECEIVED",
  UNDER_BANK_PROCESS: "UNDER_BANK_PROCESS",
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
  CONTACTED: "Contacted",
  REQUEST_DOCUMENT: "Request Document",
  DOCUMENT_RECEIVED: "Document Received",
  REQUEST_PENDING_DOCUMENTS: "Request Pending Documents",
  ALL_DOCUMENTS_RECEIVED: "All Documents Received",
  UNDER_BANK_PROCESS: "Under Bank Process",
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
  Contacted: LEAD_STATUSES.CONTACTED,
  "Request Document": LEAD_STATUSES.REQUEST_DOCUMENT,
  "Document Received": LEAD_STATUSES.DOCUMENT_RECEIVED,
  "Request Pending Documents": LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS,
  "Pending Documents": LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS,
  "All Documents Received": LEAD_STATUSES.ALL_DOCUMENTS_RECEIVED,
  "Under Bank Process": LEAD_STATUSES.UNDER_BANK_PROCESS,
  Assigned: LEAD_STATUSES.ASSIGNED,
  "Under Review": LEAD_STATUSES.UNDER_REVIEW,
  "Bank Processing": LEAD_STATUSES.UNDER_BANK_PROCESS,
  "Docs Pending": LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS,
  Approved: LEAD_STATUSES.APPROVED,
  Rejected: LEAD_STATUSES.REJECTED,
  Disbursed: LEAD_STATUSES.DISBURSED,
  Closed: LEAD_STATUSES.CLOSED,
});

export const VALID_TRANSITIONS = Object.freeze({
  NEW: ["CONTACTED", "REQUEST_DOCUMENT", "REQUEST_PENDING_DOCUMENTS", "UNDER_BANK_PROCESS", "DISBURSED", "REJECTED", "ASSIGNED", "UNDER_REVIEW", "DOCS_PENDING", "CLOSED"],
  CONTACTED: ["REQUEST_DOCUMENT", "DOCUMENT_RECEIVED", "REQUEST_PENDING_DOCUMENTS", "ALL_DOCUMENTS_RECEIVED", "UNDER_BANK_PROCESS", "DISBURSED", "REJECTED", "CLOSED"],
  REQUEST_DOCUMENT: ["DOCUMENT_RECEIVED", "REQUEST_PENDING_DOCUMENTS", "ALL_DOCUMENTS_RECEIVED", "UNDER_BANK_PROCESS", "DISBURSED", "REJECTED", "CLOSED"],
  DOCUMENT_RECEIVED: ["REQUEST_PENDING_DOCUMENTS", "ALL_DOCUMENTS_RECEIVED", "UNDER_BANK_PROCESS", "DISBURSED", "REJECTED", "CLOSED"],
  REQUEST_PENDING_DOCUMENTS: ["DOCUMENT_RECEIVED", "ALL_DOCUMENTS_RECEIVED", "UNDER_BANK_PROCESS", "DISBURSED", "REJECTED", "CLOSED"],
  ALL_DOCUMENTS_RECEIVED: ["UNDER_BANK_PROCESS", "DISBURSED", "REJECTED", "CLOSED"],
  UNDER_BANK_PROCESS: ["DISBURSED", "REJECTED", "CLOSED"],
  ASSIGNED: ["CONTACTED", "REQUEST_DOCUMENT", "UNDER_BANK_PROCESS", "ACCEPTED", "UNDER_REVIEW", "DOCS_PENDING", "REJECTED", "CLOSED"],
  ACCEPTED: ["CONTACTED", "REQUEST_DOCUMENT", "UNDER_BANK_PROCESS", "DOCS_PENDING", "APPROVED", "REJECTED", "CLOSED"],
  UNDER_REVIEW: ["REQUEST_PENDING_DOCUMENTS", "UNDER_BANK_PROCESS", "DOCS_PENDING", "APPROVED", "REJECTED", "DISBURSED", "CLOSED"],
  DOCS_PENDING: ["DOCUMENT_RECEIVED", "ALL_DOCUMENTS_RECEIVED", "UNDER_BANK_PROCESS", "APPROVED", "REJECTED", "CLOSED"],
  APPROVED: ["UNDER_BANK_PROCESS", "DISBURSED", "CLOSED"],
  REJECTED: ["NEW", "ASSIGNED", "CLOSED"],
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
