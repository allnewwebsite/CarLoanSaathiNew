import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const backendRoot = process.cwd();

test("dealer staff permanent delete clears staff cache, projection, auth, and realtime", async () => {
  const controllerSource = await readFile(path.join(backendRoot, "controllers", "dealerStaff.controller.js"), "utf8");
  const sharedSource = await readFile(path.join(backendRoot, "controllers", "dealerShared.controller.js"), "utf8");
  const projectionSource = await readFile(path.join(backendRoot, "services", "projectionStaff.service.js"), "utf8");
  const realtimeEventsSource = await readFile(path.join(backendRoot, "services", "realtimeEvents.service.js"), "utf8");
  const realtimeSource = await readFile(path.join(backendRoot, "services", "realtime.service.js"), "utf8");

  assert.match(controllerSource, /function staffProjectionId/);
  assert.match(controllerSource, /deleteRecord\("staffViewProjection", id\)/);
  assert.match(controllerSource, /deleteStaffProjectionRecords\(\{ dealershipEmail, email, employee \}\)/);
  assert.match(controllerSource, /runDealerLeadSideEffects\("dealer-staff-created"/);
  assert.match(controllerSource, /projected\.filter\(\(row\) => !removedStaffRecord\(row\)\)/);
  assert.match(sharedSource, /export function removedStaffRecord/);
  assert.match(projectionSource, /function liveStaffProjectionRows/);
  assert.match(projectionSource, /deleteRecord\("staffViewProjection", row\.id\)/);
  assert.match(controllerSource, /clearCachedValue\(`dealer:staff:\$\{dealershipEmail\}:`\)/);
  assert.match(controllerSource, /clearIdentityCaches\(\{ uid: employee\.uid \|\| employee\.authAccountId, email \}\)/);
  assert.match(controllerSource, /revokeUserSessions\(email, "dealer-staff-permanent-delete"\)/);
  assert.match(controllerSource, /firebaseAdmin\.auth\(\)\.deleteUser\(firebaseUser\.uid\)/);
  assert.match(controllerSource, /eventType: REALTIME_EVENTS\.STAFF_CHANGED/);
  assert.match(realtimeEventsSource, /STAFF_CHANGED: "STAFF_CHANGED"/);
  assert.match(realtimeSource, /eventType\.includes\("STAFF"\)\) return "staff"/);
});
