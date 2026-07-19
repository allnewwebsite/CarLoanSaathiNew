import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const srcDir = path.join(projectRoot, "src");

test("realtime lead mutations match every lead dashboard refresh filter", async () => {
  const source = await readFile(path.join(srcDir, "hooks", "useRealtimeRefresh.js"), "utf8");

  assert.match(source, /const leadRealtimeMutation = detail\?\.kind === "lead"/);
  [
    "/dealer/leads",
    "/gm/leads",
    "/bank/leads",
    "/loan-executive/leads",
    "/documents",
    "/timeline",
  ].forEach((prefix) => {
    assert.equal(source.includes(`"${prefix}"`), true);
  });
});

test("dead-case realtime patches preserve explicit restore state", async () => {
  const source = await readFile(path.join(srcDir, "hooks", "useRealtimeEntityPatch.js"), "utf8");

  assert.match(source, /hasExplicitDeadCaseState/);
  assert.match(source, /Object\.prototype\.hasOwnProperty\.call\(event\.data \|\| \{\}, "isDeadCase"\)/);
  assert.match(source, /event\.data\?\.isDeadCase === true/);
});

test("SSE client uses bounded dedupe, exact backoff, and patch-first lead tables", async () => {
  const constants = await readFile(path.join(srcDir, "services", "realtimeClient.constants.js"), "utf8");
  const client = await readFile(path.join(srcDir, "services", "realtimeClientCore.js"), "utf8");
  const refresh = await readFile(path.join(srcDir, "hooks", "useRealtimeRefresh.js"), "utf8");
  const executiveHooks = await readFile(path.join(srcDir, "pages", "bank", "loanExecutive.hooks.js"), "utf8");
  const executivePage = await readFile(path.join(srcDir, "pages", "bank", "LoanExecutiveLeadListPage.jsx"), "utf8");

  assert.match(constants, /RECONNECT_DELAYS_MS = \[2_000, 5_000, 10_000\]/);
  assert.match(client, /seenEventIds/);
  assert.match(client, /pagehide/);
  assert.match(client, /dispatchRealtimeLifecycle\("received"/);
  assert.match(refresh, /refreshOnMutation = true/);
  assert.match(executiveHooks, /refreshOnMutation: false/);
  assert.equal(executivePage.includes("console.log"), false);
});
