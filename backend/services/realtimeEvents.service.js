export const REALTIME_EVENTS = {
  LEAD_CREATED: "LEAD_CREATED",
  LEAD_UPDATED: "LEAD_UPDATED",
  LEAD_ASSIGNED: "LEAD_ASSIGNED",
  LEAD_REASSIGNED: "LEAD_REASSIGNED",
  BANK_ASSIGNED: "BANK_ASSIGNED",
  LEAD_STATUS_UPDATED: "LEAD_STATUS_UPDATED",
  LEAD_STATUS_CHANGED: "LEAD_STATUS_UPDATED",
  STATUS_UPDATED: "STATUS_UPDATED",
  LEAD_REMARK_ADDED: "LEAD_REMARK_ADDED",
  LEAD_ACCEPTED: "LEAD_ACCEPTED",
  LEAD_REJECTED: "LEAD_REJECTED",
  EXECUTIVE_ASSIGNED: "EXECUTIVE_ASSIGNED",
  EXECUTIVE_REASSIGNED: "EXECUTIVE_REASSIGNED",
  DOCUMENT_UPLOADED: "DOCUMENT_UPLOADED",
  DOCUMENT_REQUESTED: "DOCUMENT_REQUESTED",
  LEAD_APPROVED: "LEAD_APPROVED",
  LEAD_DISBURSED: "LEAD_DISBURSED",
  DEAD_CASE_CREATED: "DEAD_CASE_CREATED",
  DEAD_CASE_RESTORED: "DEAD_CASE_RESTORED",
  LEAD_MARKED_DEAD: "LEAD_MARKED_DEAD",
  LEAD_RESTORED_FROM_DEAD: "LEAD_RESTORED_FROM_DEAD",
  DEAD_CASE_UPDATED: "DEAD_CASE_UPDATED",
  BANK_CREATED: "BANK_CREATED",
  BANK_UPDATED: "BANK_UPDATED",
  BANK_DISABLED: "BANK_DISABLED",
  BANK_EXECUTIVE_CREATED: "BANK_EXECUTIVE_CREATED",
  BANK_EXECUTIVE_DELETED: "BANK_EXECUTIVE_DELETED",
  BRANCH_CREATED: "BRANCH_CREATED",
  BRANCH_UPDATED: "BRANCH_UPDATED",
  BRANCH_DISABLED: "BRANCH_DISABLED",
  DEALER_CREATED: "DEALER_CREATED",
  DEALER_APPROVED: "DEALER_APPROVED",
  DEALER_UPDATED: "DEALER_UPDATED",
  DEALER_DISABLED: "DEALER_DISABLED",
  DEALER_LOCATION_UPDATED: "DEALER_LOCATION_UPDATED",
  DEALER_CAPACITY_UPDATED: "DEALER_CAPACITY_UPDATED",
  NOTIFICATION_CREATED: "NOTIFICATION_CREATED",
  PAYMENT_UPDATED: "PAYMENT_UPDATED",
  STAFF_CHANGED: "STAFF_CHANGED",
  FINANCE_MANAGER_CHANGED: "FINANCE_MANAGER_CHANGED",
  SALESPERSON_CHANGED: "SALESPERSON_CHANGED",
  SUBSCRIPTION_TRIAL_STARTED: "SUBSCRIPTION_TRIAL_STARTED",
  SUBSCRIPTION_UPDATED: "SUBSCRIPTION_UPDATED",
  SUBSCRIPTION_RENEWED: "SUBSCRIPTION_RENEWED",
  SUBSCRIPTION_EXTENDED: "SUBSCRIPTION_EXTENDED",
  SUBSCRIPTION_EXPIRED: "SUBSCRIPTION_EXPIRED",
  USER_APPROVED: "USER_APPROVED",
  USER_REJECTED: "USER_REJECTED",
  ACCOUNT_APPROVED: "ACCOUNT_APPROVED",
  ACCOUNT_REJECTED: "ACCOUNT_REJECTED",
  GM_APPROVED: "GM_APPROVED",
  FINANCE_APPROVED: "FINANCE_APPROVED",
};

export const PHASE_ONE_EVENTS = new Set([
  REALTIME_EVENTS.LEAD_STATUS_UPDATED,
  REALTIME_EVENTS.LEAD_REMARK_ADDED,
  REALTIME_EVENTS.DOCUMENT_UPLOADED,
]);

