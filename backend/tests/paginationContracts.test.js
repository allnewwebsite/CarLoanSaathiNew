import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { listRecords } from "../services/firestore.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(workspaceRoot, relativePath), "utf8");
}

function includesAll(source, snippets, label) {
  snippets.forEach((snippet) => assert.equal(source.includes(snippet), true, `${label} missing ${snippet}`));
}

test("production blocks every unbounded Firestore list scan by default", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllow = process.env.ALLOW_FIRESTORE_FULL_SCAN;
  process.env.NODE_ENV = "production";
  delete process.env.ALLOW_FIRESTORE_FULL_SCAN;
  try {
    await assert.rejects(
      () => listRecords("smallSecondaryCollection"),
      (error) => {
        assert.equal(error.code, "UNBOUNDED_FIRESTORE_READ_DISABLED");
        assert.equal(error.status, 400);
        return true;
      },
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousAllow === undefined) delete process.env.ALLOW_FIRESTORE_FULL_SCAN;
    else process.env.ALLOW_FIRESTORE_FULL_SCAN = previousAllow;
  }
});

test("secondary list APIs keep bounded pagination contracts", () => {
  includesAll(read("backend/services/notification.service.js"), [
    "paginationParams(query)",
    "queryRecords(\"notifications\"",
    "cursor",
    "pageResponse",
  ], "notifications pagination");

  includesAll(read("backend/services/timeline.service.js"), [
    "queryTimelineProjection",
    "limit: 100",
    "projectionOnly: true",
    "queryRecords(\"leadTimeline\"",
    "canReadScopedTimeline({ event, lead, actor })",
  ], "timeline pagination");

  includesAll(read("backend/services/subscriptionBilling.service.js"), [
    "queryRecords(\"subscriptionPayments\"",
    "queryRecords(\"subscriptionInvoices\"",
    "maxLimit: 50",
    "cursor",
  ], "billing pagination");

  includesAll(read("backend/controllers/adminApprovalLists.controller.js"), [
    "queryRecords(collection",
    "\"approvedDealerships\" : \"pendingDealershipApprovals\"",
    "queryRecords(\"pendingBankApprovals\"",
    "maxLimit: 100",
    "cursor: query.cursor || null",
  ], "admin approval pagination");

  includesAll(read("backend/services/projectionStaff.service.js"), [
    "queryRecords(\"staffViewProjection\"",
    "queryRecords(\"memberViewProjection\"",
    "queryRecords(\"executiveSummaryProjection\"",
    "queryRecords(\"salespersonSummaryProjection\"",
    "maxLimit: 100",
  ], "staff projection pagination");

  includesAll(read("backend/services/projectionBankDealership.service.js"), [
    "queryRecords(\"bankDealershipViews\"",
    "getRecordsByIds(\"dealerships\"",
    "canonicalizeBankDealershipRows",
    "paginationParams",
    "pageResponse",
    "maxLimit: 100",
  ], "bank dealership pagination");
});
