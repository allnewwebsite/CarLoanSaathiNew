import { createNotification } from "./notification.service.js";
import { getRecord, queryRecords, updateRecord, upsertRecord } from "./firestore.service.js";
import { reassignLeadToNextBranchExecutive } from "./assignment.service.js";
import { AUDIT_ACTIONS, writeAuditLog, writeAuditLogOnce } from "./audit.service.js";
import { ALERT_SEVERITY, emitOperationalAlert, recordOperationalEvent } from "./observability.service.js";
import { syncLeadProjection } from "./projection.service.js";
import { publishRealtimeEvent, REALTIME_EVENTS } from "./realtime.service.js";
import { logInfo, logWarn } from "./logger.service.js";
import { safeDocId, scopeId } from "./projectionShared.service.js";

export const REQUIRED_ASSIGNMENT_FIELDS = Object.freeze([
  "assignedBankId",
  "assignedBankName",
  "assignedExecutiveId",
  "assignedExecutiveEmail",
  "assignedExecutiveMobile",
  "assignedExecutiveName",
  "dealershipId",
  "financeManagerId",
]);

const ASSIGNMENT_FIELD_ALIASES = Object.freeze({
  assignedBankId: ["assignedBankId", "bankId", "assignedPartnerId"],
  assignedBankName: ["assignedBankName", "assignedBank", "bankName", "bankPartner", "selectedBankName"],
  assignedExecutiveId: ["assignedExecutiveId", "loanExecutiveId", "executiveId", "assignedExecutiveEmail", "assignedExecutiveMobile", "executiveMobile"],
  assignedExecutiveEmail: ["assignedExecutiveEmail", "executiveEmail"],
  assignedExecutiveMobile: ["assignedExecutiveMobile", "executiveMobile"],
  assignedExecutiveName: ["assignedExecutiveName", "assignedExecutive", "loanExecutiveName", "executiveName"],
  dealershipId: ["dealershipId", "dealershipEmail", "dealerEmail", "createdBy"],
  financeManagerId: ["financeManagerId", "financeManagerEmployeeId", "financeManagerEmail", "financeManager", "assignedFinanceManager"],
});

function hasValue(value) {
  return String(value ?? "").trim().length > 0;
}

function firstValue(lead = {}, fields = []) {
  for (const field of fields) {
    if (hasValue(lead[field])) return lead[field];
  }
  return "";
}

function assignmentFieldHasValue(lead = {}, field) {
  return hasValue(firstValue(lead, ASSIGNMENT_FIELD_ALIASES[field] || [field]));
}

function canonicalAssignmentPatch(lead = {}) {
  const patch = {};
  const exactAliases = {
    assignedBankId: ["bankId", "assignedPartnerId"],
    assignedBankName: ["assignedBank", "bankName", "bankPartner", "selectedBankName"],
    assignedExecutiveEmail: ["executiveEmail"],
    assignedExecutiveMobile: ["executiveMobile"],
    assignedExecutiveName: ["assignedExecutive", "loanExecutiveName", "executiveName"],
    dealershipId: ["dealershipEmail", "dealerEmail", "createdBy"],
  };
  for (const [field, aliases] of Object.entries(exactAliases)) {
    if (!hasValue(lead[field])) {
      const value = firstValue(lead, aliases);
      if (hasValue(value)) patch[field] = value;
    }
  }
  return patch;
}

function assignmentErrorId(lead = {}) {
  return safeDocId(`assignment_error_${lead.id || lead.caseId || Date.now()}`);
}

export function missingRequiredAssignmentFields(lead = {}) {
  return REQUIRED_ASSIGNMENT_FIELDS.filter((field) => !assignmentFieldHasValue(lead, field));
}

