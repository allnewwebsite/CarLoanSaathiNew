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
    "/admin/leads",
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
