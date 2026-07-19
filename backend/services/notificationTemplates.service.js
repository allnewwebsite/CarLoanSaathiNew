export const NOTIFICATION_TYPES = Object.freeze({
  NEW_LEAD_ASSIGNED: "NEW_LEAD_ASSIGNED",
  STATUS_CHANGED: "STATUS_CHANGED",
  DEAD_CASE: "DEAD_CASE",
  USER_CREATED: "USER_CREATED",
  USER_DELETED: "USER_DELETED",
  EXECUTIVE_REMOVED: "EXECUTIVE_REMOVED",
  GM_CREATED: "GM_CREATED",
  FINANCE_MANAGER_CREATED: "FINANCE_MANAGER_CREATED",
  SYSTEM: "SYSTEM",
  LEAD_ASSIGNED: "lead-assigned",
  STATUS_UPDATED: "status-updated",
  PENDING_DOCUMENTS: "pending-documents",
  APPROVAL: "approval",
  REJECTION: "rejection",
  DISBURSED: "disbursed",
  DEALER_APPROVED: "dealer-approved",
  BANK_APPROVED: "bank-approved",
  EXECUTIVE_ASSIGNED: "EXECUTIVE_ASSIGNED",
  SYSTEM_ALERT: "system-alert",
});

const TYPE_ALIASES = Object.freeze({
  NEW_LEAD: "lead-created",
  LEAD_CREATED: "lead-created",
  NEW_LEAD_ASSIGNED: "lead-assigned",
  EXECUTIVE_ASSIGNED: "lead-assigned",
  "executive-assigned": "lead-assigned",
  STATUS_CHANGED: "status-updated",
  STATUS_UPDATE: "status-updated",
  PENDING_DOCUMENTS: "pending-documents",
  DOCUMENTS_REQUIRED: "pending-documents",
  "documents-required": "pending-documents",
  DOCUMENT_REQUESTED: "pending-documents",
  DOCUMENTS_UPLOADED: "documents-uploaded",
  DOCUMENT_UPLOADED: "documents-uploaded",
  DEAD_CASE: "dead-case",
  REJECTED: "rejection",
  CASE_REJECTED: "rejection",
  DISBURSEMENT: "disbursed",
  CASE_DISBURSED: "disbursed",
  PASSWORD_CHANGED: "password-changed",
  SUBSCRIPTION_ACTIVATED: "subscription-activated",
  PAYMENT_CAPTURED: "subscription-activated",
});

export function canonicalNotificationType(type = "") {
  const raw = String(type || "").trim();
  const key = raw.replace(/-/g, "_").toUpperCase();
  return TYPE_ALIASES[key] || raw.toLowerCase().replace(/_/g, "-") || "system";
}

function caseLine(caseId) {
  return `Case ID: ${caseId || "-"}`;
}

