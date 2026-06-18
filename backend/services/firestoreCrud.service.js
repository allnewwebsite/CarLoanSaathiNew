import * as core from "./firestoreCore.service.js";

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
export async function deleteRecordsByQuery(...args) {
  return core.deleteRecordsByQuery(...args);
}