const ROLE_GROUPS = Object.freeze({
  allPlatform: ["super-admin"],
  dealership: ["super-admin", "finance-desk", "gm"],
  bank: ["super-admin", "finance-desk", "gm", "bank-manager"],
  assignedExecutive: ["super-admin", "finance-desk", "gm", "bank-manager", "loan-executive"],
  workflow: ["finance-desk", "gm", "bank-manager", "loan-executive"],
  notification: ["super-admin", "finance-desk", "gm", "bank-manager", "loan-executive"],
});

function eventDefinition({
  eventType,
  module,
  description,
  roles,
  scopes,
  payload,
  patches = ["table-row", "detail", "counter", "notification-badge"],
}) {
  return Object.freeze({ eventType, module, description, roles, scopes, payload, patches });
}

const DETAILED_REALTIME_EVENT_REGISTRY = Object.freeze({
  [REALTIME_EVENTS.LEAD_CREATED]: eventDefinition({
    eventType: REALTIME_EVENTS.LEAD_CREATED,
    module: "dealership",
    description: "A dealership finance desk submitted a new lead.",
    roles: ROLE_GROUPS.dealership,
    scopes: ["dealershipIds"],
    payload: ["leadId", "caseId", "lead"],
  }),
  [REALTIME_EVENTS.LEAD_UPDATED]: eventDefinition({
    eventType: REALTIME_EVENTS.LEAD_UPDATED,
    module: "dealership",
    description: "A lead profile or assignment-visible field changed.",
    roles: ROLE_GROUPS.assignedExecutive,
    scopes: ["dealershipIds", "bankIds", "executiveIds", "branchIds"],
    payload: ["leadId", "caseId", "lead"],
  }),
  [REALTIME_EVENTS.LEAD_ASSIGNED]: eventDefinition({
    eventType: REALTIME_EVENTS.LEAD_ASSIGNED,
    module: "assignment",
    description: "A lead was assigned to a bank or partner queue.",
    roles: ROLE_GROUPS.bank,
    scopes: ["dealershipIds", "bankIds", "branchIds"],
    payload: ["leadId", "caseId", "bankId", "lead"],
  }),
  [REALTIME_EVENTS.LEAD_REASSIGNED]: eventDefinition({
    eventType: REALTIME_EVENTS.LEAD_REASSIGNED,
    module: "assignment",
    description: "A lead changed bank or executive ownership.",
    roles: ROLE_GROUPS.assignedExecutive,
    scopes: ["dealershipIds", "bankIds", "executiveIds", "branchIds"],
    payload: ["leadId", "caseId", "bankId", "executiveId", "lead"],
  }),
  [REALTIME_EVENTS.BANK_ASSIGNED]: eventDefinition({
    eventType: REALTIME_EVENTS.BANK_ASSIGNED,
    module: "assignment",
    description: "A lead was assigned to a bank branch.",
    roles: ROLE_GROUPS.bank,
    scopes: ["dealershipIds", "bankIds", "branchIds"],
    payload: ["leadId", "caseId", "bankId", "branchId", "lead"],
  }),
  [REALTIME_EVENTS.EXECUTIVE_ASSIGNED]: eventDefinition({
    eventType: REALTIME_EVENTS.EXECUTIVE_ASSIGNED,
    module: "loan-executive",
    description: "A lead was assigned to a specific loan executive.",
    roles: ROLE_GROUPS.assignedExecutive,
    scopes: ["dealershipIds", "bankIds", "executiveIds", "recipientIds", "branchIds"],
    payload: ["leadId", "caseId", "executiveId", "lead"],
  }),
  [REALTIME_EVENTS.EXECUTIVE_REASSIGNED]: eventDefinition({
    eventType: REALTIME_EVENTS.EXECUTIVE_REASSIGNED,
    module: "loan-executive",
    description: "A lead moved from one executive to another.",
    roles: ROLE_GROUPS.assignedExecutive,
    scopes: ["dealershipIds", "bankIds", "executiveIds", "recipientIds", "branchIds"],
    payload: ["leadId", "caseId", "previousExecutiveId", "executiveId", "lead"],
  }),
  [REALTIME_EVENTS.LEAD_STATUS_UPDATED]: eventDefinition({
    eventType: REALTIME_EVENTS.LEAD_STATUS_UPDATED,
    module: "workflow",
    description: "A lead workflow status changed.",
    roles: ROLE_GROUPS.workflow,
    scopes: ["dealershipIds", "bankIds", "executiveIds", "branchIds"],
    payload: ["leadId", "caseId", "status", "previousStatus", "lead"],
  }),
  [REALTIME_EVENTS.STATUS_UPDATED]: eventDefinition({
    eventType: REALTIME_EVENTS.STATUS_UPDATED,
    module: "workflow",
    description: "Generic status update event for counters and status tabs.",
    roles: ROLE_GROUPS.workflow,
    scopes: ["dealershipIds", "bankIds", "executiveIds", "branchIds"],
    payload: ["leadId", "caseId", "status", "previousStatus", "lead"],
  }),
  [REALTIME_EVENTS.LEAD_REMARK_ADDED]: eventDefinition({
    eventType: REALTIME_EVENTS.LEAD_REMARK_ADDED,
    module: "workflow",
    description: "A status remark or workflow note was added.",
    roles: ROLE_GROUPS.assignedExecutive,
    scopes: ["dealershipIds", "bankIds", "executiveIds", "branchIds"],
    payload: ["leadId", "caseId", "remarkType"],
  }),
  [REALTIME_EVENTS.DOCUMENT_UPLOADED]: eventDefinition({
    eventType: REALTIME_EVENTS.DOCUMENT_UPLOADED,
    module: "documents",
    description: "A customer or bank document was uploaded.",
    roles: ROLE_GROUPS.assignedExecutive,
    scopes: ["dealershipIds", "bankIds", "executiveIds", "branchIds"],
    payload: ["leadId", "caseId", "document"],
  }),
  [REALTIME_EVENTS.DOCUMENT_REQUESTED]: eventDefinition({
    eventType: REALTIME_EVENTS.DOCUMENT_REQUESTED,
    module: "documents",
    description: "A bank or executive requested pending documents.",
    roles: ROLE_GROUPS.assignedExecutive,
    scopes: ["dealershipIds", "bankIds", "executiveIds", "branchIds"],
    payload: ["leadId", "caseId", "documentStatus", "lead"],
  }),
  [REALTIME_EVENTS.DEAD_CASE_CREATED]: eventDefinition({
    eventType: REALTIME_EVENTS.DEAD_CASE_CREATED,
    module: "dead-cases",
    description: "A lead moved from active workflow into dead cases.",
    roles: ROLE_GROUPS.assignedExecutive,
    scopes: ["dealershipIds", "bankIds", "executiveIds", "branchIds"],
    payload: ["leadId", "caseId", "deadCaseReason", "lead"],
    patches: ["remove-active-row", "add-dead-case-row", "counter"],
  }),
  [REALTIME_EVENTS.DEAD_CASE_RESTORED]: eventDefinition({
    eventType: REALTIME_EVENTS.DEAD_CASE_RESTORED,
    module: "dead-cases",
    description: "A lead was restored from dead cases to active workflow.",
    roles: ROLE_GROUPS.assignedExecutive,
    scopes: ["dealershipIds", "bankIds", "executiveIds", "branchIds"],
    payload: ["leadId", "caseId", "lead"],
    patches: ["remove-dead-case-row", "add-active-row", "counter"],
  }),
  [REALTIME_EVENTS.DEAD_CASE_UPDATED]: eventDefinition({
    eventType: REALTIME_EVENTS.DEAD_CASE_UPDATED,
    module: "dead-cases",
    description: "Dead case reason or notes changed.",
    roles: ROLE_GROUPS.assignedExecutive,
    scopes: ["dealershipIds", "bankIds", "executiveIds", "branchIds"],
    payload: ["leadId", "caseId", "lead"],
    patches: ["table-row", "detail"],
  }),
  [REALTIME_EVENTS.NOTIFICATION_CREATED]: eventDefinition({
    eventType: REALTIME_EVENTS.NOTIFICATION_CREATED,
    module: "notifications",
    description: "A notification was created for an affected user or tenant.",
    roles: ROLE_GROUPS.notification,
    scopes: ["dealershipIds", "bankIds", "executiveIds", "recipientIds"],
    payload: ["notification", "leadId", "caseId"],
    patches: ["notification-list", "unread-counter", "toast"],
  }),
  [REALTIME_EVENTS.PAYMENT_UPDATED]: eventDefinition({
    eventType: REALTIME_EVENTS.PAYMENT_UPDATED,
    module: "billing",
    description: "Payment status changed.",
    roles: ROLE_GROUPS.dealership,
    scopes: ["dealershipIds", "recipientIds"],
    payload: ["dealershipId", "paymentStatus"],
    patches: ["billing-summary", "counter"],
  }),
  [REALTIME_EVENTS.SUBSCRIPTION_UPDATED]: eventDefinition({
    eventType: REALTIME_EVENTS.SUBSCRIPTION_UPDATED,
    module: "billing",
    description: "A dealership subscription state changed.",
    roles: ROLE_GROUPS.dealership,
    scopes: ["dealershipIds", "recipientIds"],
    payload: ["dealershipId", "subscriptionStatus"],
    patches: ["billing-summary", "dashboard-access"],
  }),
  [REALTIME_EVENTS.USER_APPROVED]: eventDefinition({
    eventType: REALTIME_EVENTS.USER_APPROVED,
    module: "approvals",
    description: "A portal user was approved.",
    roles: ROLE_GROUPS.allPlatform,
    scopes: ["recipientIds"],
    payload: ["recipientId", "role"],
    patches: ["approval-row", "counter"],
  }),
  [REALTIME_EVENTS.USER_REJECTED]: eventDefinition({
    eventType: REALTIME_EVENTS.USER_REJECTED,
    module: "approvals",
    description: "A portal user was rejected.",
    roles: ROLE_GROUPS.allPlatform,
    scopes: ["recipientIds"],
    payload: ["recipientId", "role"],
    patches: ["approval-row", "counter"],
  }),
  [REALTIME_EVENTS.GM_APPROVED]: eventDefinition({
    eventType: REALTIME_EVENTS.GM_APPROVED,
    module: "approvals",
    description: "A dealership GM account was approved.",
    roles: ROLE_GROUPS.dealership,
    scopes: ["dealershipIds", "recipientIds"],
    payload: ["dealershipId", "recipientId"],
    patches: ["staff-row", "counter"],
  }),
  [REALTIME_EVENTS.FINANCE_APPROVED]: eventDefinition({
    eventType: REALTIME_EVENTS.FINANCE_APPROVED,
    module: "approvals",
    description: "A finance account was approved.",
    roles: ROLE_GROUPS.dealership,
    scopes: ["dealershipIds", "recipientIds"],
    payload: ["dealershipId", "recipientId"],
    patches: ["staff-row", "counter"],
  }),
});