const templates = {
  "lead-created": {
    title: "New lead received",
    message: ({ caseId }) => caseLine(caseId),
    priority: "high",
  },
  [NOTIFICATION_TYPES.NEW_LEAD_ASSIGNED]: {
    title: "New Lead Assigned",
    message: ({ caseId }) => `Case ${caseId || ""} has been assigned to you.`,
    priority: "high",
  },
  [NOTIFICATION_TYPES.STATUS_CHANGED]: {
    title: "Case Status Updated",
    message: ({ caseId, status, executiveName }) => `Executive ${executiveName || "Loan Executive"} updated ${caseId || ""} to ${status || "updated"}.`,
    priority: "medium",
  },
  [NOTIFICATION_TYPES.DEAD_CASE]: {
    title: "Dead Case Updated",
    message: ({ caseId, reason }) => `Case ${caseId || ""} moved to dead cases${reason ? `: ${reason}` : "."}`,
    priority: "medium",
  },
  [NOTIFICATION_TYPES.USER_CREATED]: {
    title: "Welcome to CarLoanSaathi",
    message: ({ message }) => message || "Congratulations! Your account has been created successfully.",
    priority: "success",
  },
  [NOTIFICATION_TYPES.USER_DELETED]: {
    title: "User Removed",
    message: ({ memberName, roleLabel }) => `${roleLabel || "User"} ${memberName || ""} has been removed.`,
    priority: "medium",
  },
  [NOTIFICATION_TYPES.EXECUTIVE_ASSIGNED]: {
    title: "New Lead Assigned",
    message: ({ caseId }) => `Case ${caseId || ""} has been assigned to you.`,
    priority: "high",
  },
  "executive-assigned": {
    title: "New Lead Assigned",
    message: ({ caseId }) => `Case ${caseId || ""} has been assigned to you.`,
    priority: "high",
  },
  [NOTIFICATION_TYPES.EXECUTIVE_REMOVED]: {
    title: "Loan Executive Removed",
    message: ({ memberName }) => `Loan Executive ${memberName || ""} has been removed successfully.`,
    priority: "medium",
  },
  [NOTIFICATION_TYPES.GM_CREATED]: {
    title: "Welcome to CarLoanSaathi",
    message: () => "Congratulations! You have been added as General Manager.",
    priority: "success",
  },
  [NOTIFICATION_TYPES.FINANCE_MANAGER_CREATED]: {
    title: "Welcome to CarLoanSaathi",
    message: () => "Congratulations!\n\nYour Finance Manager account has been created successfully.",
    priority: "success",
  },
  [NOTIFICATION_TYPES.SYSTEM]: {
    title: "System",
    message: ({ message }) => message || "System notification.",
    priority: "low",
  },
  [NOTIFICATION_TYPES.LEAD_ASSIGNED]: {
    title: "New case assigned",
    message: ({ caseId }) => caseLine(caseId),
    priority: "high",
  },
  [NOTIFICATION_TYPES.STATUS_UPDATED]: {
    title: "Case status updated",
    message: ({ caseId }) => caseLine(caseId),
    priority: "medium",
  },
  [NOTIFICATION_TYPES.PENDING_DOCUMENTS]: {
    title: "Customer documents requested",
    message: ({ caseId }) => caseLine(caseId),
    priority: "high",
  },
  [NOTIFICATION_TYPES.REJECTION]: {
    title: "Case rejected",
    message: ({ caseId }) => caseLine(caseId),
    priority: "high",
  },
  [NOTIFICATION_TYPES.DISBURSED]: {
    title: "Loan disbursed successfully",
    message: ({ caseId }) => caseLine(caseId),
    priority: "high",
  },
  "documents-uploaded": {
    title: "Customer documents uploaded",
    message: ({ caseId }) => caseLine(caseId),
    priority: "high",
  },
  "dead-case": {
    title: "Case moved to Dead Cases",
    message: ({ caseId }) => caseLine(caseId),
    priority: "medium",
  },
  "executive-reassigned": {
    title: "Case reassigned",
    message: ({ caseId }) => caseLine(caseId),
    priority: "high",
  },
  "subscription-activated": {
    title: "Subscription activated",
    message: () => "Subscription activated successfully.",
    priority: "success",
  },
  "password-changed": {
    title: "Password changed",
    message: () => "Your password has been changed successfully.",
    priority: "high",
  },
  [NOTIFICATION_TYPES.SYSTEM_ALERT]: {
    title: "System alert",
    message: ({ message }) => message || "System alert generated.",
    priority: "critical",
  },
};

export function renderNotificationTemplate(type, data = {}) {
  const canonicalType = canonicalNotificationType(type);
  const template = templates[canonicalType] || templates[type] || templates[NOTIFICATION_TYPES.SYSTEM];
  const standardized = Boolean(templates[canonicalType]);
  return {
    title: standardized ? template.title : data.title || template.title,
    message: standardized ? template.message(data) : data.message || template.message(data),
    priority: data.priority || template.priority,
  };
}
