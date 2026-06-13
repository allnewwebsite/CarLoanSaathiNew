import { getRecord, incrementRecord, queryRecords, upsertRecord } from "./firestore.service.js";
import { logWarn } from "./logger.service.js";
import { DOMAIN_EVENTS, emitDomainEvent, onDomainEvent } from "./eventBus.service.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";
import { addQueueJob, QUEUE_NAMES } from "./queue.service.js";

export const ANALYTICS_EVENTS = Object.freeze({
  LEAD_CREATED: "analytics.lead-created",
  STATUS_CHANGED: "analytics.status-changed",
  LEAD_ASSIGNED: "analytics.lead-assigned",
});

const zeroMetrics = {
  totalLeads: 0,
  pendingLeads: 0,
  disbursedLeads: 0,
  rejectedLeads: 0,
  pendingDocuments: 0,
  bankProcess: 0,
  assignedLeads: 0,
  completedLeads: 0,
  processingTimeTotalMinutes: 0,
  activeDealerships: 0,
  bankPartners: 0,
  activeBanks: 0,
};

function dayKey(value = new Date().toISOString()) {
  return String(value).slice(0, 10);
}

function monthKey(value = new Date().toISOString()) {
  return String(value).slice(0, 7);
}

function statusField(status) {
  const normalized = normalizeStatus(status);
  if (normalized === LEAD_STATUSES.DISBURSED || normalized === LEAD_STATUSES.CLOSED) return "disbursedLeads";
  if (normalized === LEAD_STATUSES.REJECTED) return "rejectedLeads";
  if ([LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING].includes(normalized)) return "pendingDocuments";
  if ([LEAD_STATUSES.CONTACTED, LEAD_STATUSES.ALL_DOCUMENTS_RECEIVED, LEAD_STATUSES.UNDER_BANK_PROCESS, LEAD_STATUSES.ASSIGNED, LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW, LEAD_STATUSES.APPROVED].includes(normalized)) return "bankProcess";
  return "pendingLeads";
}

function metricTargets(lead = {}) {
  const createdAt = lead.createdAt || new Date().toISOString();
  const targets = [
    { collection: "metrics", id: "global", scopeType: "global", scopeId: "global" },
    { collection: "dailyMetrics", id: `global:${dayKey(createdAt)}`, scopeType: "global", scopeId: "global", period: dayKey(createdAt) },
    { collection: "monthlyMetrics", id: `global:${monthKey(createdAt)}`, scopeType: "global", scopeId: "global", period: monthKey(createdAt) },
  ];
  if (lead.dealershipId) targets.push({ collection: "dealershipMetrics", id: lead.dealershipId, scopeType: "dealership", scopeId: lead.dealershipId });
  if (lead.bankId) targets.push({ collection: "bankMetrics", id: lead.bankId, scopeType: "bank", scopeId: lead.bankId });
  if (lead.assignedExecutiveId) targets.push({ collection: "executiveMetrics", id: lead.assignedExecutiveId, scopeType: "executive", scopeId: lead.assignedExecutiveId });
  return targets;
}

function activeMetricTargets(lead = {}) {
  return metricTargets(lead).filter((target) => !["dailyMetrics", "monthlyMetrics"].includes(target.collection));
}

function processingTimeMinutes(lead = {}) {
  const completedAt = lead.statusUpdatedAt || lead.updatedAt;
  if (!lead.createdAt || !completedAt) return 0;
  return Math.max(Math.round((new Date(completedAt) - new Date(lead.createdAt)) / 60000), 0);
}

async function incrementMetricTargets(lead, increments) {
  const baseTime = new Date().toISOString();
  await Promise.all(metricTargets(lead).map((target) => incrementRecord(target.collection, target.id, increments, {
    ...zeroMetrics,
    scopeType: target.scopeType,
    scopeId: target.scopeId,
    period: target.period || null,
    lastEventAt: baseTime,
  })));
}

export function queueAnalyticsEvent(type, payload = {}) {
  const jobType = type === ANALYTICS_EVENTS.LEAD_CREATED
    ? "lead-created"
    : type === ANALYTICS_EVENTS.STATUS_CHANGED
      ? "status-changed"
      : "lead-assigned";
  return addQueueJob(QUEUE_NAMES.METRICS, jobType, { ...payload, type: jobType }, {
    priority: "medium",
    fallback: () => emitDomainEvent(type, payload),
  });
}

