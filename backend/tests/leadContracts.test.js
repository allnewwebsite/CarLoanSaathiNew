import assert from "node:assert/strict";
import test from "node:test";
import { pageResponse, paginationParams } from "../utils/pagination.js";
import { applyFilters } from "../controllers/bankShared.controller.js";

test("lead list pagination clamps unsafe limits", () => {
  assert.deepEqual(paginationParams({ limit: "500", page: "2" }), {
    limit: 100,
    cursor: null,
    page: 2,
  });
  assert.deepEqual(paginationParams({ limit: "0", cursor: " next " }, { defaultLimit: 20, maxLimit: 50 }), {
    limit: 1,
    cursor: "next",
    page: null,
  });
});

test("lead page response exposes the expected contract fields", () => {
  const response = pageResponse({
    data: [{ id: "lead-1" }],
    limit: 10,
    nextCursor: "cursor-1",
    total: 25,
  });

  assert.deepEqual(Object.keys(response).sort(), ["data", "hasMore", "limit", "nextCursor", "total"]);
  assert.equal(response.hasMore, true);
  assert.equal(response.total, 25);
  assert.deepEqual(response.data, [{ id: "lead-1" }]);
});

test("lead page response preserves explicit hasMore when a backend cannot expose a cursor", () => {
  const response = pageResponse({
    data: [{ id: "lead-1" }],
    limit: 1,
    nextCursor: null,
    hasMore: true,
    total: "2",
  });

  assert.equal(response.nextCursor, null);
  assert.equal(response.hasMore, true);
  assert.equal(response.total, 2);
});

test("lead page response omits non-finite totals and normalizes empty cursors", () => {
  const response = pageResponse({
    data: null,
    limit: 20,
    nextCursor: "",
    total: undefined,
    extra: { source: "projection" },
  });

  assert.deepEqual(response.data, []);
  assert.equal(response.nextCursor, null);
  assert.equal(response.hasMore, false);
  assert.equal("total" in response, false);
  assert.equal(response.source, "projection");
});

test("merged bank candidate lists never reintroduce terminal leads into active queues", () => {
  const leads = [
    { id: "active", status: "NEW" },
    { id: "rejected", status: "REJECTED", rejectionReason: "Missing documents" },
    { id: "disbursed", status: "DISBURSED", disbursementRemarks: "Completed" },
    { id: "dead", status: "NEW", isDeadCase: true },
  ];

  assert.deepEqual(applyFilters(leads, {}).map((lead) => lead.id), ["active"]);
  assert.deepEqual(applyFilters(leads, { status: "REJECTED", archiveTerminal: "1" }).map((lead) => lead.id), ["rejected"]);
  assert.deepEqual(applyFilters(leads, { status: "DISBURSED", archiveTerminal: "1" }).map((lead) => lead.id), ["disbursed"]);
});
