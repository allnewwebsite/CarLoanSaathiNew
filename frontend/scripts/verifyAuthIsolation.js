import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourceRoot = resolve(__dirname, "../src");
const projectRoot = resolve(__dirname, "../..");

class MemoryStorage {
  constructor() {
    this.items = new Map();
  }

  getItem(key) {
    return this.items.has(key) ? this.items.get(key) : null;
  }

  setItem(key, value) {
    this.items.set(key, String(value));
  }

  removeItem(key) {
    this.items.delete(key);
  }
}

globalThis.sessionStorage = new MemoryStorage();
globalThis.localStorage = new MemoryStorage();
globalThis.window = {
  location: { pathname: "/" },
  addEventListener: () => {},
  removeEventListener: () => {},
};

const {
  clearAuthStorage,
  getAuthCacheIdentity,
  getStoredToken,
  getStoredUser,
  storeAuthSession,
} = await import("../src/services/authSessionManager.js");
const {
  currentLoginPath,
  loginPathForCurrentPortal,
  requestPortalHeader,
} = await import("../src/services/apiPortal.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function setPath(pathname) {
  globalThis.window.location.pathname = pathname;
}

function session(email, role) {
  return { email, role, accountApproved: true, accountActive: true };
}

function sourceFile(relativePath) {
  return readFileSync(resolve(sourceRoot, relativePath), "utf8");
}

function projectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), "utf8");
}

