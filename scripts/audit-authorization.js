import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const checks = [];

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assertCheck(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
}

const frontendGuard = read("frontend/src/routes/RoleProtectedRoute.jsx");
const router = read("frontend/src/routes/router.jsx");
const requireRole = read("backend/middleware/requireRole.js");
const auth = read("backend/middleware/auth.js");
const firestoreRules = read("firestore.rules");
const storageRules = read("storage.rules");

assertCheck(
  "frontend super-admin cannot bypass every portal",
  !frontendGuard.includes('user.role === ROLES.SUPER_ADMIN) return <Outlet />'),
  "Super Admin must use /admin routes, not bank/finance/gm portals.",
);
assertCheck("finance route allows only finance-desk", router.includes('path: "/finance"') && router.includes("roles={[ROLES.FINANCE_DESK]}"));
assertCheck("gm route allows only gm-sm", router.includes('path: "/gm"') && router.includes("roles={[ROLES.GM_SM]}"));
assertCheck("bank manager route allows only bank-manager", router.includes('path: "/bank-manager"') && router.includes("roles={[ROLES.BANK_MANAGER]}"));
assertCheck("loan executive route allows only loan-executive", router.includes('path: "/loan-executive"') && router.includes("roles={[ROLES.LOAN_EXECUTIVE]}"));
assertCheck("admin route allows only super-admin", router.includes('path: "/admin"') && router.includes("roles={[ROLES.SUPER_ADMIN]}"));
assertCheck(
  "backend requireRole has no wildcard super-admin bypass",
  !requireRole.includes('user.role === "super-admin") return next()'),
  "Admin APIs must explicitly require super-admin.",
);
assertCheck(
  "backend auth verifies Firestore user",
  auth.includes("verifiedAccountFromTokenUser") && auth.includes("resolveCanonicalIdentity"),
);
assertCheck("backend auth rejects unverified email", auth.includes("EMAIL_NOT_VERIFIED"));
assertCheck("Firestore denies default wildcard", firestoreRules.includes("match /{document=**}") && firestoreRules.includes("allow read, write: if false"));
assertCheck("Firestore protects system counters", firestoreRules.includes("match /systemCounters/{id}") && firestoreRules.includes("allow read, write: if false"));
assertCheck("Firestore audit logs are immutable from client", firestoreRules.includes("match /auditLogs/{logId}") && firestoreRules.includes("allow write: if false"));
assertCheck("Firestore user role fields immutable for self update", firestoreRules.includes("immutableUserSecurityFields"));
assertCheck("Storage denies default wildcard", storageRules.includes("match /{allPaths=**}") && storageRules.includes("allow read, write: if false"));
assertCheck("Storage validates customer file type and size", storageRules.includes("validCustomerFile"));

const failed = checks.filter((check) => !check.ok);
console.table(checks.map(({ name, ok }) => ({ check: name, status: ok ? "PASS" : "FAIL" })));
if (failed.length) {
  console.error("\nAuthorization audit failed:");
  for (const item of failed) console.error(`- ${item.name}${item.detail ? `: ${item.detail}` : ""}`);
  process.exit(1);
}
console.log("\nAuthorization audit passed.");
