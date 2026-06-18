import { PROJECTION_VERSION } from "./projectionCore.service.js";
import * as core from "./projectionCore.service.js";

export { PROJECTION_VERSION };
export async function syncLeadProjection(...args) {
  return core.syncLeadProjection(...args);
}
export async function removeLeadProjections(...args) {
  return core.removeLeadProjections(...args);
}
export function syncLeadProjectionSoon(...args) {
  return core.syncLeadProjectionSoon(...args);
}
export async function removeLeadExecutiveProjection(...args) {
  return core.removeLeadExecutiveProjection(...args);
}
export async function queryLeadProjectionForUser(...args) {
  return core.queryLeadProjectionForUser(...args);
}
