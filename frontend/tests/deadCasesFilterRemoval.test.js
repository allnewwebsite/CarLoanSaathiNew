import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../src/pages/dashboard/DeadCasesPageCore.jsx", import.meta.url), "utf8");
const hook = fs.readFileSync(new URL("../src/pages/dashboard/deadCases.hooks.js", import.meta.url), "utf8");
const dialogs = fs.readFileSync(new URL("../src/pages/dashboard/DeadCaseDialogs.jsx", import.meta.url), "utf8");

test("Dead Cases has no reason filter UI or request state", () => {
  assert.doesNotMatch(page, /Select Reason/i);
  assert.doesNotMatch(page, /reasonFilter|setReasonFilter/);
  assert.doesNotMatch(hook, /reasonFilter|setReasonFilter/);
  assert.doesNotMatch(hook, /deadCaseReason\s*:/);
  assert.doesNotMatch(dialogs, /Select reason/i);
});