export function expectedLeadProjectionTargets(lead = {}) {
  if (!lead?.id) return [];
  const targets = [{ collection: "adminViews", docId: safeDocId(`lead_${lead.id}`), scopeType: "admin", scopeId: "global" }];
  const dealershipId = scopeId(lead.dealershipId || lead.dealershipEmail || lead.dealerEmail);
  if (dealershipId) {
    targets.push({ collection: "financeViews", docId: safeDocId(`lead_${lead.id}`), scopeType: "dealership", scopeId: dealershipId });
    targets.push({ collection: "gmViews", docId: safeDocId(`lead_${lead.id}`), scopeType: "dealership", scopeId: dealershipId });
  }
  const bankId = scopeId(lead.bankId || lead.assignedBankId || lead.assignedPartnerId);
  if (bankId) targets.push({ collection: "bankViews", docId: safeDocId(`lead_${lead.id}`), scopeType: "bank", scopeId: bankId });
  [lead.assignedExecutiveId, lead.assignedExecutiveEmail, lead.assignedExecutiveMobile, lead.executiveMobile]
    .map(scopeId)
    .filter(Boolean)
    .forEach((executiveScope) => {
      targets.push({ collection: "executiveViews", docId: safeDocId(`lead_${lead.id}_${executiveScope}`), scopeType: "executive", scopeId: executiveScope });
    });
  targets.push({ collection: "leadDetailsProjection", docId: safeDocId(lead.id), scopeType: "detail", scopeId: lead.id });
  return targets;
}

async function missingProjectionTargets(lead = {}) {
  const targets = expectedLeadProjectionTargets(lead);
  const checks = await Promise.all(targets.map(async (target) => ({
    ...target,
    exists: Boolean(await getRecord(target.collection, target.docId).catch(() => null)),
  })));
  return checks.filter((item) => !item.exists);
}

async function assignmentNotificationExists(lead = {}) {
  if (!lead?.id) return false;
  const page = await queryRecords("notifications", {
    where: [{ field: "leadId", value: lead.id }],
    orderBy: "createdAt",
    direction: "desc",
    limit: 10,
    maxLimit: 10,
  }).catch(() => ({ data: [] }));
  return page.data.some((item) => [
    "executive-assigned",
    "executive-reassigned",
    "lead-assigned",
    "assignment-integrity-repaired",
  ].includes(item.type || item.notificationType));
}

async function notifyFinanceDeskOfAssignmentIssue(lead = {}, issues = []) {
  const dealershipId = lead.dealershipId || lead.dealershipEmail || lead.dealerEmail || null;
  if (!dealershipId) return null;
  return createNotification({
    type: "assignment-error",
    title: "Assignment needs attention",
    message: `Lead ${lead.caseId || lead.id} needs assignment repair.`,
    leadId: lead.id,
    dealerEmail: dealershipId,
    recipientRole: "finance-desk",
    priority: "high",
    dealershipId,
    bankId: lead.assignedBankId || lead.bankId || null,
    assignedExecutiveId: lead.assignedExecutiveId || null,
    meta: {
      caseId: lead.caseId,
      issues,
      missingFields: missingRequiredAssignmentFields(lead),
    },
    leadSnapshot: lead,
  });
}

async function createAssignmentNotification(lead = {}) {
  if (!lead.assignedExecutiveId && !lead.assignedExecutiveEmail) return null;
  return createNotification({
    type: "assignment-integrity-repaired",
    title: "Lead assignment restored",
    message: `Lead ${lead.caseId || lead.id} is assigned to you.`,
    leadId: lead.id,
    recipientRole: "loan-executive",
    recipientId: lead.assignedExecutiveId || lead.assignedExecutiveEmail,
    phoneNumber: lead.assignedExecutiveMobile || lead.executiveMobile || null,
    priority: "high",
    dealershipId: lead.dealershipId || null,
    bankId: lead.assignedBankId || lead.bankId || null,
    assignedExecutiveId: lead.assignedExecutiveId || null,
    meta: {
      caseId: lead.caseId,
      customerName: lead.fullName || lead.customerName,
      assignedExecutiveId: lead.assignedExecutiveId,
      assignedExecutiveEmail: lead.assignedExecutiveEmail,
      assignedExecutiveMobile: lead.assignedExecutiveMobile,
    },
    leadSnapshot: lead,
  });
}

