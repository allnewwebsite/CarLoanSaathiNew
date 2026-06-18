import * as core from "./projectionCore.service.js";

export async function syncNotificationProjection(...args) {
  return core.syncNotificationProjection(...args);
}
export function syncNotificationProjectionSoon(...args) {
  return core.syncNotificationProjectionSoon(...args);
}
export async function queryNotificationProjectionForUser(...args) {
  return core.queryNotificationProjectionForUser(...args);
}
