export const NOTIFICATION_TYPES = Object.freeze({
  LEAD_ASSIGNED: "lead-assigned",
  STATUS_UPDATED: "status-updated",
  PENDING_DOCUMENTS: "pending-documents",
  APPROVAL: "approval",
  REJECTION: "rejection",
  DISBURSED: "disbursed",
  DEALER_APPROVED: "dealer-approved",
  BANK_APPROVED: "bank-approved",
  EXECUTIVE_ASSIGNED: "executive-assigned",
  SYSTEM_ALERT: "system-alert",
});

const templates = {
  [NOTIFICATION_TYPES.LEAD_ASSIGNED]: {
    title: "New lead assigned",
    message: ({ caseId }) => `Lead ${caseId || ""} has been assigned.`,
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