async function queueAssignmentError(lead = {}, issues = [], { source = "assignment-integrity" } = {}) {
  const now = new Date().toISOString();
  const id = assignmentErrorId(lead);
  const missingFields = missingRequiredAssignmentFields(lead);
  const record = await upsertRecord("assignmentErrorQueue", id, {
    id,
    leadId: lead.id || null,
    caseId: lead.caseId || null,
    status: "open",
    source,
    severity: missingFields.some((field) => field.startsWith("assignedExecutive")) ? "critical" : "high",
    issues,
    missingFields,
    dealershipId: lead.dealershipId || null,
    bankId: lead.assignedBankId || lead.bankId || null,
    assignedExecutiveId: lead.assignedExecutiveId || null,
    lastCheckedAt: now,
    createdAt: now,
  });
  await Promise.all([
    writeAuditLogOnce(`orphan:${lead.id || lead.caseId}`, {
      actionType: missingFields.length ? AUDIT_ACTIONS.ORPHAN_LEAD_DETECTED : AUDIT_ACTIONS.ASSIGNMENT_FAILURE,
      actorId: "assignment-integrity",
      actorRole: "system",
      leadId: lead.id || null,
      targetEntity: "lead",
      targetId: lead.id || null,
      meta: { caseId: lead.caseId, issues, missingFields, source },
    }).catch(() => null),
    recordOperationalEvent({
      type: "assignment_integrity_issue",
      severity: ALERT_SEVERITY.HIGH,
      component: "assignment",
      message: "Lead assignment integrity issue detected",
      entityId: lead.id || lead.caseId || null,
      meta: { caseId: lead.caseId, issues, missingFields, source },
    }).catch(() => null),
    emitOperationalAlert({
      type: "assignment_integrity_issue",
      severity: ALERT_SEVERITY.HIGH,
      component: "assignment",
      title: "Lead assignment integrity issue",
      message: `Lead ${lead.caseId || lead.id} has broken assignment fields.`,
      entityId: lead.id || lead.caseId || null,
      meta: { issues, missingFields },
    }).catch(() => null),
    notifyFinanceDeskOfAssignmentIssue(lead, issues).catch(() => null),
  ]);
  return record;
}

async function resolveAssignmentError(lead = {}) {
  const id = assignmentErrorId(lead);
  const existing = await getRecord("assignmentErrorQueue", id).catch(() => null);
  if (!existing || existing.status === "resolved") return null;
  return updateRecord("assignmentErrorQueue", id, {
    status: "resolved",
    resolvedAt: new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
  }).catch(() => null);
}

