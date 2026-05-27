import { DEFAULT_THRESHOLDS, stages, sharedTags } from "./config.js";
import { apiGet, assertOk, enforceReadOnlySafety, handleSummary, pause, rawGet } from "./helpers.js";

export const options = {
  stages: stages(),
  thresholds: DEFAULT_THRESHOLDS,
};

export { handleSummary };

export default function () {
  enforceReadOnlySafety();
  assertOk(rawGet("/health", sharedTags("health")), "health", 1500);
  assertOk(rawGet("/health/queues", sharedTags("queue-health")), "queue health", 2000);
  assertOk(apiGet("/banks", null, sharedTags("catalog")), "catalog banks", 2000);
  pause();
}