export async function applyLeadCreatedMetrics(lead) {
  const field = statusField(lead.status);
  await incrementMetricTargets(lead, {
    totalLeads: 1,
    [field]: 1,
  });
}

export async function applyStatusChangedMetrics({ lead, previousStatus, nextStatus, processingTimeMinutes = 0 }) {
  const previousField = statusField(previousStatus);
  const nextField = statusField(nextStatus);
  const increments = {};
  if (previousField !== nextField) {
    increments[previousField] = -1;
    increments[nextField] = 1;
  }
  const normalizedNext = normalizeStatus(nextStatus);
  if ([LEAD_STATUSES.DISBURSED, LEAD_STATUSES.REJECTED, LEAD_STATUSES.CLOSED].includes(normalizedNext)) {
    increments.completedLeads = 1;
    increments.processingTimeTotalMinutes = Number(processingTimeMinutes || 0);
  }
  if (Object.keys(increments).length) await incrementMetricTargets(lead, increments);
}

export async function applyLeadAssignedMetrics(lead) {
  await incrementMetricTargets(lead, { assignedLeads: 1 });
}

export async function applyLeadArchivedMetrics(lead) {
  const field = statusField(lead.status);
  const increments = {
    totalLeads: -1,
    [field]: -1,
    completedLeads: -1,
    processingTimeTotalMinutes: -processingTimeMinutes(lead),
  };
  if (lead.assignedExecutiveId) increments.assignedLeads = -1;
  await Promise.all(activeMetricTargets(lead).map((target) => incrementRecord(target.collection, target.id, increments, {
    ...zeroMetrics,
    scopeType: target.scopeType,
    scopeId: target.scopeId,
    period: target.period || null,
    lastEventAt: new Date().toISOString(),
  })));
}

export function decorateMetric(record = {}) {
  const metrics = { ...zeroMetrics, ...record };
  return {
    ...metrics,
    approvalRatio: metrics.totalLeads ? Math.round(((metrics.disbursedLeads + Number(metrics.approvedLeads || 0)) / metrics.totalLeads) * 100) : 0,
    rejectionRatio: metrics.totalLeads ? Math.round((metrics.rejectedLeads / metrics.totalLeads) * 100) : 0,
    averageProcessingTime: metrics.completedLeads ? Math.round(metrics.processingTimeTotalMinutes / metrics.completedLeads) : 0,
  };
}

export async function getMetric(collection, id) {
  return decorateMetric(await getRecord(collection, id) || { id });
}

export async function getGlobalMetrics() {
  return getMetric("metrics", "global");
}

export async function getTrendMetrics({ collection = "dailyMetrics", limit = 30, scopeType = "global", scopeId = "global" } = {}) {
  const result = await queryRecords(collection, {
    where: [{ field: "scopeType", value: scopeType }, { field: "scopeId", value: scopeId }],
    orderBy: "period",
    direction: "desc",
    limit,
    maxLimit: 366,
  });
  return result.data.map(decorateMetric).reverse();
}

export async function getLeaderboardMetrics({ collection, limit = 20, orderBy = "totalLeads" } = {}) {
  const result = await queryRecords(collection, {
    orderBy,
    direction: "desc",
    limit,
    maxLimit: 100,
  });
  return result.data.map(decorateMetric);
}

onDomainEvent(ANALYTICS_EVENTS.LEAD_CREATED, async ({ payload }) => {
  await applyLeadCreatedMetrics(payload.lead);
});

onDomainEvent(ANALYTICS_EVENTS.STATUS_CHANGED, async ({ payload }) => {
  await applyStatusChangedMetrics(payload);
});

onDomainEvent(ANALYTICS_EVENTS.LEAD_ASSIGNED, async ({ payload }) => {
  await applyLeadAssignedMetrics(payload.lead);
});

export function queueSafeAnalyticsEvent(type, payload = {}) {
  try {
    queueAnalyticsEvent(type, payload);
  } catch (error) {
    logWarn("Analytics event queue failed", { type, error: error.message });
  }
}
