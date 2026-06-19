import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { onboardingIdentityKey } from "../src/context/onboardingStorage.js";

const projectRoot = process.cwd();
const srcDir = path.join(projectRoot, "src");

test("onboarding local state is scoped to account and role", () => {
  assert.equal(
    onboardingIdentityKey({ uid: "User-1", email: "person@example.com", role: "finance-desk" }),
    "cls_onboarding_seen:finance-desk:user-1",
  );
  assert.equal(
    onboardingIdentityKey({ email: "Branch@Example.com", role: "BANK-MANAGER" }),
    "cls_onboarding_seen:bank-manager:branch@example.com",
  );
  assert.equal(onboardingIdentityKey({ email: "missing-role@example.com" }), "");
});

test("onboarding auto-opens before the async status check for unseen users", async () => {
  const source = await readFile(path.join(srcDir, "context", "OnboardingContext.jsx"), "utf8");
  assert.match(source, /const localSeen = readLocalOnboardingSeen\(user\)/);
  assert.match(source, /user\.onboardingCompleted !== true && !localSeen/);
  assert.match(source, /setOpen\(true\)/);
  assert.match(source, /api\.get\("\/onboarding\/status"/);
});

test("shared platform branding uses the favicon logo instead of text tiles", async () => {
  const brandSource = await readFile(path.join(srcDir, "components", "BrandLogo.jsx"), "utf8");
  const layoutSource = await readFile(path.join(srcDir, "layouts", "DashboardLayoutCore.jsx"), "utf8");
  const loginSource = await readFile(path.join(srcDir, "pages", "auth", "LoginPageView.jsx"), "utf8");
  const publicLayoutSource = await readFile(path.join(srcDir, "layouts", "PublicLayout.jsx"), "utf8");

  assert.equal(brandSource.includes("/assets/favicon.png"), true);
  [layoutSource, loginSource, publicLayoutSource].forEach((source) => {
    assert.equal(source.includes("BrandLogo"), true);
  });
  assert.equal(layoutSource.includes(">CL<"), false);
  assert.equal(loginSource.includes(">CLS<"), false);
});
