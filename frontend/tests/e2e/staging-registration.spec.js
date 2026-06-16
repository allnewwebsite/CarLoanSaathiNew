import { expect, test } from "@playwright/test";
import { requireBaseUrl, requireEnv, requireWriteGate } from "./staging.helpers.js";

test("dealer registration starts an email account and reaches the next onboarding state", async ({ page }) => {
  requireBaseUrl();
  requireWriteGate("E2E_RUN_REGISTRATION");

  await page.goto("/dealer/register");
  await page.getByLabel("Email Address").fill(requireEnv("E2E_REGISTRATION_EMAIL"));
  await page.locator('input[type="password"]').fill(requireEnv("E2E_REGISTRATION_PASSWORD"));
  await page.getByRole("button", { name: "Create Account" }).click();

  await expect(page).toHaveURL(/\/dealer-registration\/(form|verify-email|pending|pending-approval)/);
});
