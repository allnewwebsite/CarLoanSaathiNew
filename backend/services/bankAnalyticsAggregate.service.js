import crypto from "node:crypto";
import { bulkUpsertRecords, getRecord, queryRecords, runRecordTransaction } from "./firestore.service.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";

const ACTIVE_STATUSES = new Set([
  LEAD_STATUSES.NEW,
  LEAD_STATUSES.CONTACTED,
  LEAD_STATUSES.REQUEST_DOCUMENT,
  LEAD_STATUSES.DOCUMENT_RECEIVED,
  LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS,
  LEAD_STATUSES.ALL_DOCUMENTS_RECEIVED,
  LEAD_STATUSES.UNDER_BANK_PROCESS,
  LEAD_STATUSES.ASSIGNED,
  LEAD_STATUSES.ACCEPTED,
  LEAD_STATUSES.UNDER_REVIEW,
  LEAD_STATUSES.DOCS_PENDING,
]);

const PENDING_DOCUMENT_STATUSES = new Set([
  LEAD_STATUSES.REQUEST_DOCUMENT,
  LEAD_STATUSES.DOCUMENT_RECEIVED,
  LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS,
  LEAD_STATUSES.DOCS_PENDING,
]);

const COUNTER_FIELDS = [
  "assignedLeads",
  "activeLeads",
  "approvedLeads",
  "disbursedLeads",
  "rejectedLeads",
  "pendingDocuments",
  "disbursedAmount",
];

function text(value) {
  return String(value || "").trim();
}

