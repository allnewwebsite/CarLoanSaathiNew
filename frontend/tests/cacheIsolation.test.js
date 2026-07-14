import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const cacheSource = fs.readFileSync(new URL("../src/services/apiCache.js", import.meta.url), "utf8");

test("cached row lookup and patch helpers enforce the active portal identity", () => {
  assert.match(cacheSource, /function belongsToCurrentIdentity\(key\)/);
  assert.match(cacheSource, /requestPortalHeader\(\)/);
  assert.match(cacheSource, /authCacheIdentity\(\)/);

  const scopedChecks = cacheSource.match(/if \(!belongsToCurrentIdentity\(key\)\) continue;/g) || [];
  assert.ok(scopedChecks.length >= 3, "patch, item lookup, and row lookup must all reject foreign cache scopes");
});

test("dashboard pagination is URL-driven and does not manually duplicate effect loads", () => {
  const finance = fs.readFileSync(new URL("../src/pages/dashboard/finance/FinanceLeadListScreens.jsx", import.meta.url), "utf8");
  const gm = fs.readFileSync(new URL("../src/pages/dashboard/GmTrackingPanel.jsx", import.meta.url), "utf8");
  assert.match(finance, /const page = Math\.max\(Number\(params\.get\("page"\)/);
  assert.doesNotMatch(finance, /setParams\([^;]+;\s*loadLeads\(/s);
  assert.match(gm, /const page = pageFromParams\(params\)/);
  assert.doesNotMatch(gm, /setParams\([^;]+;\s*load\(/s);
});
