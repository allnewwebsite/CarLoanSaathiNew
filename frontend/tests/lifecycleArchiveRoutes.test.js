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

test("operational workflow portals retain rejected and disbursed while Super Admin archives are removed", () => {
  for (const portal of ["gm", "finance", "bank-manager", "loan-executive"]) {
    assert.match(nav, new RegExp(`/${portal}/rejected`));
    assert.match(nav, new RegExp(`/${portal}/disbursed`));
  }
  assert.doesNotMatch(nav, /\/admin\/(?:rejected|disbursed|leads)/);
  assert.doesNotMatch(router, /path: "(?:leads|rejected|disbursed)"[\s\S]{0,80}SuperAdminDashboard/);
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

test("More is session-local, collapsed by default, and route-expanded for every archive page", () => {
  const layout = fs.readFileSync(path.join(src, "layouts/DashboardLayoutCore.jsx"), "utf8");
  assert.match(layout, /dead-cases\|rejected\|disbursed/);
  assert.match(layout, /useState\(\(\) => isLifecycleArchivePath\(window\.location\.pathname\)\)/);
  assert.match(layout, /setMoreOpen\(isLifecycleArchivePath\(location\.pathname\)\)/);
  assert.doesNotMatch(layout, /localStorage\.(?:getItem|setItem)\([^\n]*more/i);
});

test("Dead Cases is grouped once under More for every operational portal", () => {
  for (const [role, prefix] of [["gm", "gm"], ["finance-desk", "finance"], ["bank-manager", "bank-manager"], ["loan-executive", "loan-executive"]]) {
    const section = nav.match(new RegExp(`"${role}": \\[([\\s\\S]*?)\\n  \\],`))?.[1] || "";
    assert.equal((section.match(new RegExp(`/${prefix}/dead-cases`, "g")) || []).length, 1);
    const more = section.slice(section.indexOf('{ label: "More"'));
    assert.ok(more.indexOf("Dead Cases") < more.indexOf("Rejected"));
    assert.ok(more.indexOf("Rejected") < more.indexOf("Disbursed"));
  }
});
