import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("approved dealership detail resolves canonical and legacy identifiers", async () => {
  const controller = await readFile(new URL("../controllers/adminDealer.controller.js", import.meta.url), "utf8");
  const routes = await readFile(new URL("../routes/admin.routes.js", import.meta.url), "utf8");
  const lists = await readFile(new URL("../controllers/adminApprovalLists.controller.js", import.meta.url), "utf8");
  assert.match(routes, /router\.get\("\/dealerships\/:id", getApprovedDealershipDetails\)/);
  assert.match(controller, /resolveDealershipApprovalRequest\(requestedId\)/);
  assert.match(controller, /getRecord\("approvedDealerships", canonicalId\)/);
  assert.match(controller, /getDealershipBankTieUps\(canonicalId\)/);
  assert.match(controller, /APPROVED_DEALERSHIP_NOT_FOUND/);
  assert.match(lists, /status === "approved" \? "approvedDealerships" : "pendingDealershipApprovals"/);
});
