import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(relativePath) {
  return fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("GET cache invalidation stays scoped to the active portal identity", () => {
  const cache = source("../src/services/apiCache.js");
  const invalidation = cache.slice(cache.indexOf("function invalidateGetCache"), cache.indexOf("return {", cache.indexOf("function invalidateGetCache")));
  assert.match(invalidation, /if \(!belongsToCurrentIdentity\(key\)\) continue;/);
});

test("idle status prefetch is cancellable and never fans out searched queries", () => {
  const instantData = source("../src/services/leadInstantData.js");
  assert.match(instantData, /String\(baseParams\.search \|\| ""\)\.trim\(\)/);
  assert.match(instantData, /cancelIdleCallback/);
  assert.match(instantData, /timers\.forEach\(\(timer\) => window\.clearTimeout\(timer\)\)/);
  assert.match(instantData, /!\["REJECTED", "DISBURSED"\]\.includes\(currentStatus\)/);
  [
    "../src/pages/dashboard/finance/financeLeadList.data.js",
    "../src/pages/dashboard/gm/gmTracking.data.js",
    "../src/pages/bank/bankManager.hooks.js",
    "../src/pages/bank/loanExecutive.hooks.js",
  ].forEach((file) => assert.match(source(file), /return scheduleLeadPrefetch\(/));
});
