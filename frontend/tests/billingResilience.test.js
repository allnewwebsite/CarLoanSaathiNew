import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const modal = fs.readFileSync(path.join(root, "src/components/PlanBillingModal.jsx"), "utf8");

test("Plan and Billing preserves plan access when optional history is partial", () => {
  assert.match(modal, /data\.history\?\.partial/);
  assert.match(modal, /some billing history is temporarily unavailable/i);
});

test("Plan and Billing exposes request correlation and retry for fatal loads", () => {
  assert.match(modal, /requestError\.response\?\.data\?\.requestId/);
  assert.match(modal, /onClick=\{load\}/);
  assert.match(modal, />Try Again</);
});
