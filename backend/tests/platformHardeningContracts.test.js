import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  REQUIRED_ASSIGNMENT_FIELDS,
  expectedLeadProjectionTargets,
  missingRequiredAssignmentFields,
} from "../services/assignmentIntegrity.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(workspaceRoot, relativePath), "utf8");
}

test("assignment integrity requires complete bank, executive, dealership, and finance ownership fields", () => {
  assert.deepEqual(REQUIRED_ASSIGNMENT_FIELDS, [
    "assignedBankId",
    "assignedBankName",
    "assignedExecutiveId",
    "assignedExecutiveEmail",
    "assignedExecutiveMobile",
    "assignedExecutiveName",
    "dealershipId",
    "financeManagerId",
  ]);

  const completeLead = {
    assignedBankId: "UCBA0002429",
    assignedBankName: "UCO Bank",
    assignedExecutiveId: "vikas@gmail.com",
    assignedExecutiveEmail: "vikas@gmail.com",
    assignedExecutiveMobile: "7854127844",
    assignedExecutiveName: "vikas",
    dealershipId: "dealer@example.com",
    financeManagerId: "fm-1",
  };
  assert.deepEqual(missingRequiredAssignmentFields(completeLead), []);
  assert.deepEqual(missingRequiredAssignmentFields({ ...completeLead, assignedExecutiveMobile: "" }), ["assignedExecutiveMobile"]);
  assert.deepEqual(missingRequiredAssignmentFields({
    assignedBankId: "UCBA0002429",
    assignedBank: "UCO Bank",
    assignedExecutive: "vikas",
    assignedExecutiveEmail: "vikas@gmail.com",
    executiveMobile: "7854127844",
    dealershipEmail: "dealer@example.com",
    financeManager: "fm-1",
  }), []);
});

test("assignment integrity projection targets cover every role-visible portal", () => {
  const targets = expectedLeadProjectionTargets({
    id: "lead-1",
    dealershipId: "dealer@example.com",
    assignedBankId: "UCBA0002429",
    assignedExecutiveId: "exec-id",
    assignedExecutiveEmail: "exec@example.com",
    assignedExecutiveMobile: "7854127844",
  });
  const signatures = targets.map((item) => `${item.collection}:${item.scopeType}:${item.scopeId}`);

  [
    "adminViews:admin:global",
    "financeViews:dealership:dealer@example.com",
    "gmViews:dealership:dealer@example.com",
    "bankViews:bank:UCBA0002429",
    "executiveViews:executive:exec-id",
    "executiveViews:executive:exec@example.com",
    "executiveViews:executive:7854127844",
    "leadDetailsProjection:detail:lead-1",
  ].forEach((signature) => assert.equal(signatures.includes(signature), true, `missing ${signature}`));
});

test("lead creation queues assignment failures and validates successful auto-assignment", () => {
  const source = read("backend/controllers/dealerLead.controller.js");

  assert.equal(source.includes("recordLeadAssignmentFailure"), true);
  assert.equal(source.includes("validateLeadAssignmentIntegrity(assignedLead"), true);
  assert.equal(source.includes("source: \"dealer-lead-auto-assignment\""), true);
});

test("assignment integrity job is available in scheduler and maintenance", () => {
  const scheduler = read("backend/services/scheduler.service.js");
  const maintenance = read("backend/scripts/runMaintenance.js");

  assert.equal(scheduler.includes("assignment-integrity"), true);
  assert.equal(scheduler.includes("15 * 60 * 1000"), true);
  assert.equal(scheduler.includes("validateRecentLeadDistribution"), true);
  assert.equal(maintenance.includes("\"assignment-integrity\""), true);
  assert.equal(maintenance.includes("\"lead-distribution\""), true);
});

test("audit action catalog covers final platform hardening events", () => {
  const auditSource = read("backend/services/audit.service.js");

  [
    "BANK_ASSIGNED",
    "EXECUTIVE_ASSIGNED",
    "ASSIGNMENT_FAILURE",
    "ASSIGNMENT_REPAIRED",
    "ORPHAN_LEAD_DETECTED",
    "PROJECTION_REPAIRED",
    "REALTIME_FAILURE",
    "UNAUTHORIZED_ACCESS",
  ].forEach((action) => assert.equal(auditSource.includes(action), true, `missing audit action ${action}`));
});
