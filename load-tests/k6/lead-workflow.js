import { stages, sharedTags } from "./config.js";
import { apiGet, apiPatch, apiPost, assertOk, enforceReadOnlySafety, enforceWriteSafety, handleSummary, loginAs, parseJson, pause, requireToken } from "./helpers.js";

export const options = {
  stages: stages(),
  thresholds: {
    http_req_failed: ["rate<0.03"],
    "http_req_duration{area:lead-create}": ["p(95)<2500"],
    "http_req_duration{area:lead-list}": ["p(95)<2000"],
  },
};

const TOKEN = __ENV.AUTH_TOKEN || "";

function leadPayload() {
  const id = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  return {
    fullName: `Load Test Customer ${id}`,
    mobile: `9${String(Math.floor(Math.random() * 1000000000)).padStart(9, "0")}`,
    city: "Load Test City",
    preferredBank: "Load Test Bank",
    carPrice: 900000,
    loanAmount: 650000,
    salespersonId: __ENV.SALESPERSON_ID || "load-test-salesperson",
  };
}

export function setup() {
  if (__ENV.CREATE_LEADS === "true" || __ENV.UPDATE_STATUS === "true") enforceWriteSafety();
  else enforceReadOnlySafety();
  return {
    financeToken: TOKEN || loginAs("finance"),
    executiveToken: __ENV.EXECUTIVE_TOKEN || loginAs("executive"),
  };
}

export default function ({ financeToken, executiveToken }) {
  const token = financeToken;
  requireToken(token, "finance");

  const listResponse = apiGet("/dealer/leads?limit=10", token, sharedTags("lead-list"));
  assertOk(listResponse, "dealer leads", 2200);

  if (__ENV.CREATE_LEADS === "true") {
    assertOk(apiPost("/leads/create", leadPayload(), token, sharedTags("lead-create")), "lead create", 3000);
  }

  if (__ENV.UPDATE_STATUS === "true") {
    const lead = parseJson(listResponse)?.data?.[0] || parseJson(listResponse)?.leads?.[0];
    const leadId = lead?.caseId || lead?.id;
    if (leadId) {
      assertOk(apiPatch(`/bank/leads/${leadId}/status`, {
        status: "Bank Process",
        remarks: "Load test status touch",
      }, executiveToken, sharedTags("status-update")), "status update", 3000);
    }
  }
  pause();
}

export { handleSummary };
