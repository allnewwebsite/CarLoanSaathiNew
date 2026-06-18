import { queryRecords, upsertRecord } from "./firestore.service.js";
import { pageResponse, paginationParams } from "../utils/pagination.js";
import { freshProjectionRows } from "./projectionFreshness.service.js";
import { safeDocId, scopeId, withProjectionMetadata } from "./projectionShared.service.js";

export async function syncTimelineProjection(event = {}) {
  if (!event?.id) return null;
  const metadata = event.metadata || {};
  const timestamp = event.createdAt || event.updatedAt || new Date().toISOString();
  const payload = withProjectionMetadata({
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
  }, { sourceCollection: "leadTimeline", sourceId: event.id, sourceUpdatedAt: event.updatedAt || timestamp, projectionType: "timeline" });
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
  if (actor.role === "finance-desk" || actor.role === "gm") {
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
  const freshRows = await freshProjectionRows("timelineProjection", result.data);
  if (!freshRows.length) return null;
  return pageResponse({
    data: freshRows.map((item) => ({ ...item, id: item.sourceId || item.id })),
    limit,
    nextCursor: result.nextCursor,
  });
}
