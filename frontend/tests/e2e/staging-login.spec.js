import { expect, test } from "@playwright/test";
import { loginAs, requireBaseUrl, requireEnv } from "./staging.helpers.js";

test.beforeEach(() => {
  requireBaseUrl();
});

test("finance user can sign in and reach the lead dashboard", async ({ page }) => {
  await loginAs(page, "finance", requireEnv("E2E_FINANCE_EMAIL"), requireEnv("E2E_FINANCE_PASSWORD"));
  await expect(page).toHaveURL(/\/finance\//);
  await expect(page.getByText(/total leads|cases|add lead/i).first()).toBeVisible();
});

test("bank manager can sign in and reach assigned leads", async ({ page }) => {
  await loginAs(page, "bank", requireEnv("E2E_BANK_EMAIL"), requireEnv("E2E_BANK_PASSWORD"));
  await expect(page).toHaveURL(/\/bank-manager\//);
  await expect(page.getByText(/assigned leads|active cases|bank/i).first()).toBeVisible();
});

test("super admin can sign in and reach administration", async ({ page }) => {
  await loginAs(page, "admin", requireEnv("E2E_ADMIN_EMAIL"), requireEnv("E2E_ADMIN_PASSWORD"));
  await expect(page).toHaveURL(/\/admin\//);
  await expect(page.getByText(/super admin|dealership|leads/i).first()).toBeVisible();
});
