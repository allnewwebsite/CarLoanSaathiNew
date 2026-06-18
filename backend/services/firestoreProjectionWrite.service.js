import * as core from "./firestoreCore.service.js";

export async function syncWriteProjections(...args) {
  return core.syncWriteProjections(...args);
}
