import { expect, test } from "@playwright/test";

export function env(name) {
  return process.env[name] || "";
}

export function requireEnv(name) {
  const value = env(name);
  test.skip(!value, `${name} is required for this staging E2E flow.`);
  return value;
}

export function requireBaseUrl() {
  const value = env("E2E_BASE_URL") || env("STAGING_FRONTEND_URL");
  test.skip(!value, "E2E_BASE_URL or STAGING_FRONTEND_URL is required for staging E2E.");
  return value;
}

export function requireWriteGate(name) {
  test.skip(process.env[name] !== "true", `Set ${name}=true to allow this staging write flow.`);
}

export async function loginAs(page, portal, email, password) {
  await page.goto(`/${portal}/login`);
  await page.getByLabel("Email Address").fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  const rememberMe = page.getByLabel("Remember Me");
  if (await rememberMe.isVisible().catch(() => false)) await rememberMe.uncheck();
  await page.getByRole("button", { name: "Login" }).click();
  await expect(page).not.toHaveURL(new RegExp(`/${portal}/login`));
}

export async function selectFirstRealOption(page, label, { optional = false } = {}) {
  const select = page.getByLabel(label);
  if (optional && !(await select.isVisible().catch(() => false))) return false;
  await expect(select).toBeVisible();
  await expect.poll(async () => select.locator("option").count()).toBeGreaterThan(0);
  const options = await select.locator("option").evaluateAll((items) => items.map((item, index) => ({
    index,
    value: item.value,
    text: item.textContent?.trim() || "",
  })));
  const option = options.find((item) => item.value && !/^no |^select /i.test(item.text));
  test.skip(!option, `No selectable option found for ${label}.`);
  await select.selectOption({ index: option.index });
  return true;
}
