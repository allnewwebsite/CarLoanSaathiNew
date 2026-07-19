import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { notificationDayBoundary } from "../services/cleanup.service.js";

const cleanup = fs.readFileSync(new URL("../services/cleanup.service.js", import.meta.url), "utf8");
const scheduler = fs.readFileSync(new URL("../services/scheduler.service.js", import.meta.url), "utf8");
const realtime = fs.readFileSync(new URL("../services/realtime.service.js", import.meta.url), "utf8");

test("notification day boundary uses backend India timezone rather than device time", () => {
  assert.deepEqual(notificationDayBoundary(new Date("2026-07-19T20:00:00.000Z")), {
    dayKey: "2026-07-20",
    cutoff: "2026-07-19T18:30:00.000Z",
    timeZone: "Asia/Kolkata",
  });
});

test("daily cleanup permanently bulk deletes only notification source and view documents", () => {
  assert.match(cleanup, /field: "createdAt", op: "<", value: cutoff/);
  assert.match(cleanup, /deleteRecordsByIds\("notifications"/);
  assert.match(cleanup, /projectionTargets/);
  assert.doesNotMatch(cleanup, /auditLogs|leads|payments|subscriptions/);
});

test("daily cleanup uses a distributed once-per-day claim and one existing scheduler", () => {
  assert.match(cleanup, /systemJobRuns/);
  assert.match(cleanup, /existing\?\.status === "COMPLETED"/);
  assert.match(scheduler, /jobId: `notification-cleanup-\$\{dayKey\}-\$\{executionBucket\}`/);
  assert.equal((scheduler.match(/schedule\("notification-cleanup"/g) || []).length, 1);
});

test("cleanup broadcasts authenticated realtime reconciliation", () => {
  assert.match(cleanup, /REALTIME_EVENTS\.NOTIFICATIONS_CLEANED/);
  assert.match(cleanup, /broadcastAllAuthenticated: true/);
  assert.match(realtime, /event\.data\?\.broadcastAllAuthenticated === true/);
});