export async function validateLeadAssignmentIntegrity(lead = {}, { repair = false, source = "assignment-integrity" } = {}) {
  const issues = [];
  let workingLead = lead;
  let repaired = false;
  if (repair && workingLead.id) {
    const patch = canonicalAssignmentPatch(workingLead);
    if (Object.keys(patch).length) {
      await updateRecord("leads", workingLead.id, patch);
      workingLead = { ...workingLead, ...patch };
      repaired = true;
      issues.push({ type: "canonical_assignment_fields_repaired", fields: Object.keys(patch) });
      await writeAuditLog({
        actionType: AUDIT_ACTIONS.ASSIGNMENT_REPAIRED,
        actorId: source,
        actorRole: "system",
        leadId: workingLead.id,
        meta: { caseId: workingLead.caseId, repair: "canonical_assignment_fields", fields: Object.keys(patch) },
      });
    }
  }
  const missingFields = missingRequiredAssignmentFields(workingLead);
  if (missingFields.length) {
    issues.push({ type: "missing_assignment_fields", fields: missingFields });
  }

  const missingExecutive = missingFields.some((field) => field.startsWith("assignedExecutive"));
  const hasBankScope = hasValue(workingLead.assignedBankId || workingLead.bankId || workingLead.assignedPartnerId);
  if (repair && missingExecutive && hasBankScope && workingLead.id) {
    try {
      workingLead = await reassignLeadToNextBranchExecutive(workingLead.id, "assignment-integrity-repair", source);
      repaired = true;
      issues.push({ type: "executive_assignment_repaired" });
      await writeAuditLog({
        actionType: AUDIT_ACTIONS.ASSIGNMENT_REPAIRED,
        actorId: source,
        actorRole: "system",
        leadId: workingLead.id,
        meta: { caseId: workingLead.caseId, repair: "executive_assignment" },
      });
    } catch (error) {
      issues.push({ type: "executive_assignment_repair_failed", reason: error.message });
    }
  }

  const postRepairMissingFields = missingRequiredAssignmentFields(workingLead);
  const projectionMisses = await missingProjectionTargets(workingLead).catch(() => []);
  if (projectionMisses.length) {
    issues.push({ type: "missing_projection_targets", targets: projectionMisses.map((item) => `${item.collection}/${item.docId}`) });
    if (repair) {
      await syncLeadProjection(workingLead);
      repaired = true;
      await writeAuditLog({
        actionType: AUDIT_ACTIONS.PROJECTION_REPAIRED,
        actorId: source,
        actorRole: "system",
        leadId: workingLead.id,
        meta: { caseId: workingLead.caseId, repairedTargets: projectionMisses.length },
      });
    }
  }

  const notificationExists = await assignmentNotificationExists(workingLead);
  if (!notificationExists && !postRepairMissingFields.length) {
    issues.push({ type: "missing_assignment_notification" });
    if (repair) {
      await createAssignmentNotification(workingLead);
      repaired = true;
    }
  }

  if (postRepairMissingFields.length) {
    await queueAssignmentError(workingLead, issues, { source });
  } else {
    await resolveAssignmentError(workingLead);
  }

  if (repaired && workingLead?.id) {
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.EXECUTIVE_ASSIGNED,
      lead: workingLead,
      actor: { email: source, role: "system" },
      data: {
        leadId: workingLead.id,
        caseId: workingLead.caseId,
        dealershipId: workingLead.dealershipId,
        bankId: workingLead.assignedBankId || workingLead.bankId,
        executiveId: workingLead.assignedExecutiveId || workingLead.assignedExecutiveEmail,
        recipientId: workingLead.assignedExecutiveId || workingLead.assignedExecutiveEmail,
      },
    });
  }

  return {
    leadId: workingLead.id || lead.id || null,
    caseId: workingLead.caseId || lead.caseId || null,
    valid: !postRepairMissingFields.length,
    repaired,
    missingFields: postRepairMissingFields,
    issues,
  };
}

export async function validateRecentLeadDistribution({ limit = 100, repair = true, source = "assignment-integrity-job" } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 100);
  const page = await queryRecords("leads", {
    orderBy: "createdAt",
    direction: "desc",
    limit: safeLimit,
    maxLimit: 100,
    allowGlobal: true,
  });
  const rows = Array.isArray(page.data) ? page.data : [];
  const results = [];
  for (const lead of rows) {
    // Keep this sequential to avoid a thundering herd of projection repair writes.
    // eslint-disable-next-line no-await-in-loop
    results.push(await validateLeadAssignmentIntegrity(lead, { repair, source }));
  }
  const summary = {
    checked: rows.length,
    valid: results.filter((item) => item.valid).length,
    invalid: results.filter((item) => !item.valid).length,
    repaired: results.filter((item) => item.repaired).length,
    openErrors: results.filter((item) => item.missingFields.length).map((item) => ({ leadId: item.leadId, caseId: item.caseId, missingFields: item.missingFields })),
    generatedAt: new Date().toISOString(),
  };
  logInfo("Assignment integrity validation completed", summary);
  return summary;
}

export async function recordLeadAssignmentFailure(lead = {}, error, { source = "lead-assignment" } = {}) {
  const reason = error?.message || String(error || "assignment failed");
  logWarn("Lead assignment failure queued", { leadId: lead.id, caseId: lead.caseId, reason });
  return queueAssignmentError(lead, [{ type: "assignment_failure", reason }], { source });
}
