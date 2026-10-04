import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { FieldPath, Timestamp } from "firebase-admin/firestore";

// This test exercises the memory adapter and query-builder contract only.
// Empty values override dotenv-loaded credentials so it cannot contact Firestore.
process.env.FIREBASE_PROJECT_ID = "";
process.env.FIREBASE_CLIENT_EMAIL = "";
process.env.FIREBASE_PRIVATE_KEY = "";

const [{ applyStableFirestoreOrdering, encodeCursor, parseCursor, queryRecords, scanFirestoreSearchPages }, { memoryStore }] = await Promise.all([
  import("../services/firestoreQuery.service.js"),
  import("../services/firestoreShared.service.js"),
]);
const { queryExecutiveLeads } = await import("../services/leadQuery.service.js");

function collectionName() {
  return `cursorSynthetic_${crypto.randomUUID().replaceAll("-", "")}`;
}

function seed(collection, rows) {
  memoryStore[collection] = rows;
}

async function collectPages(collection, { limit, direction = "desc", orderBy = "createdAt" }) {
  const pages = [];
  let cursor = null;
  do {
    const page = await queryRecords(collection, { orderBy, direction, limit, cursor, maxLimit: 100 });
    pages.push(page);
    cursor = page.nextCursor;
  } while (cursor);
  return pages;
}

test("Firestore ordering uses the complete (ordered value, document ID) tuple", () => {
  const calls = [];
  const ref = {
    orderBy(field, direction) { calls.push(["orderBy", String(field), direction]); return this; },
    startAfter(...values) { calls.push(["startAfter", ...values]); return this; },
  };
  const ordered = applyStableFirestoreOrdering(ref, {
    orderBy: "createdAt",
    direction: "desc",
    cursor: { value: "2026-01-01T00:00:00.000Z", id: "lead-02" },
  });

  assert.equal(ordered, ref);
  assert.deepEqual(calls.slice(0, 2), [
    ["orderBy", "createdAt", "desc"],
    ["orderBy", String(FieldPath.documentId()), "desc"],
  ]);
  assert.deepEqual(calls[2], ["startAfter", "2026-01-01T00:00:00.000Z", "lead-02"]);
});

test("two tied lead timestamps paginate without duplicates or omissions", async () => {
  const collection = collectionName();
  seed(collection, [
    { id: "lead-a", createdAt: "2026-04-01T10:00:00.000Z" },
    { id: "lead-b", createdAt: "2026-04-01T10:00:00.000Z" },
  ]);

  const pages = await collectPages(collection, { limit: 1 });
  assert.deepEqual(pages.map((page) => page.data.map((row) => row.id)), [["lead-b"], ["lead-a"]]);
  assert.equal(pages[1].nextCursor, null);
});

test("ten tied timestamps produce stable page one, page two, and page three", async () => {
  const collection = collectionName();
  seed(collection, Array.from({ length: 10 }, (_, index) => ({
    id: `lead-${String(index + 1).padStart(2, "0")}`,
    createdAt: "2026-05-01T12:00:00.000Z",
  })));

  const first = await queryRecords(collection, { limit: 4, maxLimit: 100 });
  const firstAgain = await queryRecords(collection, { limit: 4, maxLimit: 100 });
  const second = await queryRecords(collection, { limit: 4, cursor: first.nextCursor, maxLimit: 100 });
  const third = await queryRecords(collection, { limit: 4, cursor: second.nextCursor, maxLimit: 100 });
  const allIds = [...first.data, ...second.data, ...third.data].map((row) => row.id);

  assert.deepEqual(first.data.map((row) => row.id), ["lead-10", "lead-09", "lead-08", "lead-07"]);
  assert.deepEqual(second.data.map((row) => row.id), ["lead-06", "lead-05", "lead-04", "lead-03"]);
  assert.deepEqual(third.data.map((row) => row.id), ["lead-02", "lead-01"]);
  assert.equal(first.nextCursor, firstAgain.nextCursor);
  assert.equal(third.nextCursor, null);
  assert.equal(new Set(allIds).size, 10);
  assert.equal(allIds.length, 10);
});

