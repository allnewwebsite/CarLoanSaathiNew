import { stages } from "./config.js";
import { apiGet, assertOk, pause, rawGet } from "./helpers.js";

export const options = {
  stages: stages(),
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<1500", "p(99)<3000"],
  },
};

export default function () {
  assertOk(rawGet("/health", { area: "health" }), "health");
  assertOk(apiGet("/banks", null, { area: "catalog" }), "catalog banks");
  pause();
}
