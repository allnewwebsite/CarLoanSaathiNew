import { stages, sharedTags } from "./config.js";
import { apiGet, assertOk, backendLogin, enforceReadOnlySafety, firebaseEmailLogin, handleSummary, pause, requireToken } from "./helpers.js";

export const options = {
  stages: stages(),
  thresholds: {
    http_req_failed: ["rate<0.02"],
    "http_req_duration{area:firebase-auth}": ["p(95)<2500", "p(99)<5000"],
    "http_req_duration{area:backend-auth}": ["p(95)<500", "p(99)<1000"],
    "http_req_duration{area:session-validation}": ["p(95)<1500", "p(99)<3000"],
  },
};

export { handleSummary };

export default function () {
  enforceReadOnlySafety();

  const email = __ENV.AUTH_EMAIL || __ENV.FINANCE_EMAIL || __ENV.ADMIN_EMAIL || "";
  const password = __ENV.AUTH_PASSWORD || __ENV.FINANCE_PASSWORD || __ENV.ADMIN_PASSWORD || "";
  const portal = __ENV.AUTH_PORTAL || "dealer";

  let token = __ENV.AUTH_TOKEN || "";
  if (!token) {
    const idToken = firebaseEmailLogin(email, password);
    token = idToken ? backendLogin(idToken, portal) : "";
  }

  requireToken(token, "auth");
  assertOk(apiGet("/auth/session", token, sharedTags("session-validation")), "session validation", 1800);
  pause(0.2, 1);
}
