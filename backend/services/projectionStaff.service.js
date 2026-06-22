import { deleteRecord, getRecord, queryRecords, upsertRecord } from "./firestore.service.js";
import { paginationParams } from "../utils/pagination.js";
import { freshProjectionRows } from "./projectionFreshness.service.js";
import { safeDocId, scopeId, withProjectionMetadata } from "./projectionShared.service.js";

function staffProjectionPayload(record = {}) {
  const email = scopeId(record.email || record.officialEmail || record.id).toLowerCase();
  const dealershipId = scopeId(record.dealershipId || record.dealershipEmail);
  return withProjectionMetadata({
    id: safeDocId(`staff_${dealershipId}_${email}`),
    sourceId: record.id || email,
    sourceCollection: record.sourceCollection || record.sourceCollections?.[0] || "dealerStaff",
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
  }, {
    sourceCollection: record.sourceCollection || record.sourceCollections?.[0] || "dealerStaff",
    sourceId: record.id || email,
    sourceUpdatedAt: record.updatedAt || record.createdAt || new Date().toISOString(),
    projectionType: "staff",
  });
}

function removedStaffSource(record = {}) {
  const status = String(record.status || record.accountStatus || "").trim().toLowerCase();
  return record.active === false
    || record.accountActive === false
    || ["deleted", "removed", "inactive", "disabled", "suspended"].includes(status);
}

function removedSalespersonSource(record = {}) {
  const status = String(record.status || "").trim().toLowerCase();
  return record.active === false || ["deleted", "removed", "inactive", "disabled", "suspended"].includes(status);
}

async function liveStaffProjectionRows(rows = []) {
  const checks = await Promise.all(rows.map(async (row) => {
    if (removedStaffSource(row)) return false;
    const sourceCollection = String(row.sourceCollection || "").trim();
    const sourceId = scopeId(row.sourceId || "");
    if (!sourceCollection || !sourceId) return true;
    const source = await getRecord(sourceCollection, sourceId).catch(() => null);
    const live = Boolean(source && !removedStaffSource(source));
    if (!live && row.id) await deleteRecord("staffViewProjection", row.id).catch(() => null);
    return live;
  }));
  return rows.filter((_, index) => checks[index]);
}

async function liveSalespersonProjectionRows(rows = []) {
  const checks = await Promise.all(rows.map(async (row) => {
    if (removedSalespersonSource(row)) return false;
    const sourceCollection = String(row.sourceCollection || "salespersons").trim();
    const sourceId = scopeId(row.sourceId || row.salespersonId || "");
    if (!sourceCollection || !sourceId) return true;
    const source = await getRecord(sourceCollection, sourceId).catch(() => null);
    const live = Boolean(source && !removedSalespersonSource(source));
    if (!live && row.id) await deleteRecord("salespersonSummaryProjection", row.id).catch(() => null);
    return live;
  }));
  return rows.filter((_, index) => checks[index]);
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

export async function queryStaffViewProjection({ dealershipId, query = {}, verifyLive = false } = {}) {
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
  if (!result.data.length) return null;
  const freshRows = await freshProjectionRows("staffViewProjection", result.data);
  const liveRows = verifyLive ? await liveStaffProjectionRows(freshRows) : freshRows;
  return liveRows.length ? liveRows : null;
}

export async function syncExecutiveSummaryProjection(executive = {}, counts = {}) {
  const bankId = scopeId(executive.bankId || executive.bankPartnerId || executive.partnerId);
  const executiveId = scopeId(executive.id || executive.email || executive.mobile);
  if (!bankId || !executiveId) return null;
  const updatedAt = executive.updatedAt || new Date().toISOString();
  const payload = withProjectionMetadata({
    ...executive,
    id: safeDocId(`executive_${bankId}_${executiveId}`),
    sourceId: executive.id || executiveId,
    viewType: "executive-summary",
    bankId,
    executiveId,
    email: executive.email || executive.officialEmail || "",
    mobile: executive.mobile || "",
    name: executive.name || executive.fullName || executive.email || "",
    bankIfsc: executive.bankIfsc || executive.ifsc || executive.ifscCode || executive.branchIfsc || "",
    ifsc: executive.ifsc || executive.bankIfsc || executive.ifscCode || executive.branchIfsc || "",
    ifscCode: executive.ifscCode || executive.bankIfsc || executive.ifsc || executive.branchIfsc || "",
    branchId: executive.branchId || executive.bankBranchLocation || executive.branchCity || executive.branchLocation || executive.city || "",
    branch: executive.branch || executive.bankBranchLocation || executive.branchCity || executive.branchLocation || executive.city || "",
    bankBranchLocation: executive.bankBranchLocation || executive.branchLocation || executive.branchCity || executive.city || "",
    branchCity: executive.branchCity || executive.bankBranchLocation || executive.branchLocation || executive.city || "",
    branchLocation: executive.branchLocation || executive.bankBranchLocation || executive.branchCity || executive.city || "",
    city: executive.city || executive.branchCity || executive.bankBranchLocation || executive.branchLocation || "",
    totalAssignedCases: Number(counts.totalAssignedCases || executive.totalAssignedCases || 0),
    currentActiveCases: Number(counts.currentActiveCases || executive.currentActiveCases || 0),
    status: executive.active === false ? "inactive" : executive.status || "active",
    updatedAt,
    createdAt: executive.createdAt || updatedAt,
  }, { sourceCollection: "loanExecutives", sourceId: executive.id || executiveId, sourceUpdatedAt: updatedAt, projectionType: "executive-summary" });
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
  if (!result.data.length) return null;
  const freshRows = await freshProjectionRows("executiveSummaryProjection", result.data);
  return freshRows.length ? freshRows : null;
}

export async function syncSalespersonSummaryProjection(person = {}, counts = {}) {
  const dealershipId = scopeId(person.dealershipId || person.dealershipEmail);
  const salespersonId = scopeId(person.id || person.jobId || person.email || person.mobile);
  if (!dealershipId || !salespersonId) return null;
  const updatedAt = person.updatedAt || new Date().toISOString();
  const payload = withProjectionMetadata({
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
    updatedAt,
    createdAt: person.createdAt || updatedAt,
  }, { sourceCollection: person.sourceCollection || "salespersons", sourceId: person.id || salespersonId, sourceUpdatedAt: updatedAt, projectionType: "salesperson-summary" });
  await upsertRecord("salespersonSummaryProjection", payload.id, payload);
  return payload;
}

export function syncSalespersonSummaryProjectionSoon(person = {}, counts = {}) {
  Promise.resolve().then(() => syncSalespersonSummaryProjection(person, counts)).catch(() => {});
}

export async function querySalespersonSummaryProjection({ dealershipId, query = {}, verifyLive = false } = {}) {
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
  if (!result.data.length) return null;
  const freshRows = await freshProjectionRows("salespersonSummaryProjection", result.data);
  const liveRows = verifyLive ? await liveSalespersonProjectionRows(freshRows) : freshRows;
  return liveRows.length ? liveRows : null;
}
