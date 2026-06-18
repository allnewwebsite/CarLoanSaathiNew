import * as core from "./realtimeClientCore.js";

export function startRealtimeClient(...args) {
  return core.startRealtimeClient(...args);
}
export function stopRealtimeClient(...args) {
  return core.stopRealtimeClient(...args);
}
export function realtimeDebugState(...args) {
  return core.realtimeDebugState(...args);
}
