import { getRecord, queryRecords, upsertRecord } from "./firestore.service.js";
import { pageResponse, paginationParams } from "../utils/pagination.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";
import { logInfo, logWarn } from "./logger.service.js";

const VIEW_LEAD_FIELDS = [
  "id",
  "caseId",
  "fullName",
  "customerName",
  "mobile",
  "city",
  "carPrice",
  "carOnRoadPrice",
  "loanAmount",
  "requiredLoanAmount",
  "status",
  "createdAt",
  "updatedAt",
  "generatedAt",
  "statusUpdatedAt",
  "dealershipId",
  "dealershipEmail",
  "dealershipName",
  "dealershipCity",
  "dealerName",
  "dealerEmail",
  "dealerMobile",
  "salespersonId",
  "salespersonName",
  "salespersonJobId",
  "salespersonEmail",
  "assignedSalesperson",
  "financeManagerId",
  "financeManagerName",
  "financeManagerMobile",
  "financeManagerEmail",
  "financeManagerEmployeeId",
  "assignedFinanceManager",
  "bankId",
  "bankName",
  "assignedBankName",
  "assignedBankIfsc",
  "ifscCode",
  "assignedExecutiveId",
  "assignedExecutiveEmail",
  "assignedExecutiveName",
  "assignedExecutiveMobile",
  "pendingDocuments",
  "pendingDocumentReason",
  "updatedByExecutiveName",
  "loanExecutiveRemarks",
  "bankRemarks",
  "sanctionLetterDocumentId",
  "sanctionLetterUploadedAt",
];

const VIEW_SEARCH_FIELDS = ["caseId", "fullName", "customerName", "mobile", "city", "bankName", "assignedBankName", "assignedExecutiveName", "salespersonName", "salespersonJobId", "salespersonEmail", "assignedSalesperson", "financeManagerName", "financeManagerEmployeeId", "financeManagerEmail", "assignedFinanceManager"];

function pick(record = {}, fields = VIEW_LEAD_FIELDS) {
  return fields.reduce((next, field) => {
    if (Object.prototype.hasOwnProperty.call(record, field)) next[field] = record[field];
    return next;
  }, { id: record.id });
}

function scopeId(value) {
  return String(value || "").trim();
}

function safeDocId(value) {
  return String(value || "").trim().replace(/[^\w.@-]/g, "_").slice(0, 420);
}