test("ascending and descending cursors preserve the full deterministic order", async () => {
  const collection = collectionName();
  seed(collection, [
    { id: "lead-c", createdAt: "2026-06-02" },
    { id: "lead-a", createdAt: "2026-06-01" },
    { id: "lead-b", createdAt: "2026-06-01" },
    { id: "lead-d", createdAt: "2026-06-03" },
  ]);

  const descending = await collectPages(collection, { limit: 2 });
  const ascending = await collectPages(collection, { limit: 2, direction: "asc" });
  assert.deepEqual(descending.flatMap((page) => page.data.map((row) => row.id)), ["lead-d", "lead-c", "lead-b", "lead-a"]);
  assert.deepEqual(ascending.flatMap((page) => page.data.map((row) => row.id)), ["lead-a", "lead-b", "lead-c", "lead-d"]);
});

test("missing ordered fields are excluded, null values remain pageable, and legacy cursors fail closed", async () => {
  const collection = collectionName();
  seed(collection, [
    { id: "legacy-a" },
    { id: "legacy-b", createdAt: null },
    { id: "dated-a", createdAt: "2026-01-01" },
    { id: "dated-b", createdAt: "2026-01-01" },
  ]);

  const first = await queryRecords(collection, { limit: 2, maxLimit: 100 });
  const second = await queryRecords(collection, { limit: 2, cursor: first.nextCursor, maxLimit: 100 });
  assert.deepEqual(first.data.map((row) => row.id), ["dated-b", "dated-a"]);
  assert.deepEqual(second.data.map((row) => row.id), ["legacy-b"]);
  assert.equal(second.nextCursor, null);
  assert.ok(first.nextCursor);

  const legacyToken = Buffer.from(JSON.stringify({ value: "2026-01-01", id: "dated-a" })).toString("base64url");
  assert.throws(() => parseCursor(legacyToken), { code: "INVALID_PAGINATION_CURSOR", status: 400 });
});

test("empty, exactly-full final, and short final pages return correct cursors", async () => {
  const emptyCollection = collectionName();
  seed(emptyCollection, []);
  const empty = await queryRecords(emptyCollection, { limit: 2, maxLimit: 100 });
  assert.deepEqual(empty.data, []);
  assert.equal(empty.nextCursor, null);

  const exactCollection = collectionName();
  seed(exactCollection, [
    { id: "lead-d", createdAt: "2026-07-01" },
    { id: "lead-c", createdAt: "2026-07-01" },
    { id: "lead-b", createdAt: "2026-07-01" },
    { id: "lead-a", createdAt: "2026-07-01" },
  ]);
  const exact = await queryRecords(exactCollection, { limit: 2, maxLimit: 100 });
  assert.equal(exact.data.length, 2);
  assert.ok(exact.nextCursor);
  const exactFinal = await queryRecords(exactCollection, { limit: 2, cursor: exact.nextCursor, maxLimit: 100 });
  assert.equal(exactFinal.data.length, 2);
  assert.equal(exactFinal.nextCursor, null);

  const shortCollection = collectionName();
  seed(shortCollection, [{ id: "only-lead", createdAt: "2026-07-01" }]);
  const short = await queryRecords(shortCollection, { limit: 2, maxLimit: 100 });
  assert.equal(short.data.length, 1);
  assert.equal(short.nextCursor, null);
});

test("timestamp cursor values round-trip without losing Firestore Timestamp type", () => {
  const timestamp = Timestamp.fromMillis(1_780_000_000_123);
  const token = encodeCursor({ id: "lead-timestamp", createdAt: timestamp }, "createdAt", "desc", "a".repeat(64));
  const parsed = parseCursor(token);
  assert.deepEqual(parsed, {
    v: 2,
    orderBy: "createdAt",
    direction: "desc",
    queryHash: "a".repeat(64),
    value: { _seconds: timestamp.seconds, _nanoseconds: timestamp.nanoseconds },
    id: "lead-timestamp",
  });
});

