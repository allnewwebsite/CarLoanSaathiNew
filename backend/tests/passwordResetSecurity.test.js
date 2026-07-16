import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loginPortalAllowsRole, normalizeLoginPortal } from "../controllers/authPortalShared.controller.js";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("password reset portal mapping covers every authentication portal", () => {
  const cases = [
    ["finance", "finance-desk"],
    ["gm", "gm"],
    ["bank", "bank-manager"],
    ["executive", "loan-executive"],
    ["admin", "super-admin"],
  ];
  for (const [portal, role] of cases) {
    assert.equal(loginPortalAllowsRole(normalizeLoginPortal(portal), role), true, `${role} must match ${portal}`);
  }
  assert.equal(loginPortalAllowsRole(normalizeLoginPortal("finance"), "loan-executive"), false);
  assert.equal(loginPortalAllowsRole(normalizeLoginPortal("executive"), "finance-desk"), false);
});

test("CarLoanSaathi account, role, and active state are validated before Firebase lookup", () => {
  const controller = read("backend/controllers/authPassword.controller.js");
  const accountLookup = controller.indexOf("accountForAnyPortal(email)");
  const portalCheck = controller.indexOf("loginPortalAllowsRole(requestedPortal, account.role)");
  const activeCheck = controller.indexOf("accountActive(account)");
  const firebaseLookup = controller.indexOf("firebaseAdmin.auth().getUserByEmail(email)");
  assert.ok(accountLookup > 0 && accountLookup < portalCheck);
  assert.ok(portalCheck < activeCheck && activeCheck < firebaseLookup);
  assert.equal(controller.includes("No account was found with this email address."), true);
  assert.equal(controller.includes("This account belongs to another portal."), true);
  assert.equal(controller.includes("Your account is inactive. Please contact your administrator."), true);
});

test("Firebase reset email is called only after backend portal validation", () => {
  const context = read("frontend/src/context/AuthContextCore.jsx");
  const validation = context.indexOf('api.post("/auth/password-reset/validate"');
  const firebaseSend = context.indexOf("sendPasswordResetEmail(auth, normalizedEmail");
  assert.ok(validation > 0 && validation < firebaseSend);
  assert.equal(context.includes("{ email: normalizedEmail, portal }"), true);
});

test("password reset is limited independently by IP and normalized email", () => {
  const middleware = read("backend/middleware/securityMiddleware.js");
  const routes = read("backend/routes/auth.routes.js");
  assert.equal(middleware.includes("passwordResetRateLimit"), true);
  assert.equal(middleware.includes("passwordResetEmailRateLimit"), true);
  assert.equal(middleware.includes('PASSWORD_RESET_RATE_LIMIT_MAX", 5'), true);
  assert.equal(middleware.includes("IP_RATE_LIMIT"), true);
  assert.equal(middleware.includes("EMAIL_RATE_LIMIT"), true);
  assert.match(routes, /passwordResetRateLimit, passwordResetEmailRateLimit, validatePasswordReset/);
});

test("password reset attempts are audited without custom reset tokens", () => {
  const controller = read("backend/controllers/authPassword.controller.js");
  const middleware = read("backend/middleware/securityMiddleware.js");
  assert.equal(controller.includes('actionType: "PASSWORD_RESET_ATTEMPT"'), true);
  assert.equal(controller.includes("success: true"), true);
  assert.equal(controller.includes("success: false"), true);
  assert.equal(middleware.includes('actionType: "PASSWORD_RESET_ATTEMPT"'), true);
  assert.equal(controller.includes("resetToken"), false);
  assert.equal(controller.includes("generatePasswordResetLink"), false);
});
