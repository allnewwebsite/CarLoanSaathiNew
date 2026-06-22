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

const templates = {
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
    title: "New Lead Assigned",
    message: ({ caseId }) => `Case ${caseId || ""} has been assigned to you.`,
    priority: "high",
  },
  [NOTIFICATION_TYPES.STATUS_UPDATED]: {
    title: "Lead status updated",
    message: ({ caseId, status }) => `Lead ${caseId || ""} status changed to ${status || "updated"}.`,
    priority: "medium",
  },
  [NOTIFICATION_TYPES.PENDING_DOCUMENTS]: {
    title: "Documents pending",
    message: ({ caseId }) => `Lead ${caseId || ""} requires pending documents.`,
    priority: "high",
  },
  [NOTIFICATION_TYPES.REJECTION]: {
    title: "Loan rejected",
    message: ({ caseId, reason }) => `Lead ${caseId || ""} was rejected${reason ? `: ${reason}` : "."}`,
    priority: "high",
  },
  [NOTIFICATION_TYPES.DISBURSED]: {
    title: "Loan disbursed",
    message: ({ caseId }) => `Lead ${caseId || ""} has been disbursed.`,
    priority: "high",
  },
  [NOTIFICATION_TYPES.SYSTEM_ALERT]: {
    title: "System alert",
    message: ({ message }) => message || "System alert generated.",
    priority: "critical",
  },
};

export function renderNotificationTemplate(type, data = {}) {
  const template = templates[type] || templates[NOTIFICATION_TYPES.STATUS_UPDATED];
  return {
    title: data.title || template.title,
    message: data.message || template.message(data),
    priority: data.priority || template.priority,
  };
}
