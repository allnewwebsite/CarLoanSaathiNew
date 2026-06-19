import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const srcDir = path.join(projectRoot, "src");

test("GM staff removal uses the product confirmation modal and purges staff cache", async () => {
  const listSource = await readFile(path.join(srcDir, "pages", "dashboard", "finance", "StaffManagementScreen.jsx"), "utf8");
  const detailSource = await readFile(path.join(srcDir, "pages", "dashboard", "finance", "FinanceStaffDetailPage.jsx"), "utf8");
  const financeStaffSource = await readFile(path.join(srcDir, "pages", "dashboard", "finance", "FinanceStaffManagementScreens.jsx"), "utf8");
  const modalSource = await readFile(path.join(srcDir, "components", "ConfirmActionModal.jsx"), "utf8");

  [listSource, detailSource, financeStaffSource].forEach((source) => {
    assert.equal(source.includes("window.confirm"), false);
    assert.equal(source.includes("ConfirmActionModal"), true);
    assert.equal(source.includes("Delete Permanently"), true);
  });
  assert.match(listSource, /invalidateGetCache\(\{ prefix: "\/dealer\/staff", purge: true \}\)/);
  assert.match(listSource, /api\.post\("\/dealer\/staff", nextForm, \{ timeout: 60000 \}\)/);
  assert.match(detailSource, /invalidateGetCache\(\{ prefix: "\/dealer\/staff", purge: true \}\)/);
  assert.match(financeStaffSource, /invalidateGetCache\(\{ prefix: "\/dealer\/salespersons", purge: true \}\)/);
  assert.match(financeStaffSource, /invalidateGetCache\(\{ prefix: "\/dealer\/finance-managers", purge: true \}\)/);
  assert.match(modalSource, /role="dialog"/);
  assert.match(modalSource, /aria-modal="true"/);
  assert.match(modalSource, /Permanent Delete|Confirm Action/);
});

test("temporary password page prefers backend error messages over generic Axios text", async () => {
  const source = await readFile(path.join(srcDir, "pages", "auth", "ExecutiveChangePasswordPage.jsx"), "utf8");

  assert.match(source, /err\.response\?\.data\?\.message/);
  assert.match(source, /err\.response\?\.data\?\.code/);
});
