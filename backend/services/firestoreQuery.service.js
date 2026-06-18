import * as core from "./firestoreCore.service.js";

export async function listRecords(...args) {
  return core.listRecords(...args);
}
export async function findRecordsByField(...args) {
  return core.findRecordsByField(...args);
}
export async function findFirstRecordByFields(...args) {
  return core.findFirstRecordByFields(...args);
}
export async function listRecentRecords(...args) {
  return core.listRecentRecords(...args);
}
export async function queryRecords(...args) {
  return core.queryRecords(...args);
}
export async function countRecords(...args) {
  return core.countRecords(...args);
}
