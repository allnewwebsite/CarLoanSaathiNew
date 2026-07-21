import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const src = path.join(process.cwd(), "src");

test("summary status rendering never merges a workflow status with case remarks", async () => {
  const [display, badge, financeDetail, executiveDetail] = await Promise.all([
    readFile(path.join(src, "utils", "portalDisplay.js"), "utf8"),
    readFile(path.join(src, "components", "StatusBadge.jsx"), "utf8"),
    readFile(path.join(src, "pages", "dashboard", "finance", "FinanceLeadDetailPage.jsx"), "utf8"),
    readFile(path.join(src, "pages", "bank", "LoanExecutiveLeadDetailPage.jsx"), "utf8"),
  ]);

  assert.doesNotMatch(display, /Loan Rejected:\s*\$\{/);
  assert.doesNotMatch(badge, /Location:/);
  assert.match(financeDetail, /\[\["Rejection Reason", lead\.rejectionReason/);
  assert.match(executiveDetail, /\[\["Rejection Reason", lead\.rejectionReason/);
});
