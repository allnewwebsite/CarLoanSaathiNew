import * as core from "./firestoreCore.service.js";
import { queryRecords } from "./firestoreQuery.service.js";

export async function createRecord(...args) {
  return core.createRecord(...args);
}
export async function getRecord(...args) {
  return core.getRecord(...args);
}
export async function updateRecord(...args) {
  return core.updateRecord(...args);
}
export async function upsertRecord(...args) {
  return core.upsertRecord(...args);
}
export async function incrementRecord(...args) {
  return core.incrementRecord(...args);
}
export async function bulkUpsertRecords(...args) {
  return core.bulkUpsertRecords(...args);
}
export async function deleteRecord(...args) {
  return core.deleteRecord(...args);
}
export async function deleteRecordsByIds(...args) {
  return core.deleteRecordsByIds(...args);
}
export async function deleteRecordsByQuery(collection, {
  where = [],
  limit = 250,
  maxPasses = 20,
} = {}) {
  const clauses = where.filter((clause) => clause?.field && clause.value !== undefined && clause.value !== null && clause.value !== "");
  if (!clauses.length) {
    const error = new Error("Refusing unscoped deleteRecordsByQuery call");
    error.status = 400;
    error.code = "UNSCOPED_DELETE_QUERY";
    throw error;
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 250, 1), 500);
  let deleted = 0;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const page = await queryRecords(collection, {
      where: clauses,
      orderBy: clauses[0].field,
      direction: "asc",
      limit: safeLimit,
      maxLimit: safeLimit,
      fields: ["id"],
      allowGlobal: collection === "leads",
    });
    const ids = page.data.map((item) => item.id).filter(Boolean);
    if (!ids.length) break;
    deleted += await core.deleteRecordsByIds(collection, ids);
    if (ids.length < safeLimit) break;
  }
  return deleted;
}
