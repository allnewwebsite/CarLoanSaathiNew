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

test("authenticated password change is server verified and revokes every session", async () => {
  const passwordSource = await readFile(path.join(backendRoot, "controllers", "authPassword.controller.js"), "utf8");
  const routesSource = await readFile(path.join(backendRoot, "routes", "auth.routes.js"), "utf8");
  const securitySource = await readFile(path.join(backendRoot, "middleware", "securityMiddleware.js"), "utf8");

  const verifyIndex = passwordSource.indexOf("await signInWithFirebasePassword(email, currentPassword)");
  const updateIndex = passwordSource.indexOf("await firebaseAdmin.auth().updateUser", verifyIndex);
  const refreshRevokeIndex = passwordSource.indexOf("revokeRefreshTokens", updateIndex);
  const sessionRevokeIndex = passwordSource.indexOf('revokeUserSessions(email, "password-changed")', updateIndex);
  assert.ok(verifyIndex > 0 && verifyIndex < updateIndex);
  assert.ok(updateIndex < refreshRevokeIndex && refreshRevokeIndex < sessionRevokeIndex);
  assert.match(passwordSource, /PASSWORD_PATTERN/);
  assert.match(passwordSource, /New password must be different from your current password/);
  assert.match(passwordSource, /Current password is incorrect/);
  assert.match(passwordSource, /REALTIME_EVENTS\.SESSION_REVOKED/);
  assert.match(passwordSource, /actionType: "PASSWORD_CHANGE"/);
  assert.match(routesSource, /passwordChangeIpRateLimit, passwordChangeAccountRateLimit, changeAuthenticatedPassword/);
  assert.match(securitySource, /PASSWORD_CHANGE_RATE_LIMIT_MAX", 5/);
  assert.match(securitySource, /windowMs: 15 \* 60 \* 1000/);
});

test("authenticated password change persists lifecycle before best-effort follow-ups and success", async () => {
  const passwordSource = await readFile(path.join(backendRoot, "controllers", "authPassword.controller.js"), "utf8");
  const handlerStart = passwordSource.indexOf("export async function changeAuthenticatedPassword");
  const handlerEnd = passwordSource.indexOf("export async function validatePasswordReset", handlerStart);
  const handlerSource = passwordSource.slice(handlerStart, handlerEnd);

  const canonicalWriteIndex = handlerSource.indexOf("await upsertCanonicalUser(uid");
  const lifecycleWriteIndex = handlerSource.indexOf("await updatePasswordLifecycleRecords(email, req.user.role, lifecyclePatch)");
  const followUpsIndex = handlerSource.indexOf("Promise.allSettled");
  const successIndex = handlerSource.indexOf("return res.json");

  assert.ok(canonicalWriteIndex > 0);
  assert.ok(canonicalWriteIndex < lifecycleWriteIndex);
  assert.ok(lifecycleWriteIndex < followUpsIndex);
  assert.ok(followUpsIndex < successIndex);
  assert.doesNotMatch(
    handlerSource.slice(followUpsIndex, successIndex),
    /upsertCanonicalUser|updatePasswordLifecycleRecords/,
  );
});
