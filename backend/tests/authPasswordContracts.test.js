import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const backendRoot = process.cwd();

test("forced password change supports staff roles without missing lifecycle constants", async () => {
  const passwordSource = await readFile(path.join(backendRoot, "controllers", "authPassword.controller.js"), "utf8");
  const sharedSource = await readFile(path.join(backendRoot, "controllers", "authShared.controller.js"), "utf8");
  const authMiddlewareSource = await readFile(path.join(backendRoot, "middleware", "auth.js"), "utf8");

  assert.match(passwordSource, /PASSWORD_VALID_DAYS/);
  assert.match(passwordSource, /\["loan-executive", "bank-manager", "finance-desk", "gm"\]/);
  assert.match(sharedSource, /role === "bank-manager"\s*\?\s*\["branchManagers", "bankPartners", "banks"\]/);
  assert.match(authMiddlewareSource, /\["finance-desk", "gm", "bank-manager", "loan-executive"\]/);
  assert.match(authMiddlewareSource, /role === "bank-manager"\) return "\/bank-manager\/change-password"/);
});
