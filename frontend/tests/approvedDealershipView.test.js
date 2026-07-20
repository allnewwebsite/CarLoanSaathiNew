import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("approved dealership navigation and detail loading use the canonical identity", async () => {
  const dashboard = await readFile(new URL("../src/pages/dashboard/SuperAdminDashboard.jsx", import.meta.url), "utf8");
  const detail = await readFile(new URL("../src/pages/dashboard/superAdmin/SuperAdminDealershipDetailPage.jsx", import.meta.url), "utf8");
  assert.match(dashboard, /item\.loginEmail \|\| item\.primaryGoogleEmail \|\| item\.id/);
  assert.match(detail, /api\.get\(`\/admin\/dealerships\/\$\{encodeURIComponent\(id\)\}`\)/);
  assert.doesNotMatch(detail, /pendingDealershipApprovals\.find/);
  assert.match(detail, /Back to Approved Dealerships/);
});
