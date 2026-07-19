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
  assert.match(hook, /return \{ rows, total, hasMore, loading, page, onPage, load, refreshLatest, applyLeadPatch \}/);
  const page = fs.readFileSync(path.resolve(__dirname, "../src/pages/bank/LoanExecutiveLeadListPage.jsx"), "utf8");
  assert.match(page, /refreshLatest\(page, \{ silent: true \}\)/);
});

test("loan executive lead refresh bypasses persistent GET cache on entry, focus, and realtime ownership events", () => {
  const cache = fs.readFileSync(path.resolve(__dirname, "../src/services/apiCache.js"), "utf8");
  const hook = fs.readFileSync(path.resolve(__dirname, "../src/pages/bank/loanExecutive.hooks.js"), "utf8");
  assert.match(cache, /config\?\.skipCache === true/);
  assert.match(hook, /skipCache: true/);
  assert.match(hook, /invalidateGetCache\(\{ prefix: "\/bank\/leads", purge: true \}\)/);
  assert.match(hook, /window\.addEventListener\("focus", refreshVisiblePage\)/);
  assert.match(hook, /window\.addEventListener\("cls:realtime-event", reconcileOwnership\)/);
  assert.match(hook, /"LEAD_ACCEPTED"/);
  assert.match(hook, /"EXECUTIVE_REASSIGNED"/);
  assert.match(hook, /freshRequestRef/);
});

test("accept action is disabled with a spinner and friendly errors while synchronization completes", () => {
  const page = fs.readFileSync(path.resolve(__dirname, "../src/pages/bank/LoanExecutiveLeadListPage.jsx"), "utf8");
  const start = page.indexOf("const acceptLead = async");
  const end = page.indexOf("const displayedLeads", start);
  const acceptance = page.slice(start, end);
  assert.match(page, /acceptingLeadId/);
  assert.match(page, /LoaderCircle/);
  assert.match(page, /Case already accepted\./);
  assert.match(page, /Case reassigned\./);
  assert.match(page, /Network error\./);
  assert.doesNotMatch(acceptance, /setStatusError\(error\.response\?\.data\?\.message/);
});
