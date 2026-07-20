import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..", "..");

function indexSignatures() {
  const config = JSON.parse(fs.readFileSync(path.join(workspaceRoot, "firestore.indexes.json"), "utf8"));
  return new Set(config.indexes.map((item) => `${item.collectionGroup}:${item.fields.map((field) => `${field.fieldPath}:${field.order}`).join("|")}`));
}

test("Firestore indexes include scale-critical projection list contracts", () => {
  const signatures = indexSignatures();

  [
    "financeViews:viewType:ASCENDING|scopeId:ASCENDING|createdAt:DESCENDING",
    "gmViews:viewType:ASCENDING|scopeId:ASCENDING|createdAt:DESCENDING",
    "bankViews:viewType:ASCENDING|scopeId:ASCENDING|createdAt:DESCENDING",
    "executiveViews:viewType:ASCENDING|scopeId:ASCENDING|createdAt:DESCENDING",
    "staffViewProjection:dealershipId:ASCENDING|createdAt:DESCENDING",
    "memberViewProjection:dealershipId:ASCENDING|createdAt:DESCENDING",
    "executiveSummaryProjection:bankId:ASCENDING|createdAt:DESCENDING",
    "salespersonSummaryProjection:dealershipId:ASCENDING|createdAt:DESCENDING",
    "bankDealershipViews:viewType:ASCENDING|bankId:ASCENDING|lastLeadAt:DESCENDING",
  ].forEach((signature) => assert.equal(signatures.has(signature), true, `Missing index ${signature}`));
});

test("Firestore indexes include scale-critical background job contracts", () => {
  const signatures = indexSignatures();

  [
    "notificationEvents:status:ASCENDING|nextAttemptAt:ASCENDING",
    "subscriptionOrders:status:ASCENDING|createdAt:ASCENDING",
    "subscriptionPayments:dealershipId:ASCENDING|paidAt:DESCENDING",
    "subscriptionInvoices:dealershipId:ASCENDING|paymentDate:DESCENDING",
    "leads:assignmentStatus:ASCENDING|acceptanceDueAt:ASCENDING",
    "leads:assignmentStatus:ASCENDING|lastWorkflowActionAt:ASCENDING",
    "leads:status:ASCENDING|terminalVisibleUntil:ASCENDING",
    "subscriptionOrders:dealershipId:ASCENDING|createdAt:DESCENDING",
    "subscriptionPaymentFailures:dealershipId:ASCENDING|failedAt:DESCENDING",
    "subscriptionRefunds:dealershipId:ASCENDING|processedAt:DESCENDING",
  ].forEach((signature) => assert.equal(signatures.has(signature), true, `Missing index ${signature}`));
});
