import { LEAD_STATUSES, normalizeStatus, statusLabel } from "../constants/status.js";

export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && typeof value.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date?.getTime?.()) ? null : date;
  }
  if (typeof value === "object" && Number.isFinite(value.seconds)) {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeAmPm(text) {
  return String(text || "").replace(/\b(am|pm)\b/i, (match) => match.toLowerCase());
}

export function formatPortalDateTime(value) {
  const date = toDate(value);
  if (!date) return "-";
  return normalizeAmPm(date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }));
}

export function formatPortalDate(value) {
  const date = toDate(value);
  if (!date) return "-";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatPortalTime(value) {
  const date = toDate(value);
  if (!date) return "-";
  return normalizeAmPm(date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true }));
}

export function cleanPortalText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function displayPortalText(value, fallback = "-") {
  const text = cleanPortalText(value);
  return text || fallback;
}

export function portalWorkflowStatus(value) {
  const normalized = normalizeStatus(value);
  if (normalized === LEAD_STATUSES.ASSIGNED) return LEAD_STATUSES.NEW;
  if ([LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW, LEAD_STATUSES.APPROVED].includes(normalized)) return LEAD_STATUSES.UNDER_BANK_PROCESS;
  if (normalized === LEAD_STATUSES.DOCS_PENDING) return LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS;
  return normalized;
}

export function portalLeadStatusLabel(leadOrStatus) {
  const lead = leadOrStatus && typeof leadOrStatus === "object" ? leadOrStatus : null;
  const rawStatus = lead ? lead.status || lead.assignmentStatus || LEAD_STATUSES.NEW : leadOrStatus;
  const status = portalWorkflowStatus(rawStatus);
  if (status === LEAD_STATUSES.REJECTED) {
    const reason = cleanPortalText(lead?.rejectionReason || lead?.loanRejectionReason || lead?.rejectionRemarks);
    return reason ? `Loan Rejected: ${reason}` : "Rejected";
  }
  return statusLabel(status);
}

export function loanExecutiveRemark(lead) {
  const candidates = [
    lead?.loanExecutiveRemark,
    lead?.executiveRemark,
    lead?.pendingDocumentReason,
    lead?.rejectionRemarks,
    lead?.approvalRemarks,
    lead?.disbursementRemarks,
    lead?.bankRemarks,
    lead?.latestRemark,
    lead?.remarks,
  ];
  return candidates.map(cleanPortalText).find(Boolean) || "-";
}

function normalizeDocumentName(value) {
  const text = cleanPortalText(value);
  return text && text !== "-" ? text : "";
}

function collectDocumentNames(target, value) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectDocumentNames(target, item));
    return;
  }
  if (value && typeof value === "object") {
    collectDocumentNames(target, value.document || value.documentName || value.documentType || value.type || value.label || value.name);
    return;
  }
  const text = normalizeDocumentName(value);
  if (text) target.push(text);
}

function isActivePendingDocumentStatus(value) {
  return [
    "REQUEST_DOCUMENT",
    "REQUEST_PENDING_DOCUMENTS",
    "DOCS_PENDING",
    "Request Document",
    "Request Pending Documents",
    "Pending Documents",
    "Docs Pending",
    "Pending Docs",
  ].includes(String(value || "").trim());
}

export function pendingDocumentItems(lead) {
  const names = [];
  collectDocumentNames(names, lead?.pendingDocuments);
  collectDocumentNames(names, lead?.pendingDocument);
  if (names.length) return [...new Map(names.map((item) => [item.toLowerCase(), item])).values()];
  if (!isActivePendingDocumentStatus(lead?.status)) return [];
  (Array.isArray(lead?.pendingDocumentsRequested) ? lead.pendingDocumentsRequested : []).forEach((request) => {
    collectDocumentNames(names, request?.documents || request?.document || request?.pendingDocuments);
  });
  return [...new Map(names.map((item) => [item.toLowerCase(), item])).values()];
}

export function pendingDocumentRequests(lead) {
  if (!pendingDocumentItems(lead).length) return [];
  return (Array.isArray(lead?.pendingDocumentsRequested) ? lead.pendingDocumentsRequested : [])
    .map((request, index) => {
      const documents = [];
      collectDocumentNames(documents, request?.documents || request?.document || request?.pendingDocuments);
      return {
        id: request?.id || `${request?.requestedAt || "request"}-${index}`,
        documents: [...new Map(documents.map((item) => [item.toLowerCase(), item])).values()],
        notes: displayPortalText(request?.notes || request?.remark || request?.reason, ""),
        requestedBy: displayPortalText(request?.requestedByExecutiveName || request?.requestedBy || request?.requestedByExecutiveId, ""),
        requestedAt: request?.requestedAt || request?.createdAt || request?.timestamp || null,
      };
    })
    .filter((request) => request.documents.length || request.notes || request.requestedAt)
    .sort((a, b) => String(b.requestedAt || "").localeCompare(String(a.requestedAt || "")));
}

export function bankDocumentRows(lead) {
  const rows = Array.isArray(lead?.bankDocuments) ? lead.bankDocuments : [];
  if (rows.length) return rows;
  if (lead?.sanctionLetterUrl) {
    return [{
      id: lead.sanctionLetterDocumentId || "sanction-letter",
      documentType: "Sanction Letter",
      url: lead.sanctionLetterUrl,
      uploadedAt: lead.sanctionLetterUploadedAt,
      uploadedBy: lead.sanctionLetterUploadedBy,
    }];
  }
  return [];
}