function timestampValue(value) {
  if (!value) return 0;
  if (typeof value?.toDate === "function") return value.toDate().getTime() || 0;
  if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function latestTimestamp(...values) {
  return values
    .filter(Boolean)
    .sort((left, right) => timestampValue(right) - timestampValue(left))[0] || "";
}

function projectionPayload(lead = {}, { scopeType, scopeId: scope }) {
  const projected = pick(lead);
  const updatedAt = latestTimestamp(lead.statusUpdatedAt, lead.updatedAt, lead.generatedAt, lead.createdAt) || new Date().toISOString();
  return {
    ...projected,
    viewType: "lead",
    sourceCollection: "leads",
    sourceId: lead.id,
    scopeType,
    scopeId: scope,
    createdAt: lead.createdAt || updatedAt,
    updatedAt,
    status: lead.status || "NEW",
    searchText: VIEW_SEARCH_FIELDS.map((field) => lead[field]).filter(Boolean).join(" ").toLowerCase(),
  };
}

function leadTargets(lead = {}) {
  const targets = [{ collection: "adminViews", scopeType: "admin", scopeId: "global", docId: safeDocId(`lead_${lead.id}`) }];
  const dealershipId = scopeId(lead.dealershipId || lead.dealershipEmail || lead.dealerEmail);
  if (dealershipId) {
    targets.push({ collection: "financeViews", scopeType: "dealership", scopeId: dealershipId, docId: safeDocId(`lead_${lead.id}`) });
    targets.push({ collection: "gmViews", scopeType: "dealership", scopeId: dealershipId, docId: safeDocId(`lead_${lead.id}`) });
  }
  const bankId = scopeId(lead.bankId || lead.assignedBankId || lead.assignedPartnerId);
  if (bankId) targets.push({ collection: "bankViews", scopeType: "bank", scopeId: bankId, docId: safeDocId(`lead_${lead.id}`) });
  [lead.assignedExecutiveId, lead.assignedExecutiveEmail].map(scopeId).filter(Boolean).forEach((executiveScope) => {
    targets.push({ collection: "executiveViews", scopeType: "executive", scopeId: executiveScope, docId: safeDocId(`lead_${lead.id}_${executiveScope}`) });
  });
  return targets;
}

export async function syncLeadProjection(lead = {}) {
  if (!lead?.id) return null;
  const targets = leadTargets(lead);
  await Promise.all(targets.map((target) => upsertRecord(
    target.collection,
    target.docId,
    projectionPayload(lead, target),
  )));
  await Promise.all([
    syncLeadDetailProjection(lead),
    syncBankDealershipProjection(lead),
  ]);
  return { synced: targets.length, leadId: lead.id };
}

export function syncLeadProjectionSoon(lead = {}) {
  Promise.resolve().then(() => syncLeadProjection(lead)).catch(() => {});
}

function notificationTargets(notification = {}) {
  const targets = [{ collection: "adminViews", scopeType: "admin", scopeId: "global", docId: safeDocId(`notification_${notification.id}`) }];
  const dealershipId = scopeId(notification.dealershipId || notification.dealerEmail || notification.meta?.dealershipId || notification.meta?.dealershipEmail);
  if (dealershipId) {
    targets.push({ collection: "financeViews", scopeType: "dealership", scopeId: dealershipId, docId: safeDocId(`notification_${notification.id}`) });
    targets.push({ collection: "gmViews", scopeType: "dealership", scopeId: dealershipId, docId: safeDocId(`notification_${notification.id}`) });
  }
  const bankId = scopeId(notification.bankId || notification.partnerId || notification.meta?.bankId || notification.meta?.assignedBankId || notification.meta?.assignedPartnerId);
  if (bankId) targets.push({ collection: "bankViews", scopeType: "bank", scopeId: bankId, docId: safeDocId(`notification_${notification.id}`) });
  const executiveScope = scopeId(notification.assignedExecutiveId || notification.recipientId || notification.meta?.assignedExecutiveId || notification.meta?.assignedExecutiveEmail);
  if (notification.recipientRole === "loan-executive" && executiveScope) {
    targets.push({ collection: "executiveViews", scopeType: "executive", scopeId: executiveScope, docId: safeDocId(`notification_${notification.id}_${executiveScope}`) });
  }
  return targets;
}

export async function syncNotificationProjection(notification = {}) {
  if (!notification?.id) return null;
  const targets = notificationTargets(notification);
  const updatedAt = notification.updatedAt || notification.readAt || notification.createdAt || new Date().toISOString();
  const payload = {
    id: notification.id,
    sourceId: notification.id,
    sourceCollection: "notifications",
    viewType: "notification",
    title: notification.title || "",
    message: notification.message || "",
    read: notification.read === true,
    type: notification.type || notification.notificationType || "",
    priority: notification.priority || "normal",
    leadId: notification.leadId || null,
    caseId: notification.caseId || null,
    customerName: notification.leadSnapshot?.customerName || notification.meta?.customerName || "",
    status: notification.leadSnapshot?.status || notification.meta?.status || notification.status || "",
    actor: notification.actor || notification.actorName || notification.meta?.actor || "",
    createdAt: notification.createdAt || updatedAt,
    updatedAt,
  };
  await Promise.all(targets.map((target) => upsertRecord(target.collection, target.docId, {
    ...payload,
    scopeType: target.scopeType,
    scopeId: target.scopeId,
  })));
  return { synced: targets.length, notificationId: notification.id };
}

export function syncNotificationProjectionSoon(notification = {}) {
  Promise.resolve().then(() => syncNotificationProjection(notification)).catch(() => {});
}

export async function queryLeadProjectionForUser({ user = {}, query = {}, fields = VIEW_LEAD_FIELDS, requestId = null } = {}) {
  const projectionStartedAt = Date.now();
  const { limit, cursor, page } = paginationParams(query);
  const role = user.role;
  let collection = "adminViews";
  const where = [{ field: "viewType", value: "lead" }];

  if (role === "finance-desk") {
    collection = "financeViews";
    where.push({ field: "scopeId", value: scopeId(user.dealershipId || user.email || user.uid) });
  } else if (role === "gm-sm") {
    collection = "gmViews";
    where.push({ field: "scopeId", value: scopeId(user.dealershipId || user.email || user.uid) });
  } else if (role === "bank-manager") {
    collection = "bankViews";
    where.push({ field: "scopeId", value: scopeId(user.bankId || user.bankName || user.email || user.uid) });
  } else if (role === "loan-executive") {
    collection = "executiveViews";
    where.push({ field: "scopeId", value: scopeId(user.uid || user.email) });
  } else if (role !== "super-admin") {
    return null;
  }

  const statuses = statusValuesForProjectionQuery(query.status);
  if (statuses.length === 1) where.push({ field: "status", value: statuses[0] });
  if (statuses.length > 1 && statuses.length <= 10) where.push({ field: "status", op: "in", value: statuses });
  if (query.dealershipId) where.push({ field: "dealershipId", value: scopeId(query.dealershipId) });
  if (query.salespersonId) where.push({ field: "salespersonId", value: scopeId(query.salespersonId) });
  if (query.financeManagerId) where.push({ field: "financeManagerId", value: scopeId(query.financeManagerId) });
  try {
    const result = await queryRecords(collection, {
      where,
      orderBy: "createdAt",
      direction: "desc",
      limit,
      cursor,
      page,
      search: query.search,
      searchFields: ["searchText", ...VIEW_SEARCH_FIELDS],
      fields: [...new Set(["sourceId", "viewType", "scopeId", ...fields])],
      maxLimit: 100,
    });
    const durationMs = Date.now() - projectionStartedAt;
    const resultCount = Array.isArray(result.data) ? result.data.length : 0;
    logInfo("Lead projection lookup completed", {
      tag: "PROJECTION-LATENCY",
      requestId,
      collection,
      queryType: "lead-projection",
      role,
      durationMs,
      resultCount,
      returnedNull: resultCount === 0,
      fallbackTriggered: resultCount === 0,
      where: where.map((clause) => ({ field: clause.field, op: clause.op || "==" })),
      limit,
      page: page || null,
      cursor: Boolean(cursor),
      search: Boolean(query.search),
    });
    if (!resultCount) return null;
    const mapStartedAt = Date.now();
    const data = result.data.map((item) => ({ ...item, id: item.sourceId || item.id }));
    const mapEndedAt = Date.now();
    const shapeStartedAt = Date.now();
    const response = pageResponse({ data, limit, nextCursor: result.nextCursor });
    const shapeEndedAt = Date.now();
    logInfo("Lead projection response shaping completed", {
      tag: "SERIALIZATION-LATENCY",
      requestId,
      function: "queryLeadProjectionForUser",
      collection,
      projectionMapDurationMs: mapEndedAt - mapStartedAt,
      responseShapeDurationMs: shapeEndedAt - shapeStartedAt,
      inputCount: resultCount,
      outputCount: data.length,
      financeManagerLookupCount: 0,
      executiveLookupCount: 0,
      dealershipLookupCount: 0,
      documentFormattingCount: 0,
    });
    return response;
  } catch (error) {
    logWarn("Lead projection lookup failed", {
      tag: "PROJECTION-LATENCY",
      requestId,
      collection,
      queryType: "lead-projection",
      role,
      durationMs: Date.now() - projectionStartedAt,
      error: error.code || error.message,
      timeout: error.code === "FIRESTORE_QUERY_TIMEOUT",
      fallbackTriggered: true,
      where: where.map((clause) => ({ field: clause.field, op: clause.op || "==" })),
      limit,
      page: page || null,
      cursor: Boolean(cursor),
      search: Boolean(query.search),
    });
    throw error;
  }
}

function statusValuesForProjectionQuery(status) {
  const value = String(status || "").trim();
  if (!value) return [];
  const normalized = normalizeStatus(value);
  if (normalized === LEAD_STATUSES.NEW || value === "New Lead" || value === "New") return [LEAD_STATUSES.NEW, LEAD_STATUSES.ASSIGNED];
  if (value === "Bank Processing") return [LEAD_STATUSES.CONTACTED, LEAD_STATUSES.ALL_DOCUMENTS_RECEIVED, LEAD_STATUSES.UNDER_BANK_PROCESS, LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW];
  if (value === "Pending Documents") return [LEAD_STATUSES.REQUEST_DOCUMENT, LEAD_STATUSES.DOCUMENT_RECEIVED, LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS, LEAD_STATUSES.DOCS_PENDING];
  if (value === "Disbursed") return [LEAD_STATUSES.DISBURSED, LEAD_STATUSES.CLOSED];
  if (value === "Rejected With Reason") return [LEAD_STATUSES.REJECTED];
  return [normalized];
}

function bankDealershipScope(lead = {}) {
  const bankId = scopeId(lead.bankId || lead.assignedBankId || lead.assignedPartnerId);
  const dealershipId = scopeId(lead.dealershipId || lead.dealershipEmail || lead.dealerEmail);
  if (!bankId || !dealershipId) return null;
  return { bankId, dealershipId };
}

function isDisbursedStatus(status) {
  return normalizeStatus(status) === LEAD_STATUSES.DISBURSED;
}

function isActiveStatus(status) {
  const normalized = normalizeStatus(status);
  return ![LEAD_STATUSES.DISBURSED, LEAD_STATUSES.REJECTED].includes(normalized);
}

function dealershipSummarySeed(lead = {}, scope = bankDealershipScope(lead)) {
  const updatedAt = latestTimestamp(lead.statusUpdatedAt, lead.updatedAt, lead.generatedAt, lead.createdAt) || new Date().toISOString();
  return {
    id: safeDocId(`bank_dealership_${scope.bankId}_${scope.dealershipId}`),
    viewType: "bank-dealership",
    bankId: scope.bankId,
    dealershipId: scope.dealershipId,
    dealershipName: lead.dealershipName || lead.dealerName || lead.dealerBusinessName || lead.dealershipEmail || lead.dealerEmail || scope.dealershipId,
    dealershipEmail: lead.dealershipEmail || lead.dealerEmail || "",
    dealerName: lead.dealerName || lead.dealershipName || "",
    dealerMobile: lead.dealerMobile || lead.dealershipMobile || "",
    city: lead.dealershipCity || lead.dealerCity || lead.city || "",
    dealershipCity: lead.dealershipCity || lead.dealerCity || lead.city || "",
    bankName: lead.bankName || lead.assignedBankName || "",
    bankIfsc: lead.assignedBankIfsc || lead.ifscCode || "",
    firstLeadAt: lead.createdAt || updatedAt,
    lastLeadAt: updatedAt,
    updatedAt,
    searchText: [
      lead.dealershipName,
      lead.dealerName,
      lead.dealershipEmail,
      lead.dealerEmail,
      lead.dealershipCity,
      lead.dealerCity,
      lead.city,
      lead.assignedBankName,
    ].filter(Boolean).join(" ").toLowerCase(),
  };
}

async function applyBankDealershipDelta({ summaryId, seed, totalDelta = 0, disbursedDelta = 0, activeDelta = 0 }) {
  const current = await getRecord("bankDealershipViews", summaryId).catch(() => null);
  const nextTotal = Math.max(0, Number(current?.totalCases || 0) + totalDelta);
  const nextDisbursed = Math.max(0, Number(current?.totalDisbursedCases || 0) + disbursedDelta);
  const nextActive = Math.max(0, Number(current?.activeCases || 0) + activeDelta);
  await upsertRecord("bankDealershipViews", summaryId, {
    ...(current || {}),
    ...seed,
    totalCases: nextTotal,
    totalDisbursedCases: nextDisbursed,
    activeCases: nextActive,
    updatedAt: seed.updatedAt,
    lastLeadAt: seed.lastLeadAt || current?.lastLeadAt || seed.updatedAt,
  });
}

export async function syncBankDealershipProjection(lead = {}) {
  if (!lead?.id) return null;
  const scope = bankDealershipScope(lead);
  if (!scope) return null;
  const now = new Date().toISOString();
  const markerId = safeDocId(`bank_dealership_lead_${lead.id}`);
  const previous = await getRecord("bankDealershipLeadProjection", markerId).catch(() => null);
  const summaryId = safeDocId(`bank_dealership_${scope.bankId}_${scope.dealershipId}`);
  const seed = dealershipSummarySeed(lead, scope);
  const currentDisbursed = isDisbursedStatus(lead.status);
  const currentActive = isActiveStatus(lead.status);
  const sameRelationship = previous?.bankId === scope.bankId && previous?.dealershipId === scope.dealershipId;

  if (previous && !sameRelationship) {
    const previousSummaryId = safeDocId(`bank_dealership_${previous.bankId}_${previous.dealershipId}`);
    await applyBankDealershipDelta({
      summaryId: previousSummaryId,
      seed: {
        id: previousSummaryId,
        viewType: "bank-dealership",
        bankId: previous.bankId,
        dealershipId: previous.dealershipId,
        updatedAt: now,
      },
      totalDelta: -1,
      disbursedDelta: previous.isDisbursed ? -1 : 0,
      activeDelta: previous.isActive ? -1 : 0,
    });
  }

  await applyBankDealershipDelta({
    summaryId,
    seed,
    totalDelta: sameRelationship ? 0 : 1,
    disbursedDelta: (currentDisbursed ? 1 : 0) - (sameRelationship && previous?.isDisbursed ? 1 : 0),
    activeDelta: (currentActive ? 1 : 0) - (sameRelationship && previous?.isActive ? 1 : 0),
  });

  const marker = {
    id: markerId,
    leadId: lead.id,
    caseId: lead.caseId || lead.id,
    bankId: scope.bankId,
    dealershipId: scope.dealershipId,
    status: lead.status || LEAD_STATUSES.NEW,
    isDisbursed: currentDisbursed,
    isActive: currentActive,
    updatedAt: now,
    createdAt: previous?.createdAt || lead.createdAt || now,
  };
  await upsertRecord("bankDealershipLeadProjection", markerId, marker);
  return marker;
}

export function syncBankDealershipProjectionSoon(lead = {}) {
  Promise.resolve().then(() => syncBankDealershipProjection(lead)).catch(() => {});
}

export async function queryBankDealershipProjection({ bankId, query = {} } = {}) {
  const scope = scopeId(bankId);
  if (!scope) return null;
  const { limit, cursor, page } = paginationParams({ ...query, limit: query.limit || 20 });
  const result = await queryRecords("bankDealershipViews", {
    where: [
      { field: "viewType", value: "bank-dealership" },
      { field: "bankId", value: scope },
    ],
    orderBy: "lastLeadAt",
    direction: "desc",
    limit,
    cursor,
    page,
    search: query.search,
    searchFields: ["searchText"],
    fields: [
      "id",
      "viewType",
      "bankId",
      "dealershipId",
      "dealershipName",
      "dealershipEmail",
      "dealerName",
      "dealerMobile",
      "city",
      "dealershipCity",
      "bankName",
      "bankIfsc",
      "totalCases",
      "activeCases",
      "totalDisbursedCases",
      "firstLeadAt",
      "lastLeadAt",
      "updatedAt",
    ],
    maxLimit: 100,
  });
  return pageResponse({ data: result.data, limit, nextCursor: result.nextCursor });
}

export async function queryNotificationProjectionForUser({ user = {}, query = {} } = {}) {
  const { limit, cursor, page } = paginationParams({ ...query, limit: query.limit || 40 });
  const role = user.role;
  let collection = "adminViews";
  const where = [{ field: "viewType", value: "notification" }];

  if (role === "finance-desk") {
    collection = "financeViews";
    where.push({ field: "scopeId", value: scopeId(user.dealershipId || user.email || user.uid) });
  } else if (role === "gm-sm") {
    collection = "gmViews";
    where.push({ field: "scopeId", value: scopeId(user.dealershipId || user.email || user.uid) });
  } else if (role === "bank-manager") {
    collection = "bankViews";
    where.push({ field: "scopeId", value: scopeId(user.bankId || user.bankName || user.email || user.uid) });
  } else if (role === "loan-executive") {
    collection = "executiveViews";
    where.push({ field: "scopeId", value: scopeId(user.uid || user.email) });
  } else if (role !== "super-admin") {
    return null;
  }

  const result = await queryRecords(collection, {
    where,
    orderBy: "createdAt",
    direction: "desc",
    limit,
    cursor,
    page,
    maxLimit: 100,
    fields: [
      "sourceId",
      "viewType",
      "scopeId",
      "title",
      "message",
      "read",
      "type",
      "priority",
      "leadId",
      "caseId",
      "status",
      "actor",
      "createdAt",
      "updatedAt",
    ],
  });
  if (!result.data.length) return null;
  return pageResponse({
    data: result.data.map((item) => ({ ...item, id: item.sourceId || item.id })),
    limit,
    nextCursor: result.nextCursor,
  });
}

export async function syncLeadDetailProjection(lead = {}, extras = {}) {
  if (!lead?.id) return null;
  const updatedAt = latestTimestamp(lead.statusUpdatedAt, lead.updatedAt, lead.generatedAt, lead.createdAt) || new Date().toISOString();
  const documentCounts = extras.documentCounts || {
    documents: Array.isArray(extras.documents) ? extras.documents.length : Number(lead.documentCount || 0),
    bankDocuments: Array.isArray(extras.bankDocuments) ? extras.bankDocuments.length : Number(lead.bankDocumentCount || 0),
    pendingDocuments: Array.isArray(lead.pendingDocuments) ? lead.pendingDocuments.length : 0,
  };
  const payload = {
    ...pick(lead),
    sourceCollection: "leads",
    sourceId: lead.id,
    viewType: "lead-detail",
    leadId: lead.id,
    caseId: lead.caseId || lead.id,
    customerSummary: {
      name: lead.fullName || lead.customerName || "",
      mobile: lead.mobile || "",
      city: lead.city || "",
    },
    executiveSummary: {
      id: lead.assignedExecutiveId || "",
      email: lead.assignedExecutiveEmail || "",
      name: lead.assignedExecutiveName || "",
      mobile: lead.assignedExecutiveMobile || "",
    },
    statusSummary: {
      status: lead.status || "NEW",
      statusUpdatedAt: lead.statusUpdatedAt || updatedAt,
      updatedByExecutiveName: lead.updatedByExecutiveName || "",
      loanExecutiveRemarks: lead.loanExecutiveRemarks || "",
    },
    documentCounts,
    timelineSummary: extras.timelineSummary || lead.timelineSummary || null,
    updatedAt,
    createdAt: lead.createdAt || updatedAt,
    searchText: VIEW_SEARCH_FIELDS.map((field) => lead[field]).filter(Boolean).join(" ").toLowerCase(),
  };
  if (Array.isArray(extras.documents)) payload.documents = extras.documents;
  if (Array.isArray(extras.bankDocuments)) payload.bankDocuments = extras.bankDocuments;
  await upsertRecord("leadDetailsProjection", safeDocId(lead.id), payload);
  return payload;
}

export function syncLeadDetailProjectionSoon(lead = {}, extras = {}) {
  Promise.resolve().then(() => syncLeadDetailProjection(lead, extras)).catch(() => {});
}

export async function getLeadDetailProjection(leadId) {
  const id = scopeId(leadId);
  if (!id) return null;
  const direct = await queryRecords("leadDetailsProjection", {
    where: [{ field: "leadId", value: id }],
    orderBy: "updatedAt",
    direction: "desc",
    limit: 1,
    maxLimit: 1,
  });
  return direct.data[0] || null;
}

export async function syncTimelineProjection(event = {}) {
  if (!event?.id) return null;
  const metadata = event.metadata || {};
  const timestamp = event.createdAt || event.updatedAt || new Date().toISOString();
  const payload = {
    id: event.id,
    sourceCollection: "leadTimeline",
    sourceId: event.id,
    viewType: "timeline",
    leadId: event.leadId || "",
    caseId: event.caseId || metadata.caseId || "",
    eventType: event.eventType || event.type || "",
    title: event.title || "",
    description: event.description || "",
    actorId: event.actorId || "",
    actorName: event.actorName || "",
    actorRole: event.actorRole || "",
    status: metadata.nextStatus || metadata.status || event.status || "",
    dealershipId: event.dealershipId || event.dealershipEmail || metadata.dealershipId || metadata.dealershipEmail || "",
    dealershipEmail: event.dealershipEmail || metadata.dealershipEmail || "",
    bankId: event.bankId || metadata.bankId || metadata.assignedBankId || metadata.assignedPartnerId || "",
    branchId: event.branchId || metadata.branchId || metadata.bankBranchId || metadata.ifscCode || metadata.assignedBankIfsc || "",
    assignedExecutiveId: event.assignedExecutiveId || metadata.assignedExecutiveId || event.assignedExecutiveEmail || metadata.assignedExecutiveEmail || "",
    assignedExecutiveEmail: event.assignedExecutiveEmail || metadata.assignedExecutiveEmail || "",
    visibility: event.visibility || [],
    metadata,
    searchText: [
      event.leadId,
      event.caseId,
      event.title,
      event.description,
      event.actorName,
      event.actorRole,
      event.eventType,
      metadata.customerName,
      metadata.executiveName,
    ].filter(Boolean).join(" ").toLowerCase(),
    createdAt: timestamp,
    updatedAt: event.updatedAt || timestamp,
  };
  await upsertRecord("timelineProjection", safeDocId(event.id), payload);
  return payload;
}

export function syncTimelineProjectionSoon(event = {}) {
  Promise.resolve().then(() => syncTimelineProjection(event)).catch(() => {});
}

export async function queryTimelineProjection({ leadId = "", query = {}, actor = {} } = {}) {
  const { limit, cursor, page } = paginationParams({ ...query, limit: query.limit || 20 });
  const where = [{ field: "viewType", value: "timeline" }];
  if (leadId) where.push({ field: "leadId", value: leadId });
  if (query.eventType) where.push({ field: "eventType", value: String(query.eventType).trim() });
  if (actor.role === "finance-desk" || actor.role === "gm-sm") {
    where.push({ field: "dealershipId", value: scopeId(actor.dealershipId || actor.email || actor.uid) });
  } else if (actor.role === "bank-manager") {
    where.push({ field: "bankId", value: scopeId(actor.bankId || actor.bankName || actor.email || actor.uid) });
  } else if (actor.role === "loan-executive") {
    where.push({ field: "assignedExecutiveId", value: scopeId(actor.uid || actor.email) });
  }
  const result = await queryRecords("timelineProjection", {
    where,
    orderBy: "createdAt",
    direction: "desc",
    limit,
    cursor,
    page,
    maxLimit: 100,
    search: query.search,
    searchFields: ["searchText"],
  });
  if (!result.data.length) return null;
  return pageResponse({
    data: result.data.map((item) => ({ ...item, id: item.sourceId || item.id })),
    limit,
    nextCursor: result.nextCursor,
  });
}

function staffProjectionPayload(record = {}) {
  const email = scopeId(record.email || record.officialEmail || record.id).toLowerCase();
  const dealershipId = scopeId(record.dealershipId || record.dealershipEmail);
  return {
    id: safeDocId(`staff_${dealershipId}_${email}`),
    sourceId: record.id || email,
    sourceCollection: record.sourceCollection || "staff",
    viewType: "staff",
    dealershipId,
    dealershipEmail: dealershipId,
    uid: record.uid || record.authUid || "",
    email,
    officialEmail: email,
    fullName: record.fullName || record.name || record.headName || email,
    name: record.name || record.fullName || record.headName || email,
    mobile: record.mobile || record.headMobile || record.officialMobile || "",
    employeeId: record.employeeId || record.jobId || record.employeeCode || "",
    jobId: record.jobId || record.employeeId || "",
    role: record.role || "",
    roleLabel: record.roleLabel || record.role || "",
    portal: record.portal || record.portalType || "",
    status: record.active === false || record.accountActive === false ? "inactive" : record.status || record.accountStatus || "active",
    active: record.active !== false && record.accountActive !== false,
    branch: record.branch || record.city || record.location || record.dealershipCity || "",
    city: record.city || record.branch || "",
    caseCounts: record.caseCounts || {},
    permissions: record.permissions || [],
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || new Date().toISOString(),
  };
}

export async function syncStaffViewProjection(record = {}) {
  const payload = staffProjectionPayload(record);
  if (!payload.email || !payload.dealershipId) return null;
  await upsertRecord("staffViewProjection", payload.id, payload);
  return payload;
}

export function syncStaffViewProjectionSoon(record = {}) {
  Promise.resolve().then(() => syncStaffViewProjection(record)).catch(() => {});
}

export async function queryStaffViewProjection({ dealershipId, query = {} } = {}) {
  const scope = scopeId(dealershipId);
  if (!scope) return null;
  const { limit, cursor, page } = paginationParams({ ...query, limit: query.limit || 100 });
  const result = await queryRecords("staffViewProjection", {
    where: [{ field: "dealershipId", value: scope }],
    orderBy: "createdAt",
    direction: "desc",
    limit,
    cursor,
    page,
    maxLimit: 100,
  });
  return result.data.length ? result.data : null;
}

export async function syncExecutiveSummaryProjection(executive = {}, counts = {}) {
  const bankId = scopeId(executive.bankId || executive.bankPartnerId || executive.partnerId);
  const executiveId = scopeId(executive.id || executive.jobId || executive.email || executive.mobile);
  if (!bankId || !executiveId) return null;
  const payload = {
    ...executive,
    id: safeDocId(`executive_${bankId}_${executiveId}`),
    sourceId: executive.id || executiveId,
    viewType: "executive-summary",
    bankId,
    executiveId,
    email: executive.email || executive.officialEmail || "",
    mobile: executive.mobile || "",
    name: executive.name || executive.fullName || executive.email || "",
    totalAssignedCases: Number(counts.totalAssignedCases || executive.totalAssignedCases || 0),
    currentActiveCases: Number(counts.currentActiveCases || executive.currentActiveCases || 0),
    status: executive.active === false ? "inactive" : executive.status || "active",
    updatedAt: executive.updatedAt || new Date().toISOString(),
    createdAt: executive.createdAt || new Date().toISOString(),
  };
  await upsertRecord("executiveSummaryProjection", payload.id, payload);
  return payload;
}

export function syncExecutiveSummaryProjectionSoon(executive = {}, counts = {}) {
  Promise.resolve().then(() => syncExecutiveSummaryProjection(executive, counts)).catch(() => {});
}

export async function queryExecutiveSummaryProjection({ bankId, query = {} } = {}) {
  const scope = scopeId(bankId);
  if (!scope) return null;
  const { limit, cursor, page } = paginationParams({ ...query, limit: query.limit || 100 });
  const result = await queryRecords("executiveSummaryProjection", {
    where: [{ field: "bankId", value: scope }],
    orderBy: "createdAt",
    direction: "desc",
    limit,
    cursor,
    page,
    maxLimit: 100,
  });
  return result.data.length ? result.data : null;
}

export async function syncSalespersonSummaryProjection(person = {}, counts = {}) {
  const dealershipId = scopeId(person.dealershipId || person.dealershipEmail);
  const salespersonId = scopeId(person.id || person.jobId || person.email || person.mobile);
  if (!dealershipId || !salespersonId) return null;
  const payload = {
    ...person,
    id: safeDocId(`salesperson_${dealershipId}_${salespersonId}`),
    sourceId: person.id || salespersonId,
    viewType: "salesperson-summary",
    dealershipId,
    salespersonId,
    name: person.name || person.fullName || person.email || "",
    mobile: person.mobile || "",
    jobId: person.jobId || person.employeeId || "",
    email: person.email || "",
    active: person.active !== false,
    totalCases: Number(counts.totalCases || person.totalCases || 0),
    disbursedCases: Number(counts.disbursedCases || person.disbursedCases || 0),
    rejectedCases: Number(counts.rejectedCases || person.rejectedCases || 0),
    pendingCases: Number(counts.pendingCases || person.pendingCases || 0),
    updatedAt: person.updatedAt || new Date().toISOString(),
    createdAt: person.createdAt || new Date().toISOString(),
  };
  await upsertRecord("salespersonSummaryProjection", payload.id, payload);
  return payload;
}

export function syncSalespersonSummaryProjectionSoon(person = {}, counts = {}) {
  Promise.resolve().then(() => syncSalespersonSummaryProjection(person, counts)).catch(() => {});
}

export async function querySalespersonSummaryProjection({ dealershipId, query = {} } = {}) {
  const scope = scopeId(dealershipId);
  if (!scope) return null;
  const { limit, cursor, page } = paginationParams({ ...query, limit: query.limit || 100 });
  const result = await queryRecords("salespersonSummaryProjection", {
    where: [{ field: "dealershipId", value: scope }],
    orderBy: "createdAt",
    direction: "desc",
    limit,
    cursor,
    page,
    maxLimit: 100,
  });
  return result.data.length ? result.data : null;
}
