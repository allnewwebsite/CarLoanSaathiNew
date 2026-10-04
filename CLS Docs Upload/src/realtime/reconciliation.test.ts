import { CASE_DETAIL_RECONCILIATION_EVENTS, CASE_LIST_RECONCILIATION_EVENTS, mergeFirstPage, REALTIME_RECONCILE_REQUIRED } from "./reconciliation";

test("case list reacts only to relevant business and recovery events", () => {
  ["LEAD_CREATED", "LEAD_STATUS_UPDATED", "DOCUMENT_UPLOADED", "DOCUMENT_REQUESTED", "DEAD_CASE_RESTORED"].forEach(event => {
    expect(CASE_LIST_RECONCILIATION_EVENTS.has(event)).toBe(true);
  });
  expect(CASE_LIST_RECONCILIATION_EVENTS.has("NOTIFICATION_CREATED")).toBe(false);
  expect(CASE_DETAIL_RECONCILIATION_EVENTS.has("DOCUMENT_UPLOADED")).toBe(true);
  expect(CASE_DETAIL_RECONCILIATION_EVENTS.has("DEAD_CASE_RESTORED")).toBe(true);
  expect(REALTIME_RECONCILE_REQUIRED).toBe("REALTIME_RECONCILE_REQUIRED");
});

test("first-page reconciliation preserves loaded pages and replaces duplicate rows with canonical data", () => {
  const existing = [{ id: "newer", caseId: "CLS-3" }, { id: "older", caseId: "CLS-2" }, { id: "oldest", caseId: "CLS-1" }];
  const refreshed = [{ id: "latest", caseId: "CLS-4" }, { id: "newer", caseId: "CLS-3", status: "UPDATED" }];
  expect(mergeFirstPage(existing, refreshed)).toEqual([
    { id: "latest", caseId: "CLS-4" }, { id: "newer", caseId: "CLS-3", status: "UPDATED" },
    { id: "older", caseId: "CLS-2" }, { id: "oldest", caseId: "CLS-1" },
  ]);
});
