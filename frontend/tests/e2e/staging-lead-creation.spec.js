import { expect, test } from "@playwright/test";
import { loginAs, requireBaseUrl, requireEnv, requireWriteGate, selectFirstRealOption } from "./staging.helpers.js";

test("finance user can create a lead on staging", async ({ page }) => {
  requireBaseUrl();
  requireWriteGate("E2E_CREATE_LEADS");

  await loginAs(page, "finance", requireEnv("E2E_FINANCE_EMAIL"), requireEnv("E2E_FINANCE_PASSWORD"));
  await page.goto("/finance/add-lead");

  const suffix = String(Date.now()).slice(-8);
  await page.getByLabel("Customer Name *").fill(`E2E Customer ${suffix}`);
  await page.getByLabel("Mobile Number *").fill(`9${suffix.padStart(9, "0").slice(0, 9)}`);
  await page.getByLabel("Customer City *").fill(process.env.E2E_LEAD_CITY || "Gurugram");
  await selectFirstRealOption(page, "Tied-up Bank Branch *");
  await page.getByLabel("Car On-Road Price *").fill(process.env.E2E_LEAD_CAR_PRICE || "900000");
  await page.getByLabel("Required Loan Amount *").fill(process.env.E2E_LEAD_LOAN_AMOUNT || "700000");
  await selectFirstRealOption(page, "Select Salesperson *");
  await selectFirstRealOption(page, "Finance Manager *", { optional: true });

  await page.getByRole("button", { name: "Submit Lead" }).click();
  await expect(page).toHaveURL(/\/finance\/leads\/.+\/documents/);
});
