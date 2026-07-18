import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LEAD_STATUSES } from "../utils/status.constants.js";
import {
  AUTOMATION_POLICY,
  acceptedAutomationPatch,
  addCalendarMonths,
  assignmentAutomationPatch,
  currentWorkflowLocation,
  retentionDue,
  statusAutomationPatch,
} from "../services/automationPolicy.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("new assignments receive the five-hour acceptance SLA", () => {
  const assignedAt = "2026-01-01T10:00:00.000Z";
  const patch = assignmentAutomationPatch(assignedAt);
  assert.equal(patch.assignmentStatus, "pending");
  assert.equal(patch.acceptanceDueAt, "2026-01-01T15:00:00.000Z");
  assert.equal(AUTOMATION_POLICY.acceptanceSlaMs, 5 * 60 * 60 * 1000);
});

test("acceptance cancels the acceptance deadline and starts activity tracking", () => {
  const acceptedAt = "2026-01-01T12:00:00.000Z";
  assert.deepEqual(acceptedAutomationPatch(acceptedAt), {
    assignmentStatus: "accepted",
    acceptedAt,
    acceptanceDueAt: null,
    lastWorkflowActionAt: acceptedAt,
  });
});

test("terminal statuses remain active for seven days then move to their archive location", () => {
  const terminalAt = "2026-02-01T00:00:00.000Z";
  const rejected = { status: LEAD_STATUSES.REJECTED, ...statusAutomationPatch(LEAD_STATUSES.REJECTED, terminalAt) };
  assert.equal(currentWorkflowLocation(rejected, new Date("2026-02-07T23:59:59.999Z").getTime()), "active");
  assert.equal(currentWorkflowLocation(rejected, new Date("2026-02-08T00:00:00.000Z").getTime()), "rejected");
});

test("retention uses exactly three calendar months including month-end clamping", () => {
  assert.equal(addCalendarMonths("2026-01-31T10:30:00.000Z"), "2026-04-30T10:30:00.000Z");
  const lead = { status: LEAD_STATUSES.DISBURSED, terminalStatusAt: "2026-01-31T10:30:00.000Z" };
  assert.equal(retentionDue(lead, new Date("2026-04-30T10:29:59.999Z").getTime()), false);
  assert.equal(retentionDue(lead, new Date("2026-04-30T10:30:00.000Z").getTime()), true);
});

test("engine reuses the existing assignment, dead-case, queue, notification and projection services", () => {
  const engine = fs.readFileSync(path.resolve(__dirname, "../services/automationEngine.service.js"), "utf8");
  assert.match(engine, /reassignLeadToNextBranchExecutive/);
  assert.match(engine, /moveLeadToDeadCase/);
  assert.match(engine, /createNotification/);
  assert.match(engine, /removeLeadProjections/);
  assert.doesNotMatch(engine, /createRecord\(["'](?:automation|archive|deleted)/i);
});
