import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const backendRoot = process.cwd();

test("dealer staff permanent delete clears staff cache, projection, auth, and realtime", async () => {
  const controllerSource = await readFile(path.join(backendRoot, "controllers", "dealerStaff.controller.js"), "utf8");
  const realtimeEventsSource = await readFile(path.join(backendRoot, "services", "realtimeEvents.service.js"), "utf8");
  const realtimeSource = await readFile(path.join(backendRoot, "services", "realtime.service.js"), "utf8");

  assert.match(controllerSource, /deleteRecordsByQuery\("staffViewProjection"/);
  assert.match(controllerSource, /clearCachedValue\(`dealer:staff:\$\{dealershipEmail\}:`\)/);
  assert.match(controllerSource, /revokeUserSessions\(email, "dealer-staff-permanent-delete"\)/);
  assert.match(controllerSource, /firebaseAdmin\.auth\(\)\.deleteUser\(firebaseUser\.uid\)/);
  assert.match(controllerSource, /eventType: REALTIME_EVENTS\.STAFF_CHANGED/);
  assert.match(realtimeEventsSource, /STAFF_CHANGED: "STAFF_CHANGED"/);
  assert.match(realtimeSource, /eventType\.includes\("STAFF"\)\) return "staff"/);
});