function assertNoFailedLoginMutation() {
  const source = sourceFile("context/AuthContextCore.jsx");
  const loginStart = source.indexOf("const loginWithEmailPassword");
  const loginEnd = source.indexOf("const sendPasswordReset", loginStart);
  const loginSource = loginStart >= 0 && loginEnd > loginStart ? source.slice(loginStart, loginEnd) : "";
  assert(loginSource, "Could not locate loginWithEmailPassword for auth isolation verification.");
  assert(!/reason:\s*["']login-rejected["']/.test(loginSource), "Rejected login path must not publish or clear logout state.");
  assert(!/clearLocalSession\s*\(/.test(loginSource), "Login failure path must not call clearLocalSession.");
  assert(!/clearAuthStorage\s*\(/.test(loginSource), "Login failure path must not clear auth storage.");
  assert(!/publishAuthEvent\s*\(/.test(loginSource), "Login failure path must not broadcast logout.");
  assert(!/signOut\s*\(/.test(loginSource), "Login failure path must not sign out Firebase.");
  const validationIndex = loginSource.indexOf("allowedRoles.includes(session.role)");
  const applyIndex = loginSource.indexOf("applySession(session");
  assert(validationIndex >= 0, "Login response must validate the exact target portal role.");
  assert(applyIndex > validationIndex, "Portal role validation must happen before session state is applied.");
}

function assertBackendExactPortalValidation() {
  const portalShared = projectFile("backend/controllers/authPortalShared.controller.js");
  const login = projectFile("backend/controllers/authLogin.controller.js");
  const loginSession = projectFile("backend/controllers/authLoginSession.controller.js");
  const authMiddleware = projectFile("backend/middleware/auth.js");
  assert(portalShared.includes("export const LOGIN_PORTAL_ROLES"), "Backend must define exact login portal role contracts.");
  assert(portalShared.includes("export function loginPortalAllowsRole"), "Backend must expose exact login portal validation.");
  assert(login.includes("loginPortalAllowsRole(requestedLoginPortal, account.role)"), "Backend login must validate the exact login portal.");
  assert(login.includes("wrongLoginPortalPayload(account.role)"), "Wrong-portal login must return a non-mutating authorization error.");
  assert(portalShared.includes('message: "You are not authorized to access this portal."'), "Wrong-portal response must use the required safe message.");
  assert(loginSession.includes("loginPortal: loginPortalForRole(account.role)"), "JWT session payload must include the exact login portal claim.");
  assert(authMiddleware.includes("loginPortalForRole(tokenUser.role)") && authMiddleware.includes("loginPortalForRole(account.role)"), "Auth middleware must validate stored token login portal claims.");
}

function assertNoRouteMismatchMutation() {
  const source = sourceFile("routes/RoleProtectedRoute.jsx");
  assert(!/clearAuthStorage\s*\(/.test(source), "Role mismatch route guard must not clear auth storage.");
  assert(!/publishAuthEvent\s*\(/.test(source), "Role mismatch route guard must not broadcast logout.");
  assert(!/navigate\s*\(\s*loginPathForRole/.test(source), "Role mismatch route guard must not auto-redirect to another portal.");
  assert(source.includes("Portal access denied"), "Role mismatch route guard must render an isolated denial state.");
}

function assertFailedAttemptLeavesSessionUntouched({ activePath, activeUser, activeToken, attemptedPath, label }) {
  setPath(activePath);
  storeAuthSession(activeUser, activeToken);
  const beforeUser = JSON.stringify(getStoredUser());
  const beforeToken = getStoredToken();

  setPath(attemptedPath);
  // Failed login attempts are intentionally non-mutating: no storage clear,
  // no logout broadcast, no role overwrite, and no token write.

  setPath(activePath);
  assert(getStoredToken() === beforeToken, `${label}: active token changed after failed login attempt.`);
  assert(JSON.stringify(getStoredUser()) === beforeUser, `${label}: active user changed after failed login attempt.`);
}

assertNoFailedLoginMutation();
assertNoRouteMismatchMutation();
assertBackendExactPortalValidation();

setPath("/finance/total-leads");
storeAuthSession(session("finance@example.com", "finance-desk"), "finance-token");
assert(getStoredToken() === "finance-token", "Finance token was not stored in finance scope.");
assert(getStoredUser()?.role === "finance-desk", "Finance user was not restored from finance scope.");

setPath("/gm/total-leads");
storeAuthSession(session("gm@example.com", "gm"), "gm-token");
assert(getStoredToken() === "gm-token", "GM token was not stored in GM scope.");
assert(getStoredUser()?.role === "gm", "GM user was not restored from GM scope.");
assert(getAuthCacheIdentity() === "gm:gm@example.com", "GM API cache identity is not account scoped.");

setPath("/gm/login");
assert(currentLoginPath() === "/gm/login", "GM login was collapsed into the Finance login path.");
assert(loginPathForCurrentPortal() === "/gm/login", "GM portal failure redirect does not remain in the GM portal.");
assert(requestPortalHeader() === "gm", "GM requests do not carry the GM portal header.");

setPath("/finance/total-leads");
assert(getStoredToken() === "finance-token", "GM login overwrote finance token.");
assert(getStoredUser()?.email === "finance@example.com", "GM login overwrote finance user.");

setPath("/bank-manager/leads");
storeAuthSession(session("manager@example.com", "bank-manager"), "bank-manager-token");

setPath("/loan-executive/leads");
storeAuthSession(session("executive@example.com", "loan-executive"), "loan-executive-token");
assert(getStoredToken() === "loan-executive-token", "Loan executive token was not stored in executive scope.");

setPath("/admin/leads");
storeAuthSession(session("admin@example.com", "super-admin"), "admin-token");
assert(getStoredToken() === "admin-token", "Admin token was not stored in admin scope.");

setPath("/gm/total-leads");
assert(getStoredToken() === "gm-token", "Admin login overwrote GM token.");

setPath("/admin/leads");
assert(getStoredUser()?.role === "super-admin", "Admin user was not restored from admin scope.");

setPath("/bank-manager/leads");
assert(getStoredToken() === "bank-manager-token", "Loan executive login overwrote bank manager token.");

setPath("/loan-executive/leads");
clearAuthStorage();
assert(getStoredToken() === null, "Loan executive scoped logout did not clear executive token.");

setPath("/bank-manager/leads");
assert(getStoredToken() === "bank-manager-token", "Loan executive logout cleared bank manager token.");

setPath("/finance/total-leads");
assert(getStoredToken() === "finance-token", "Loan executive logout cleared finance token.");

assertFailedAttemptLeavesSessionUntouched({
  activePath: "/finance/total-leads",
  activeUser: session("finance-active@example.com", "finance-desk"),
  activeToken: "finance-active-token",
  attemptedPath: "/gm/login",
  label: "Finance active + GM wrong password",
});

assertFailedAttemptLeavesSessionUntouched({
  activePath: "/finance/total-leads",
  activeUser: session("finance-bank-test@example.com", "finance-desk"),
  activeToken: "finance-bank-test-token",
  attemptedPath: "/bank/login",
  label: "Finance active + Bank wrong password",
});

assertFailedAttemptLeavesSessionUntouched({
  activePath: "/finance/total-leads",
  activeUser: session("finance-exec-test@example.com", "finance-desk"),
  activeToken: "finance-exec-test-token",
  attemptedPath: "/executive/login",
  label: "Finance active + Executive wrong password",
});

assertFailedAttemptLeavesSessionUntouched({
  activePath: "/gm/total-leads",
  activeUser: session("gm-active@example.com", "gm"),
  activeToken: "gm-active-token",
  attemptedPath: "/finance/login",
  label: "GM active + Finance wrong password",
});

assertFailedAttemptLeavesSessionUntouched({
  activePath: "/admin/leads",
  activeUser: session("admin@example.com", "super-admin"),
  activeToken: "admin-token",
  attemptedPath: "/dealer/login",
  label: "Admin active + Dealer wrong password",
});

console.log("Auth session isolation verification passed.");
