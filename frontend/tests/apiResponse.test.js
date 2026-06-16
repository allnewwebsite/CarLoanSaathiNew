import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeApiError,
  normalizePagedResponse,
  normalizeRecord,
  normalizeRows,
} from "../src/services/apiResponse.js";

test("normalizes legacy raw array responses", () => {
  const rows = [{ id: "1" }, { id: "2" }];
  assert.deepEqual(normalizeRows({ data: rows }), rows);
  assert.deepEqual(normalizePagedResponse({ data: rows }), {
    data: rows,
    total: 2,
    limit: 0,
    nextCursor: null,
    hasMore: false,
    meta: {},
    raw: rows,
  });
});

test("normalizes paginated legacy objects", () => {
  const payload = { data: [{ id: "lead-1" }], total: 50, limit: 10, nextCursor: "abc" };
  const page = normalizePagedResponse({ data: payload });
  assert.equal(page.total, 50);
  assert.equal(page.limit, 10);
  assert.equal(page.nextCursor, "abc");
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.data, [{ id: "lead-1" }]);
});

test("normalizes cached paginated payloads without losing metadata", () => {
  const cached = { data: [{ id: "cached-lead" }], total: 7, limit: 5, hasMore: true };
  const page = normalizePagedResponse(cached);
  assert.equal(page.total, 7);
  assert.equal(page.limit, 5);
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.data, [{ id: "cached-lead" }]);
});

test("normalizes standard success envelope responses", () => {
  const payload = {
    success: true,
    data: [{ id: "bank-1" }],
    pagination: { limit: 20, hasMore: true, nextCursor: "next" },
    meta: { requestId: "req-1" },
  };
  const page = normalizePagedResponse({ data: payload });
  assert.deepEqual(normalizeRows({ data: payload }), [{ id: "bank-1" }]);
  assert.equal(page.limit, 20);
  assert.equal(page.hasMore, true);
  assert.equal(page.meta.requestId, "req-1");
});

test("normalizes records from raw and success-envelope responses", () => {
  assert.deepEqual(normalizeRecord({ data: { id: "x" } }), { id: "x" });
  assert.deepEqual(normalizeRecord({ data: { success: true, data: { id: "y" } } }), { id: "y" });
  assert.equal(normalizeRecord({ data: [] }, null), null);
});

test("normalizes API errors with backend request metadata", () => {
  const error = {
    code: "ERR_BAD_REQUEST",
    response: {
      status: 403,
      data: {
        errorCode: "PORTAL_FORBIDDEN",
        message: "Denied",
        requestId: "req-403",
      },
    },
  };
  assert.deepEqual(normalizeApiError(error), {
    status: 403,
    code: "PORTAL_FORBIDDEN",
    message: "Denied",
    requestId: "req-403",
    details: null,
  });
});