function normalizedKey(value) {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

function documentId(...parts) {
  const raw = parts.map(normalizedKey).filter(Boolean).join("|");
  return crypto.createHash("sha256").update(raw || "unknown").digest("hex");
}

function bankIdForLead(lead = {}) {
  return text(
    lead.bankId
      || lead.assignedBankId
      || lead.assignedPartnerId
      || lead.assignedBankIfsc
      || lead.bankIfsc
      || lead.ifscCode,
  );
}

function branchLabelForLead(lead = {}) {
  return text(
    lead.bankBranchCity
      || lead.branchCity
      || lead.branchLocation
      || lead.bankBranchLocation
      || lead.routingCity
      || lead.assignedBankIfsc
      || lead.bankIfsc
      || lead.ifscCode
      || lead.branchId
      || "Unassigned Branch",
  );
}

function branchKeyForLead(lead = {}) {
  return text(
    lead.assignedBankIfsc
      || lead.bankIfsc
      || lead.ifscCode
      || lead.branchId
      || branchLabelForLead(lead),
  );
}

function executiveIdForLead(lead = {}) {
  return text(lead.assignedExecutiveId || lead.assignedExecutiveEmail || lead.assignedExecutiveName);
}

function contributionForLead(lead = {}) {
  if (lead.isDeadCase === true) return null;
  const bankId = bankIdForLead(lead);
  if (!bankId) return null;
  const status = normalizeStatus(lead.status || lead.assignmentStatus);
  const branchKey = branchKeyForLead(lead);
  const branch = branchLabelForLead(lead);
  const executiveId = executiveIdForLead(lead);
  const activityAt = text(lead.statusUpdatedAt || lead.reassignedAt || lead.updatedAt || lead.assignmentTimestamp || lead.createdAt);
  return {
    leadId: lead.id,
    caseId: lead.caseId || lead.id,
    bankId,
    bankName: text(lead.assignedBankName || lead.bankName || lead.selectedBankName || lead.bankPartner),
    branchKey,
    branch,
    scopeId: bankAnalyticsScopeId(bankId, branchKey),
    executiveId,
    executiveName: text(lead.assignedExecutiveName || lead.assignedExecutiveEmail || lead.assignedExecutiveId || "Unassigned"),
    executiveMobile: text(lead.assignedExecutiveMobile || lead.executiveMobile),
    customerName: text(lead.fullName || lead.customerName),
    status,
    activityAt,
    assignedLeads: 1,
    activeLeads: ACTIVE_STATUSES.has(status) ? 1 : 0,
    approvedLeads: [LEAD_STATUSES.APPROVED, LEAD_STATUSES.DISBURSED].includes(status) ? 1 : 0,
    disbursedLeads: status === LEAD_STATUSES.DISBURSED ? 1 : 0,
    rejectedLeads: status === LEAD_STATUSES.REJECTED ? 1 : 0,
    pendingDocuments: PENDING_DOCUMENT_STATUSES.has(status) ? 1 : 0,
    disbursedAmount: status === LEAD_STATUSES.DISBURSED
      ? Number(lead.disbursedAmount || lead.loanAmount || lead.requiredLoanAmount || 0)
      : 0,
  };
}

function emptyCounters() {
  return Object.fromEntries(COUNTER_FIELDS.map((field) => [field, 0]));
}

function applyContribution(record = {}, contribution, direction) {
  const next = { ...emptyCounters(), ...record };
  if (!contribution) return next;
  for (const field of COUNTER_FIELDS) {
    next[field] = Math.max(0, Number(next[field] || 0) + (Number(contribution[field] || 0) * direction));
  }
  return next;
}

function summaryId(scopeId) {
  return documentId("bank-summary", scopeId);
}

function executiveMetricId(scopeId, executiveId) {
  return documentId("bank-executive", scopeId, executiveId);
}

function recentCaseId(leadId) {
  return documentId("bank-recent-case", leadId);
}

function stateRecord(contribution, updatedAt, runId = null) {
  const id = documentId("bank-analytics-lead", contribution.leadId);
  return {
    id,
    leadId: contribution.leadId,
    contribution,
    rebuildRunId: runId,
    updatedAt,
  };
}

export function bankAnalyticsScopeId(bankId, branchKey) {
  return `${normalizedKey(bankId)}::${normalizedKey(branchKey || bankId)}`;
}

export function bankAnalyticsScopeCandidates(identity = {}) {
  const bankIds = [...new Set([
    identity.bankId,
    identity.bankIfsc,
  ].map(text).filter(Boolean))];
  const branches = [...new Set([
    identity.bankIfsc,
    identity.branchId,
    identity.bankLocation,
    identity.bankId,
  ].map(text).filter(Boolean))];
  return bankIds.flatMap((bankId) => branches.map((branch) => bankAnalyticsScopeId(bankId, branch)));
}

async function syncBankAnalyticsAggregateState(leadId, nextContribution) {
  if (!leadId) return null;
  const stateId = documentId("bank-analytics-lead", leadId);

  return runRecordTransaction(async (transaction) => {
    const previous = await transaction.get("bankAnalyticsLeadStates", stateId);
    const previousContribution = previous?.contribution || null;
    const summaryIds = [...new Set([
      previousContribution?.scopeId ? summaryId(previousContribution.scopeId) : null,
      nextContribution?.scopeId ? summaryId(nextContribution.scopeId) : null,
    ].filter(Boolean))];
    const executiveIds = [...new Set([
      previousContribution?.scopeId && previousContribution?.executiveId
        ? executiveMetricId(previousContribution.scopeId, previousContribution.executiveId)
        : null,
      nextContribution?.scopeId && nextContribution?.executiveId
        ? executiveMetricId(nextContribution.scopeId, nextContribution.executiveId)
        : null,
    ].filter(Boolean))];

    const summaries = new Map();
    const executives = new Map();
    const summarySources = new Map();
    const executiveSources = new Map();
    const executiveCountDeltas = new Map();
    for (const id of summaryIds) summaries.set(id, await transaction.get("bankAnalyticsSummaries", id));
    for (const id of executiveIds) executives.set(id, await transaction.get("bankExecutiveAnalytics", id));

    if (previousContribution?.scopeId) {
      const id = summaryId(previousContribution.scopeId);
      summaries.set(id, applyContribution(summaries.get(id), previousContribution, -1));
      summarySources.set(id, previousContribution);
      if (previousContribution.executiveId) {
        const executiveId = executiveMetricId(previousContribution.scopeId, previousContribution.executiveId);
        const previousMetric = executives.get(executiveId);
        const nextMetric = applyContribution(previousMetric, previousContribution, -1);
        executives.set(executiveId, nextMetric);
        executiveSources.set(executiveId, previousContribution);
        if (Number(previousMetric?.assignedLeads || 0) > 0 && Number(nextMetric.assignedLeads || 0) === 0) {
          executiveCountDeltas.set(previousContribution.scopeId, Number(executiveCountDeltas.get(previousContribution.scopeId) || 0) - 1);
        }
      }
    }
    if (nextContribution?.scopeId) {
      const id = summaryId(nextContribution.scopeId);
      summaries.set(id, applyContribution(summaries.get(id), nextContribution, 1));
      summarySources.set(id, nextContribution);
      if (nextContribution.executiveId) {
        const executiveId = executiveMetricId(nextContribution.scopeId, nextContribution.executiveId);
        const previousMetric = executives.get(executiveId);
        const nextMetric = applyContribution(previousMetric, nextContribution, 1);
        executives.set(executiveId, nextMetric);
        executiveSources.set(executiveId, nextContribution);
        if (Number(previousMetric?.assignedLeads || 0) === 0 && Number(nextMetric.assignedLeads || 0) > 0) {
          executiveCountDeltas.set(nextContribution.scopeId, Number(executiveCountDeltas.get(nextContribution.scopeId) || 0) + 1);
        }
      }
    }

    const updatedAt = new Date().toISOString();
    for (const [id, summary] of summaries.entries()) {
      const source = summarySources.get(id);
      transaction.set("bankAnalyticsSummaries", id, {
        ...summary,
        id,
        scopeId: source?.scopeId || summary.scopeId,
        bankId: source?.bankId || summary.bankId,
        bankName: source?.bankName || summary.bankName || "",
        branchKey: source?.branchKey || summary.branchKey,
        branch: source?.branch || summary.branch || "",
        executives: Math.max(0, Number(summary.executives || 0) + Number(executiveCountDeltas.get(source?.scopeId) || 0)),
        updatedAt,
      });
    }
    for (const [id, metric] of executives.entries()) {
      const source = executiveSources.get(id);
      transaction.set("bankExecutiveAnalytics", id, {
        ...metric,
        id,
        scopeId: source?.scopeId || metric.scopeId,
        bankId: source?.bankId || metric.bankId,
        branchKey: source?.branchKey || metric.branchKey,
        branch: source?.branch || metric.branch || "",
        executiveId: source?.executiveId || metric.executiveId,
        executiveName: source?.executiveName || metric.executiveName || "Executive",
        mobile: source?.executiveMobile || metric.mobile || "",
        updatedAt,
      });
    }

    if (nextContribution) {
      transaction.set("bankAnalyticsLeadStates", stateId, {
        id: stateId,
        leadId,
        contribution: nextContribution,
        updatedAt,
      });
      transaction.set("bankRecentCases", recentCaseId(leadId), {
        id: recentCaseId(leadId),
        leadId,
        caseId: nextContribution.caseId,
        scopeId: nextContribution.scopeId,
        bankId: nextContribution.bankId,
        customerName: nextContribution.customerName,
        status: nextContribution.status,
        executiveId: nextContribution.executiveId || null,
        executiveName: nextContribution.executiveName,
        branch: nextContribution.branch,
        activityAt: nextContribution.activityAt || updatedAt,
        updatedAt,
      });
    } else {
      transaction.delete("bankAnalyticsLeadStates", stateId);
      transaction.delete("bankRecentCases", recentCaseId(leadId));
    }
    return nextContribution;
  });
}

export async function syncBankAnalyticsAggregate(lead = {}) {
  if (!lead?.id) return null;
  return syncBankAnalyticsAggregateState(lead.id, contributionForLead(lead));
}

export async function removeBankAnalyticsAggregate(lead = {}) {
  if (!lead?.id) return null;
  return syncBankAnalyticsAggregateState(lead.id, null);
}

export async function getBankAnalyticsAggregate(identity = {}, {
  executiveLimit = 100,
  executiveCursor = null,
  executiveId = "",
} = {}) {
  const candidates = bankAnalyticsScopeCandidates(identity);
  let summary = null;
  for (const scopeId of candidates) {
    summary = await getRecord("bankAnalyticsSummaries", summaryId(scopeId)).catch(() => null);
    if (summary) break;
  }
  if (!summary) return null;

  const limit = Math.min(Math.max(Number(executiveLimit) || 100, 1), 100);
  const executiveMetric = executiveId
    ? await getRecord("bankExecutiveAnalytics", executiveMetricId(summary.scopeId, executiveId)).catch(() => null)
    : null;
  const [executives, recent] = await Promise.all([
    executiveId
      ? Promise.resolve({ data: executiveMetric ? [executiveMetric] : [], nextCursor: null })
      : queryRecords("bankExecutiveAnalytics", {
        where: [
          { field: "scopeId", value: summary.scopeId },
          { field: "assignedLeads", op: ">", value: 0 },
        ],
        orderBy: "assignedLeads",
        direction: "desc",
        limit,
        maxLimit: 100,
        cursor: executiveCursor,
      }),
    queryRecords("bankRecentCases", {
      where: [
        { field: "scopeId", value: summary.scopeId },
        ...(executiveId ? [{ field: "executiveId", value: executiveId }] : []),
      ],
      orderBy: "activityAt",
      direction: "desc",
      limit: 10,
      maxLimit: 10,
    }),
  ]);

  return {
    summary,
    executivePerformance: executives.data,
    executiveNextCursor: executives.nextCursor,
    recentCases: recent.data,
  };
}

export async function rebuildBankAnalyticsAggregates({
  batchSize = 500,
  dryRun = true,
  runId = `bank-analytics-${Date.now()}`,
} = {}) {
  const safeBatchSize = Math.min(Math.max(Number(batchSize) || 500, 1), 500);
  const summaries = new Map();
  const executives = new Map();
  const recentByScope = new Map();
  let cursor = null;
  let processed = 0;
  let stateWrites = 0;

  do {
    const page = await queryRecords("leads", {
      orderBy: "createdAt",
      direction: "asc",
      limit: safeBatchSize,
      maxLimit: safeBatchSize,
      cursor,
      allowGlobal: true,
    });
    const states = [];
    const updatedAt = new Date().toISOString();
    for (const lead of page.data) {
      const contribution = contributionForLead(lead);
      if (!contribution) continue;
      const summaryDocumentId = summaryId(contribution.scopeId);
      summaries.set(summaryDocumentId, {
        ...applyContribution(summaries.get(summaryDocumentId), contribution, 1),
        id: summaryDocumentId,
        scopeId: contribution.scopeId,
        bankId: contribution.bankId,
        bankName: contribution.bankName,
        branchKey: contribution.branchKey,
        branch: contribution.branch,
        rebuildRunId: runId,
        updatedAt,
      });
      if (contribution.executiveId) {
        const executiveDocumentId = executiveMetricId(contribution.scopeId, contribution.executiveId);
        const previousExecutive = executives.get(executiveDocumentId);
        executives.set(executiveDocumentId, {
          ...applyContribution(previousExecutive, contribution, 1),
          id: executiveDocumentId,
          scopeId: contribution.scopeId,
          bankId: contribution.bankId,
          branchKey: contribution.branchKey,
          branch: contribution.branch,
          executiveId: contribution.executiveId,
          executiveName: contribution.executiveName,
          mobile: contribution.executiveMobile,
          rebuildRunId: runId,
          updatedAt,
        });
        if (!previousExecutive) summaries.get(summaryDocumentId).executives = Number(summaries.get(summaryDocumentId).executives || 0) + 1;
      }
      const recent = recentByScope.get(contribution.scopeId) || [];
      recent.push({
        id: recentCaseId(contribution.leadId),
        leadId: contribution.leadId,
        caseId: contribution.caseId,
        scopeId: contribution.scopeId,
        bankId: contribution.bankId,
        customerName: contribution.customerName,
        status: contribution.status,
        executiveId: contribution.executiveId || null,
        executiveName: contribution.executiveName,
        branch: contribution.branch,
        activityAt: contribution.activityAt || updatedAt,
        rebuildRunId: runId,
        updatedAt,
      });
      recent.sort((left, right) => String(right.activityAt).localeCompare(String(left.activityAt)));
      recentByScope.set(contribution.scopeId, recent.slice(0, 10));
      states.push(stateRecord(contribution, updatedAt, runId));
      processed += 1;
    }
    if (!dryRun) stateWrites += await bulkUpsertRecords("bankAnalyticsLeadStates", states);
    cursor = page.nextCursor;
  } while (cursor);

  const recentCases = [...recentByScope.values()].flat();
  if (!dryRun) {
    await bulkUpsertRecords("bankAnalyticsSummaries", [...summaries.values()]);
    await bulkUpsertRecords("bankExecutiveAnalytics", [...executives.values()]);
    await bulkUpsertRecords("bankRecentCases", recentCases);
  }

  return {
    runId,
    dryRun,
    processed,
    summaryDocuments: summaries.size,
    executiveDocuments: executives.size,
    recentCaseDocuments: recentCases.length,
    stateWrites,
  };
}
