import { stages } from "./config.js";
import { apiGet, assertOk, pause } from "./helpers.js";

export const options = {
  stages: stages(),
  thresholds: {
    http_req_failed: ["rate<0.02"],
    "http_req_duration{area:dashboard}": ["p(95)<2000"],
    "http_req_duration{area:notifications}": ["p(95)<2000"],
  },
};

const TOKEN = __ENV.AUTH_TOKEN || "";

export default function () {
  assertOk(apiGet("/dashboard/overview", TOKEN, { area: "dashboard" }), "dashboard overview");
  assertOk(apiGet("/notifications?limit=20", TOKEN, { area: "notifications" }), "notifications");
  pause();
}
