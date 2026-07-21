import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd(), "src");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("export functionality is absent from active platform source", () => {
  const files = [
    "pages/dashboard/DeadCasesPageCore.jsx",
    "pages/dashboard/deadCases.helpers.js",
    "pages/dashboard/deadCases.columns.jsx",
    "pages/dashboard/SuperAdminDashboard.jsx",
    "pages/dashboard/superAdmin/SuperAdminParts.jsx",
    "pages/dashboard/superAdmin/superAdmin.helpers.js",
  ];
  files.forEach((file) => assert.doesNotMatch(read(file), /Export CSV|downloadCsv|text\/csv|onExport|\.csv\s*:/i));
});

test("Super Admin root contains neither Total Leads nor archive More navigation", () => {
  const config = read("layouts/DashboardLayout.config.js");
  const adminSection = config.slice(config.indexOf('"super-admin": ['), config.indexOf("const notificationPrefetch"));
  assert.doesNotMatch(adminSection, /Total Leads|More|Rejected|Disbursed|\/admin\/leads/);
});

test("Bank Manager analytics navigation, route, page and realtime cache are removed", () => {
  const config = read("layouts/DashboardLayout.config.js");
  const router = read("routes/router.jsx");
  const panel = read("pages/bank/BankBranchManagerPanel.jsx");
  const realtime = read("services/realtimeClient.events.js");

  [config, router, panel, realtime].forEach((source) => {
    assert.doesNotMatch(source, /bank-manager\/analytics|\/bank\/analytics|BankAnalyticsPage|mode="analytics"/);
  });
  assert.equal(fs.existsSync(path.join(root, "pages/bank/BankAnalyticsPage.jsx")), false);
});

test("shared sidebar uses an icon-only collapse control and contains no session card", () => {
  const layout = read("layouts/DashboardLayoutCore.jsx");

  assert.match(layout, /ChevronLeft, ChevronRight/);
  assert.match(layout, /const ToggleIcon = collapsed \? ChevronRight : ChevronLeft/);
  assert.match(layout, /h-9 w-9 items-center justify-center/);
  assert.doesNotMatch(layout, />\s*Collapse\s*</);
  assert.doesNotMatch(layout, />Session</);
  assert.doesNotMatch(layout, /user\?\.email\?\.slice\(0, 1\)/);
});
