import { stages, sharedTags } from "./config.js";
import { apiGet, assertOk, enforceReadOnlySafety, handleSummary, loginAs, pause, requireToken } from "./helpers.js";

export const options = {
  stages: stages(),
  thresholds: {
    http_req_failed: ["rate<0.02"],
    "http_req_duration{area:dashboard}": ["p(95)<2000"],
    "http_req_duration{area:notifications}": ["p(95)<2000"],
    "http_req_duration{area:admin-dashboard}": ["p(95)<2500"],
    "http_req_duration{area:dealer-dashboard}": ["p(95)<2200"],
    "http_req_duration{area:bank-dashboard}": ["p(95)<2200"],
  },
};

export { handleSummary };

export function setup() {
  enforceReadOnlySafety();
  return {
    adminToken: loginAs("admin"),
    financeToken: loginAs("finance"),
    gmToken: loginAs("gm"),
    bankManagerToken: loginAs("bankManager"),
    executiveToken: loginAs("executive"),
  };
}

export default function (tokens) {
  const roleMix = [
    ["finance", tokens.financeToken, "/dealer/leads?limit=20", "dealer-dashboard"],
    ["gm", tokens.gmToken, "/gm/leads?limit=20", "gm-dashboard"],
    ["bankManager", tokens.bankManagerToken, "/bank/leads?limit=20", "bank-dashboard"],
    ["executive", tokens.executiveToken, "/bank/leads?limit=20", "executive-dashboard"],
    ["admin", tokens.adminToken, "/admin/leads?limit=20", "admin-dashboard"],
  ].filter(([, token]) => token);

  if (!roleMix.length && __ENV.AUTH_TOKEN) roleMix.push(["generic", __ENV.AUTH_TOKEN, "/dashboard/overview", "dashboard"]);
  const [label, token, listPath, area] = roleMix[__VU % roleMix.length] || [];
  requireToken(token, label || "dashboard");

  assertOk(apiGet("/dashboard/overview", token, sharedTags("dashboard")), `${label} overview`, 2200);
  assertOk(apiGet(listPath, token, sharedTags(area)), `${label} list`, 2500);
  assertOk(apiGet("/notifications?limit=20", token, sharedTags("notifications")), `${label} notifications`, 2200);
  pause();
}
