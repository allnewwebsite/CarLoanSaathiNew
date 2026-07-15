import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("loan executive has one pending-document request entry point", () => {
  const list = read("frontend/src/pages/bank/LoanExecutiveLeadListPage.jsx");
  const modals = read("frontend/src/pages/bank/LoanExecutiveLeadModals.jsx");
  assert.equal(list.includes("Request Docs"), false);
  assert.equal(list.includes("PendingDocsModal"), false);
  assert.equal(modals.includes("export function PendingDocsModal"), false);
  assert.equal(modals.includes('<option value="">Select Status</option>'), true);
  assert.equal(modals.includes("pendingDocumentsRequested"), true);
  assert.equal(modals.includes("Submit Document Request"), true);
});

test("finance documents use a compact table and requested upload grid", () => {
  const page = read("frontend/src/pages/dashboard/finance/FinanceLeadDocumentsPage.jsx");
  assert.equal(page.includes("Customer Uploaded Documents"), true);
  assert.equal(page.includes("Choose File"), true);
  assert.equal(page.includes("Requested"), true);
  assert.equal(page.includes("/documents/${document.id}/view"), true);
  assert.equal(page.includes("pendingDocumentItems(lead)"), true);
  assert.equal(page.includes("Array.isArray(lead?.pendingDocumentsRequested)"), false);
  assert.equal(page.includes("min-h-28"), false);
  assert.equal(page.includes("grid gap-3 sm:grid-cols-2"), false);
});

test("document upload enforces new request checklists with legacy compatibility", () => {
  const controller = read("backend/controllers/document.controller.js");
  assert.equal(controller.includes("function isRequestedDocumentType"), true);
  assert.equal(controller.includes("if (!requested.length) return true"), true);
  assert.equal(controller.includes("Only documents requested for this lead can be uploaded"), true);
});

test("every platform select starts with an explicit empty option", () => {
  const sources = [
    "frontend/src/components/ApplyLoanForm.jsx",
    "frontend/src/components/LeadTimeline.jsx",
    "frontend/src/pages/bank/BankDealershipPages.jsx",
    "frontend/src/pages/bank/BankLeadListPages.jsx",
    "frontend/src/pages/bank/LoanExecutiveLeadListPage.jsx",
    "frontend/src/pages/bank/LoanExecutiveLeadModals.jsx",
    "frontend/src/pages/bank/ReassignLeadDialog.jsx",
    "frontend/src/pages/dashboard/BankTieUpSettingsParts.jsx",
    "frontend/src/pages/dashboard/DeadCaseDialogs.jsx",
    "frontend/src/pages/dashboard/DeadCasesPageCore.jsx",
    "frontend/src/pages/dashboard/GmTrackingPanel.jsx",
    "frontend/src/pages/dashboard/finance/AddLeadOnlyScreen.jsx",
    "frontend/src/pages/dashboard/finance/BankTieUpsScreen.jsx",
    "frontend/src/pages/dashboard/finance/FinanceLeadListScreens.jsx",
    "frontend/src/pages/dashboard/finance/StaffManagementScreen.jsx",
    "frontend/src/pages/dashboard/superAdmin/SuperAdminListParts.jsx",
    "frontend/src/pages/dealer/CreateLeadFormParts.jsx",
    "frontend/src/pages/dealerRegistration/DealerRegistrationParts.jsx",
    "frontend/src/pages/MarketplacePage.jsx",
    "frontend/src/pages/public/BankRegistrationFormSections.jsx",
  ];
  for (const source of sources) {
    const blocks = [...read(source).matchAll(/<select\b[\s\S]*?<\/select>/g)].map((match) => match[0]);
    for (const block of blocks) {
      assert.match(block, /<option\b[^>]*value=""/, `${source} must start selects with an empty option`);
    }
  }
});
