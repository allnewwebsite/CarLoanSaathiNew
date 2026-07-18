import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, "../src");
const router = fs.readFileSync(path.join(src, "routes/router.jsx"), "utf8");
const nav = fs.readFileSync(path.join(src, "layouts/DashboardLayout.config.js"), "utf8");
const statuses = fs.readFileSync(path.join(src, "constants/status.js"), "utf8");

test("every operational portal exposes dedicated rejected and disbursed pages", () => {
  for (const portal of ["gm", "finance", "bank-manager", "loan-executive", "admin"]) {
    assert.match(nav, new RegExp(`/${portal}/rejected`));
    assert.match(nav, new RegExp(`/${portal}/disbursed`));
  }
  assert.doesNotMatch(nav, /status\?status=(?:REJECTED|DISBURSED)/);
  assert.match(router, /mode="rejected"/);
  assert.match(router, /mode="disbursed"/);
});

test("active Status tabs exclude rejected and disbursed lifecycle archives", () => {
  const currentWorkflow = statuses.match(/CURRENT_WORKFLOW_STATUS_OPTIONS\s*=\s*\[([\s\S]*?)\];/)?.[1] || "";
  assert.doesNotMatch(currentWorkflow, /REJECTED/);
  assert.doesNotMatch(currentWorkflow, /DISBURSED/);
});

test("archive pages share one retention banner and existing archive API filter", () => {
  const header = fs.readFileSync(path.join(src, "components/LifecycleArchiveHeader.jsx"), "utf8");
  assert.match(header, /Archive Retention Policy/);
  assert.match(header, /3 calendar months/);
  assert.match(header, /cannot be reversed/);
  for (const relative of [
    "pages/dashboard/finance/FinanceLeadListScreens.jsx",
    "pages/dashboard/GmTrackingPanel.jsx",
    "pages/bank/LoanExecutiveLeadListPage.jsx",
    "pages/dashboard/superAdmin/useAdminPanelData.js",
  ]) {
    assert.match(fs.readFileSync(path.join(src, relative), "utf8"), /archiveTerminal/);
  }
  assert.match(fs.readFileSync(path.join(src, "pages/bank/BankLeadListPages.jsx"), "utf8"), /useBankLeads\(debouncedSearch, status, "1"\)/);
  assert.match(fs.readFileSync(path.join(src, "pages/bank/bankManager.hooks.js"), "utf8"), /archiveTerminal/);
});

test("Dead Cases reuses the shared blue policy banner with its own lifecycle copy", () => {
  const header = fs.readFileSync(path.join(src, "components/LifecycleArchiveHeader.jsx"), "utf8");
  const deadCases = fs.readFileSync(path.join(src, "pages/dashboard/DeadCasesPageCore.jsx"), "utf8");
  assert.match(header, /export function PolicyInformationBanner/);
  assert.match(deadCases, /<PolicyInformationBanner/);
  assert.match(deadCases, /Dead Case Policy/);
  assert.match(deadCases, /no status update for 7 calendar days/);
  assert.match(deadCases, /must create a completely new case/);
});

test("More is session-local, collapsed by default, and route-expanded only for archive pages", () => {
  const layout = fs.readFileSync(path.join(src, "layouts/DashboardLayoutCore.jsx"), "utf8");
  assert.match(layout, /useState\(\(\) => isLifecycleArchivePath\(window\.location\.pathname\)\)/);
  assert.match(layout, /setMoreOpen\(isLifecycleArchivePath\(location\.pathname\)\)/);
  assert.doesNotMatch(layout, /localStorage\.(?:getItem|setItem)\([^\n]*more/i);
});