function defaultEventDefinition(eventType = "") {
  const module = eventType.includes("BANK") || eventType.includes("BRANCH")
    ? "bank"
    : eventType.includes("DEALER")
      ? "dealership"
      : eventType.includes("SUBSCRIPTION") || eventType.includes("PAYMENT")
        ? "billing"
        : eventType.includes("STAFF") || eventType.includes("SALESPERSON") || eventType.includes("FINANCE_MANAGER")
          ? "staff"
          : "workflow";
  const roles = module === "bank"
    ? ROLE_GROUPS.bank
    : module === "dealership" || module === "billing" || module === "staff"
      ? ROLE_GROUPS.dealership
      : ROLE_GROUPS.assignedExecutive;
  const scopes = module === "bank"
    ? ["bankIds", "branchIds", "recipientIds"]
    : module === "dealership" || module === "billing" || module === "staff"
      ? ["dealershipIds", "recipientIds"]
      : ["dealershipIds", "bankIds", "executiveIds", "branchIds"];
  return eventDefinition({
    eventType,
    module,
    description: `${eventType.replaceAll("_", " ").toLowerCase()} realtime synchronization event.`,
    roles,
    scopes,
    payload: ["eventType", "timestamp", "data"],
  });
}

export const REALTIME_EVENT_REGISTRY = Object.freeze(Object.fromEntries(
  [...new Set(Object.values(REALTIME_EVENTS))]
    .map((eventType) => [eventType, DETAILED_REALTIME_EVENT_REGISTRY[eventType] || defaultEventDefinition(eventType)]),
));

export function realtimeEventDefinition(eventType = "") {
  return REALTIME_EVENT_REGISTRY[eventType] || eventDefinition({
    eventType: eventType || "UNKNOWN",
    module: "platform",
    description: "Unregistered platform realtime event.",
    roles: ROLE_GROUPS.allPlatform,
    scopes: ["recipientIds"],
    payload: [],
  });
}

export function realtimeEventRegistryReport() {
  return Object.values(REALTIME_EVENT_REGISTRY).map((item) => ({
    eventType: item.eventType,
    module: item.module,
    description: item.description,
    roles: item.roles,
    scopes: item.scopes,
    payload: item.payload,
    patches: item.patches,
  }));
}

export function realtimeRoleDeliveryMatrix() {
  return Object.values(REALTIME_EVENT_REGISTRY).reduce((matrix, item) => {
    item.roles.forEach((role) => {
      matrix[role] = matrix[role] || [];
      matrix[role].push(item.eventType);
    });
    return matrix;
  }, {});
}
