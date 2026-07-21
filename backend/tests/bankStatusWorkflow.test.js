import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../controllers/bankLeadWorkflow.controller.js", import.meta.url), "utf8");

test("bank status mutation enforces lifecycle transitions", () => {
  assert.match(workflow, /assertValidStatusTransition\(lead\.status, normalizedStatus\)/);
});

test("bank status synchronization failures are observable and return a retry state", () => {
  assert.match(workflow, /lead_status_projection_sync_failed/);
  assert.match(workflow, /syncLeadProjectionSoon\(updated\)/);
  assert.match(workflow, /synchronizationPending/);
});
