import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("lead acceptance is an atomic ownership change and never a business-status transition", () => {
  const controller = fs.readFileSync(path.resolve(__dirname, "../controllers/bankLeadWorkflow.controller.js"), "utf8");
  const start = controller.indexOf("export async function acceptBankLead");
  const end = controller.indexOf("export async function rejectBankLead", start);
  const acceptance = controller.slice(start, end);

  assert.match(acceptance, /runRecordTransaction/);
  assert.match(acceptance, /assertLeadAcceptanceEligible/);
  assert.match(acceptance, /loanExecutiveMatchesLead/);
  assert.match(acceptance, /LEAD_ACCEPTED/);
  assert.match(acceptance, /syncLeadProjection/);
  assert.doesNotMatch(acceptance, /assertValidStatusTransition/);
  assert.doesNotMatch(acceptance, /status:\s*LEAD_STATUSES\.ACCEPTED/);
});

test("ownership acceptance fields are available to every portal projection", () => {
  const projection = fs.readFileSync(path.resolve(__dirname, "../services/projectionShared.service.js"), "utf8");
  ["ownershipStatus", "accepted", "acceptedAt", "acceptedBy", "acceptedExecutiveId", "acceptanceDueAt", "slaRunning"]
    .forEach((field) => assert.match(projection, new RegExp(`\\b${field}\\b`)));
});
