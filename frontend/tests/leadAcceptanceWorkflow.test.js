import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("loan executive accept UI uses business and ownership eligibility instead of pending alone", () => {
  const page = fs.readFileSync(path.resolve(__dirname, "../src/pages/bank/LoanExecutiveLeadListPage.jsx"), "utf8");
  assert.match(page, /function canAcceptAssignedLead/);
  assert.match(page, /status === LEAD_STATUSES\.NEW/);
  assert.match(page, /lead\.accepted !== true/);
  assert.match(page, /belongsToUser/);
  assert.match(page, /ownershipStatus/);
  assert.match(page, /acceptanceDueAt/);
  assert.match(page, /applyLeadPatch\(response\.data\?\.lead/);
});

test("acceptance patches the visible row immediately and retains silent server reconciliation", () => {
  const hook = fs.readFileSync(path.resolve(__dirname, "../src/pages/bank/loanExecutive.hooks.js"), "utf8");
  assert.match(hook, /const applyLeadPatch = useCallback/);
  assert.match(hook, /return \{ rows, total, hasMore, loading, page, onPage, load, applyLeadPatch \}/);
  const page = fs.readFileSync(path.resolve(__dirname, "../src/pages/bank/LoanExecutiveLeadListPage.jsx"), "utf8");
  assert.match(page, /load\(page, \{ silent: true \}\)/);
});
