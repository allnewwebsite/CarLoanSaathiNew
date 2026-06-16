import assert from "node:assert/strict";
import test from "node:test";
import { pageResponse, paginationParams } from "../utils/pagination.js";

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
