import { stages, sharedTags } from "./config.js";
import { apiGet, apiPost, assertOk, enforceReadOnlySafety, enforceWriteSafety, handleSummary, loginAs, pause, rawGet, requireToken } from "./helpers.js";

export const options = {
  stages: stages(),
  thresholds: {
    http_req_failed: ["rate<0.02"],
    "http_req_duration{area:queue-health}": ["p(95)<1500", "p(99)<3000"],
    "http_req_duration{area:notification-list}": ["p(95)<1800", "p(99)<3500"],
    "http_req_duration{area:queue-drain}": ["p(95)<3000", "p(99)<6000"],
  },
};

export { handleSummary };

export function setup() {
  if (__ENV.PROCESS_QUEUE === "true") enforceWriteSafety();
  else enforceReadOnlySafety();
  return { token: __ENV.AUTH_TOKEN || loginAs("admin") || loginAs("finance") };
}

export default function ({ token }) {
  requireToken(token, "queue");

  assertOk(rawGet("/health/queues", sharedTags("queue-health"), token), "queue health", 1800);
  assertOk(apiGet("/notifications?limit=25", token, sharedTags("notification-list")), "notification list", 2200);

  if (__ENV.PROCESS_QUEUE === "true") {
    assertOk(apiPost("/notifications/whatsapp/process", {}, token, sharedTags("queue-drain")), "queue drain", 4000);
  }

  pause(0.25, 1.5);
}
