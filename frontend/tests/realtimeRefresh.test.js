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
