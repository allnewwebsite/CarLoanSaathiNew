import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../services/leadQuery.service.js", import.meta.url), "utf8");

test("Dead Cases query no longer applies a reason filter", () => {
  assert.doesNotMatch(source, /query\.deadCaseReason/);
  assert.doesNotMatch(source, /query\.deadReason/);
  assert.doesNotMatch(source, /query\.filterReason/);
  assert.doesNotMatch(source, /field:\s*["']deadCaseReason["']/);
});
