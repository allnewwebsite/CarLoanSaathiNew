import { stages } from "./config.js";
import { apiGet, apiPost, assertOk, pause } from "./helpers.js";

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

export default function () {
  assertOk(apiGet("/dealer/leads?page=1&limit=10", TOKEN, { area: "lead-list" }), "dealer leads");
  if (__ENV.CREATE_LEADS === "true") {
    assertOk(apiPost("/leads/create", leadPayload(), TOKEN, { area: "lead-create" }), "lead create");
  }
  pause();
}
