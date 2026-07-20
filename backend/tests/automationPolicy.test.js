import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LEAD_STATUSES } from "../utils/status.constants.js";
import {
  AUTOMATION_POLICY,
  acceptedAutomationPatch,
  assertLeadAcceptanceEligible,
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

test("acceptance records ownership without changing the business status", () => {
  const acceptedAt = "2026-01-01T12:00:00.000Z";
  const patch = acceptedAutomationPatch(acceptedAt, { id: "exec-1", email: "exec@example.com" });
  assert.equal(patch.assignmentStatus, "accepted");
  assert.equal(patch.ownershipStatus, "ACCEPTED");
  assert.equal(patch.accepted, true);
  assert.equal(patch.acceptedAt, acceptedAt);
  assert.equal(patch.acceptedBy, "exec@example.com");
  assert.equal(patch.acceptedExecutiveId, "exec-1");
  assert.equal(patch.acceptanceDueAt, null);
  assert.equal(patch.slaRunning, false);
  assert.equal(Object.hasOwn(patch, "status"), false);
});

test("only the assigned executive can accept a pending NEW lead before its SLA", () => {
  const lead = { status: LEAD_STATUSES.NEW, assignmentStatus: "pending", acceptanceDueAt: "2026-01-01T15:00:00.000Z" };
  assert.equal(assertLeadAcceptanceEligible({ lead, ownsLead: true, now: Date.parse("2026-01-01T12:00:00.000Z") }), true);
  assert.throws(() => assertLeadAcceptanceEligible({ lead, ownsLead: false, now: Date.parse("2026-01-01T12:00:00.000Z") }), /not assigned/i);
  assert.throws(() => assertLeadAcceptanceEligible({ lead: { ...lead, accepted: true }, ownsLead: true }), /already accepted/i);
  assert.throws(() => assertLeadAcceptanceEligible({ lead, ownsLead: true, now: Date.parse("2026-01-01T15:00:00.000Z") }), /SLA expired/i);
  assert.throws(() => assertLeadAcceptanceEligible({ lead: { ...lead, status: LEAD_STATUSES.REJECTED }, ownsLead: true }), /closed/i);
});

test("terminal statuses enter their archive location immediately", () => {
  const terminalAt = "2026-02-01T00:00:00.000Z";
  const rejected = { status: LEAD_STATUSES.REJECTED, ...statusAutomationPatch(LEAD_STATUSES.REJECTED, terminalAt) };
  assert.equal(rejected.workflowLocation, "rejected");
  assert.equal(rejected.archivedAt, terminalAt);
  assert.equal(currentWorkflowLocation(rejected, new Date(terminalAt).getTime()), "rejected");
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

test("automation scans deadline indexes instead of filtering broad status pages", () => {
  const engine = fs.readFileSync(path.resolve(__dirname, "../services/automationEngine.service.js"), "utf8");
  assert.match(engine, /scanDueLeads\("acceptanceDueAt"/);
  assert.match(engine, /scanDueLeads\("lastWorkflowActionAt"/);
  assert.match(engine, /scanDueLeads\("terminalVisibleUntil"/);
  assert.match(engine, /scanDueLeads\("retentionDueAt"/);
  assert.match(engine, /op:\s*"<="/);
  assert.doesNotMatch(engine, /scanDueLeads\([\s\S]{0,160}\.catch\(\(\) => \[\]\)/);
});

test("mark-all notifications uses a bulk write without per-item readbacks", () => {
  const service = fs.readFileSync(path.resolve(__dirname, "../services/notification.service.js"), "utf8");
  const markAll = service.slice(service.indexOf("export async function markAllNotificationsRead"));
  assert.match(markAll, /bulkUpsertRecords\("notifications", updatedItems\)/);
  assert.doesNotMatch(markAll.split("export async function", 2)[0], /visibleUnread\.map\(.*updateRecord/s);
});
