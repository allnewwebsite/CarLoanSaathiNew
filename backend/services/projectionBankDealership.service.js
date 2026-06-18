import { deleteRecord, getRecord, queryRecords, upsertRecord } from "./firestore.service.js";
import { pageResponse, paginationParams } from "../utils/pagination.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";
import { freshProjectionRows } from "./projectionFreshness.service.js";
import {
  isoNow,
  latestTimestamp,
  PROJECTION_META_FIELDS,
  safeDocId,
  scopeId,
  withProjectionMetadata,
} from "./projectionShared.service.js";

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
  return withProjectionMetadata({
    id: safeDocId(`bank_dealership_${scope.bankId}_${scope.dealershipId}`),
    viewType: "bank-dealership",
    sourceCollection: "leads",
    sourceId: lead.id,
    leadId: lead.id,
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
  }, { sourceCollection: "leads", sourceId: lead.id, sourceUpdatedAt: updatedAt, projectionType: "bank-dealership" });
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

  const marker = withProjectionMetadata({
    id: markerId,
    sourceCollection: "leads",
    sourceId: lead.id,
    leadId: lead.id,
    caseId: lead.caseId || lead.id,
    bankId: scope.bankId,
    dealershipId: scope.dealershipId,
    status: lead.status || LEAD_STATUSES.NEW,
    isDisbursed: currentDisbursed,
    isActive: currentActive,
    updatedAt: now,
    createdAt: previous?.createdAt || lead.createdAt || now,
  }, { sourceCollection: "leads", sourceId: lead.id, sourceUpdatedAt: now, projectionType: "bank-dealership-marker" });
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
      "sourceId",
      "leadId",
      ...PROJECTION_META_FIELDS,
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
  const freshRows = await freshProjectionRows("bankDealershipViews", result.data);
  if (!freshRows.length) return null;
  return pageResponse({ data: freshRows, limit, nextCursor: result.nextCursor });
}

export async function removeBankDealershipLeadProjection(leadId) {
  const markerId = safeDocId(`bank_dealership_lead_${leadId}`);
  const previous = await getRecord("bankDealershipLeadProjection", markerId).catch(() => null);
  if (!previous) return false;
  const summaryId = safeDocId(`bank_dealership_${previous.bankId}_${previous.dealershipId}`);
  await applyBankDealershipDelta({
    summaryId,
    seed: {
      id: summaryId,
      viewType: "bank-dealership",
      bankId: previous.bankId,
      dealershipId: previous.dealershipId,
      updatedAt: isoNow(),
    },
    totalDelta: -1,
    disbursedDelta: previous.isDisbursed ? -1 : 0,
    activeDelta: previous.isActive ? -1 : 0,
  });
  await deleteRecord("bankDealershipLeadProjection", markerId).catch(() => false);
  return true;
}
