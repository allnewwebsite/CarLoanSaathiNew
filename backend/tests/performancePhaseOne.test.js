import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function source(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, relativePath), "utf8");
}

test("loan executive list overlaps profile resolution with projection IO", () => {
  const controller = source("../controllers/lead.controller.js");
  assert.match(controller, /const \[projected, actor\] = await Promise\.all\(\[/);
  assert.match(controller, /identity:loan-executive:/);
  assert.match(controller, /queryExecutiveLeads\(\{ \.\.\.executiveQueryArgs\(actor\)/);
});

test("fast dashboard overlaps loan executive identity and recent projection IO", () => {
  const controller = source("../controllers/dashboard.controller.js");
  assert.match(controller, /const \[projected, actor\] = await Promise\.all\(\[/);
  assert.match(controller, /identity:loan-executive:/);
  assert.match(controller, /source: "projection\+canonical"/);
});
