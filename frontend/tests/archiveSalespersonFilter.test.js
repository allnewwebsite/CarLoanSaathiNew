import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("archive salesperson filter is limited to Finance Desk and GM backend sources", () => {
  const component = read("src/pages/dashboard/ArchiveSalespersonFilter.jsx");
  assert.match(component, /finance:\s*"\/dealer\/salespersons"/);
  assert.match(component, /gm:\s*"\/gm\/salespersons"/);
  assert.doesNotMatch(component, /bank-manager|loan-executive|super-admin/);
  assert.match(component, /All Salespersons/);
  assert.match(component, /person\.active !== false/);
});

test("Finance and GM terminal archives send salespersonId to backend and preserve it in URL pagination", () => {
  const finance = read("src/pages/dashboard/finance/FinanceLeadListScreens.jsx");
  const gm = read("src/pages/dashboard/GmTrackingPanel.jsx");
  for (const source of [finance, gm]) {
    assert.match(source, /params\.get\("salespersonId"\)/);
    assert.match(source, /archiveTerminal:\s*"1",\s*salespersonId/);
    assert.match(source, /No archived cases found for this salesperson\./);
    assert.match(source, /setArchiveParams/);
  }
  assert.match(finance, /audience="finance"/);
  assert.match(gm, /audience="gm"/);
});

test("Dead Cases forwards salespersonId for Finance and GM and keeps bank/executive behavior unchanged", () => {
  const controller = read("../backend/controllers/deadCase.controller.js");
  const financeStart = controller.indexOf("export async function getFinanceDeadCases");
  const gmStart = controller.indexOf("export async function getGmDeadCases");
  const bankStart = controller.indexOf("export async function getBankDeadCases");
  assert.match(controller.slice(financeStart, gmStart), /salespersonId:\s*String\(req\.query\?\.salespersonId/);
  assert.match(controller.slice(gmStart, bankStart), /salespersonId:\s*String\(req\.query\?\.salespersonId/);
  assert.doesNotMatch(controller.slice(bankStart), /salespersonId:\s*String\(req\.query\?\.salespersonId/);
});

test("filtered realtime lists reconcile through backend instead of inserting unscoped patches", () => {
  const financeData = read("src/pages/dashboard/finance/financeLeadList.data.js");
  const gmData = read("src/pages/dashboard/gm/gmTracking.data.js");
  const deadCases = read("src/pages/dashboard/deadCases.hooks.js");
  for (const source of [financeData, gmData]) {
    assert.match(source, /enabled:\s*!filters\.salespersonId/);
    assert.match(source, /refreshOnMutation:\s*Boolean\(filters\.salespersonId\)/);
  }
  assert.match(deadCases, /if \(salespersonId\) \{\s*load\(\{ silent: true \}\)/);
});
