import * as core from "./projectionCore.service.js";

export async function validateProjectionFreshness(...args) {
  return core.validateProjectionFreshness(...args);
}
