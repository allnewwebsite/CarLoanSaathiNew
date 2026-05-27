import http from "k6/http";
import { API_BASE_URL, stages, sharedTags } from "./config.js";
import { assertOk, enforceWriteSafety, handleSummary, loginAs, pause, requireToken } from "./helpers.js";

export const options = {
  stages: stages(),
  thresholds: {
    http_req_failed: ["rate<0.03"],
    "http_req_duration{area:document-upload}": ["p(95)<5000", "p(99)<9000"],
  },
};

export { handleSummary };

export function setup() {
  enforceWriteSafety();
  return { token: __ENV.AUTH_TOKEN || loginAs("finance") };
}

export default function ({ token }) {
  requireToken(token, "upload");
  const leadId = __ENV.LEAD_ID || __ENV.CASE_ID;
  if (!leadId) return;

  const payload = {
    leadId,
    documentType: __ENV.DOCUMENT_TYPE || "PAN",
    document: http.file(
      "Load test document. This is synthetic test content only.\n",
      `load-test-${Date.now()}.txt`,
      "text/plain",
    ),
  };

  const response = http.post(`${API_BASE_URL}/documents/upload`, payload, {
    headers: { Authorization: `Bearer ${token}`, "X-Load-Test-Run": __ENV.RUN_ID || "k6-upload" },
    tags: sharedTags("document-upload"),
    timeout: "60s",
  });
  assertOk(response, "document upload", 7000);
  pause(1, 3);
}
