import * as core from "./projectionCore.service.js";

export async function syncStaffViewProjection(...args) {
  return core.syncStaffViewProjection(...args);
}
export function syncStaffViewProjectionSoon(...args) {
  return core.syncStaffViewProjectionSoon(...args);
}
export async function queryStaffViewProjection(...args) {
  return core.queryStaffViewProjection(...args);
}
export async function syncExecutiveSummaryProjection(...args) {
  return core.syncExecutiveSummaryProjection(...args);
}
export function syncExecutiveSummaryProjectionSoon(...args) {
  return core.syncExecutiveSummaryProjectionSoon(...args);
}
export async function queryExecutiveSummaryProjection(...args) {
  return core.queryExecutiveSummaryProjection(...args);
}
export async function syncSalespersonSummaryProjection(...args) {
  return core.syncSalespersonSummaryProjection(...args);
}
export function syncSalespersonSummaryProjectionSoon(...args) {
  return core.syncSalespersonSummaryProjectionSoon(...args);
}
export async function querySalespersonSummaryProjection(...args) {
  return core.querySalespersonSummaryProjection(...args);
}