test("malformed, old-v2, ordering-changed, and filter-changed cursors fail closed", async () => {
  const collection = collectionName();
  seed(collection, [
    { id: "case-2", tenantId: "tenant-a", createdAt: "2026-08-02", label: "needle" },
    { id: "case-1", tenantId: "tenant-a", createdAt: "2026-08-01", label: "needle" },
    { id: "case-0", tenantId: "tenant-b", createdAt: "2026-08-03", label: "needle" },
  ]);
  const where = [{ field: "tenantId", value: "tenant-a" }];
  const first = await queryRecords(collection, { where, limit: 1, maxLimit: 100, search: "needle", searchFields: ["label"] });
  assert.ok(first.nextCursor);
  const rejectsCursor = (options) => assert.rejects(
    queryRecords(collection, { ...options, cursor: first.nextCursor, limit: 1, maxLimit: 100 }),
    { code: "INVALID_PAGINATION_CURSOR", status: 400 },
  );
  await rejectsCursor({ where: [{ field: "tenantId", value: "tenant-b" }], search: "needle", searchFields: ["label"] });
  await rejectsCursor({ where, search: "different", searchFields: ["label"] });
  await rejectsCursor({ where, search: "needle", searchFields: ["label"], orderBy: "updatedAt" });
  await assert.rejects(queryRecords(collection, { cursor: "not-a-cursor", limit: 1 }), { code: "INVALID_PAGINATION_CURSOR", status: 400 });

  const oldV2 = Buffer.from(JSON.stringify({ v: 2, orderBy: "createdAt", direction: "desc", value: "2026-08-02", id: "case-2" })).toString("base64url");
  await assert.rejects(queryRecords(collection, { cursor: oldV2, limit: 1 }), { code: "INVALID_PAGINATION_CURSOR", status: 400 });
});

test("Firestore substring search scans beyond nonmatching batches and finds final matches", async () => {
  const records = [
    { id: "row-5", createdAt: "2026-10-05", name: "no match" },
    { id: "row-4", createdAt: "2026-10-04", name: "no match" },
    { id: "row-3", createdAt: "2026-10-03", name: "needle first" },
    { id: "row-2", createdAt: "2026-10-02", name: "no match" },
    { id: "row-1", createdAt: "2026-10-01", name: "needle last" },
  ];
  const docs = records.map((record) => ({
    id: record.id,
    data: () => ({ ...record }),
    get: (field) => record[field],
  }));
  const fetchPage = async (cursor, limit) => {
    let start = 0;
    if (cursor) start = docs.findIndex((doc) => doc.id === cursor.id) + 1;
    return { docs: docs.slice(start, start + limit), size: Math.min(limit, docs.length - start) };
  };
  const first = await scanFirestoreSearchPages({ fetchPage, search: "needle", searchFields: ["name"], limit: 1, orderBy: "createdAt", scanLimit: 2 });
  assert.deepEqual(first.docs.map((doc) => doc.id), ["row-3", "row-1"]);
  assert.equal(first.size, 5);

  const final = await scanFirestoreSearchPages({
    fetchPage: async (cursor, limit) => {
      const remaining = docs.slice(cursor ? docs.findIndex((doc) => doc.id === cursor.id) + 1 : 0);
      return { docs: remaining.slice(0, limit), size: Math.min(limit, remaining.length) };
    },
    search: "needle last", searchFields: ["name"], limit: 1, orderBy: "createdAt", scanLimit: 2,
  });
  assert.deepEqual(final.docs.map((doc) => doc.id), ["row-1"]);
});

test("Loan Executive merged pagination advances by one deterministic cross-identity boundary", async () => {
  memoryStore.leads = [
    { id: "lead-a", createdAt: "2026-09-01", status: "NEW", assignedExecutiveId: "exec-cursor-test" },
    { id: "lead-b", createdAt: "2026-09-01", status: "NEW", assignedExecutiveId: "exec-cursor-test" },
    { id: "lead-c", createdAt: "2026-09-01", status: "NEW", assignedExecutiveEmail: "cursor-test@example.invalid" },
    { id: "lead-d", createdAt: "2026-09-01", status: "NEW", assignedExecutiveEmail: "cursor-test@example.invalid" },
  ];
  const args = { executiveId: "exec-cursor-test", executiveEmail: "cursor-test@example.invalid", query: { limit: 2 } };
  const first = await queryExecutiveLeads(args);
  const second = await queryExecutiveLeads({ ...args, query: { ...args.query, cursor: first.nextCursor } });
  const ids = [...first.data, ...second.data].map((lead) => lead.id);
  assert.deepEqual(first.data.map((lead) => lead.id), ["lead-d", "lead-c"]);
  assert.deepEqual(second.data.map((lead) => lead.id), ["lead-b", "lead-a"]);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set(ids).size, 4);
  await assert.rejects(
    queryExecutiveLeads({ ...args, executiveEmail: "changed@example.invalid", query: { ...args.query, cursor: first.nextCursor } }),
    { code: "INVALID_PAGINATION_CURSOR", status: 400 },
  );
});
