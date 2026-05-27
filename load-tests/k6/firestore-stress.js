import { stages, sharedTags } from "./config.js";
import { apiGet, assertOk, enforceReadOnlySafety, handleSummary, loginAs, pause, randomFrom, requireToken } from "./helpers.js";

const STATUS_VALUES = ["Disbursed", "Rejected With Reason", "Pending Documents", "Bank Process"];

export const options = {
  stages: stages(),
  thresholds: {
    http_req_failed: ["rate<0.02"],
    "http_req_duration{area:indexed-lead-query}": ["p(95)<1800", "p(99)<3500"],
    "http_req_duration{area:case-search}": ["p(95)<1200", "p(99)<2500"],
    "http_req_duration{area:metrics-read}": ["p(95)<1000", "p(99)<2000"],
  },
};

export { handleSummary };

export function setup() {
  enforceReadOnlySafety();
  return {
    token: __ENV.AUTH_TOKEN || loginAs(__ENV.ROLE || "finance"),
  };
}

export default function ({ token }) {
  requireToken(token, "firestore");

  const status = encodeURIComponent(__ENV.STATUS || randomFrom(STATUS_VALUES));
  const cursor = __ENV.CURSOR ? `&cursor=${encodeURIComponent(__ENV.CURSOR)}` : "";
  const caseId = __ENV.CASE_ID || "";

  assertOk(apiGet(`/dashboard/overview`, token, sharedTags("metrics-read")), "metrics read", 1500);
  assertOk(apiGet(`/leads?limit=25&status=${status}${cursor}`, token, sharedTags("indexed-lead-query")), "indexed lead query", 2200);
  if (caseId) {
    assertOk(apiGet(`/leads?limit=10&search=${encodeURIComponent(caseId)}`, token, sharedTags("case-search")), "case search", 1500);
  }
  pause(0.2, 1.5);
}
