import * as core from "./projectionCore.service.js";

export async function syncTimelineProjection(...args) {
  return core.syncTimelineProjection(...args);
}
export function syncTimelineProjectionSoon(...args) {
  return core.syncTimelineProjectionSoon(...args);
}
export async function queryTimelineProjection(...args) {
  return core.queryTimelineProjection(...args);
}
