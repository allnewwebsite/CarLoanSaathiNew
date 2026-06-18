import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const checks = [];

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function readIfExists(file) {
  const target = path.join(root, file);
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
}

function readCombined(...files) {
  return files.map(readIfExists).join("\n");
}

function assertCheck(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
}

function between(text, start, end) {
  const startIndex = text.indexOf(start);
  if (startIndex < 0) return "";
  const endIndex = text.indexOf(end, startIndex + start.length);
  return endIndex < 0 ? text.slice(startIndex) : text.slice(startIndex, endIndex);
}

const frontendGuard = read("frontend/src/routes/RoleProtectedRoute.jsx");
const authContext = readCombined(
  "frontend/src/context/AuthContext.jsx",
  "frontend/src/context/AuthContextCore.jsx",
  "frontend/src/context/AuthContext.helpers.js",
);
const authSessionManager = read("frontend/src/services/authSessionManager.js");
const apiClient = readCombined(
  "frontend/src/services/api.js",
  "frontend/src/services/apiCache.js",
  "frontend/src/services/apiAppCheck.js",
  "frontend/src/services/apiAuth.js",
  "frontend/src/services/apiWarmup.js",
);
const router = read("frontend/src/routes/router.jsx");
const requireRole = read("backend/middleware/requireRole.js");
const auth = read("backend/middleware/auth.js");
const authController = readCombined("backend/controllers/auth.controller.js", "backend/controllers/auth.controller.impl.js", "backend/controllers/authShared.controller.js", "backend/controllers/authLogin.controller.js", "backend/controllers/authSession.controller.js", "backend/controllers/authPassword.controller.js");
const securityMiddleware = read("backend/middleware/securityMiddleware.js");
const identityService = read("backend/services/identity.service.js");
const timelineController = read("backend/controllers/timeline.controller.js");
const timelineService = read("backend/services/timeline.service.js");
const leadController = read("backend/controllers/lead.controller.js");
const bankController = readCombined("backend/controllers/bank.controller.js", "backend/controllers/bank.controller.impl.js", "backend/controllers/bankShared.controller.js", "backend/controllers/bankLeadRead.controller.js");
const partnerBranchValuesBody = between(bankController, "function partnerBranchValues", "function bankManagerCanAccessLead");
const firestoreRules = read("firestore.rules");
const storageRules = read("storage.rules");

assertCheck(
  "frontend super-admin cannot bypass every portal",
  !frontendGuard.includes('user.role === ROLES.SUPER_ADMIN) return <Outlet />'),
  "Super Admin must use /admin routes, not bank/finance/gm portals.",
);
assertCheck(
  "role mismatch does not auto-switch portals",
  !frontendGuard.includes("navigate(loginPathForRole")
    && frontendGuard.includes("Portal access denied"),
  "A role mismatch must preserve the current scoped session and render denial without switching portals.",
);
assertCheck("finance route allows only finance-desk", router.includes('path: "/finance"') && router.includes("roles={[ROLES.FINANCE_DESK]}"));
assertCheck("gm route allows only gm", router.includes('path: "/gm"') && router.includes("roles={[ROLES.GM]}"));
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
assertCheck(
  "single active identity is enforced per email",
  identityService.includes("if (activeCandidates.length > 1)") && identityService.includes('error.code = "IDENTITY_COLLISION"'),
);
assertCheck(
  "session refresh does not mask identity collision",
  authController.includes("const account = await resolveCanonicalIdentity({ uid, email });")
    && !authController.includes("const account = await resolveCanonicalIdentity({ uid, email }).catch(() => null);"),
);
assertCheck(
  "tab focus cannot auto-clear session on network failure",
  authContext.includes("shouldClearSessionForError") && !authContext.includes('window.addEventListener("focus", onFocus)'),
);
assertCheck(
  "stored JWT renders without blocking session spinner",
  authContext.includes("useState(() => Boolean(getStoredToken() || getStoredUser()))")
    && authContext.includes("const [sessionChecking, setSessionChecking] = useState(false)")
    && authContext.includes("validateSession({ showLoading: false })"),
);
assertCheck(
  "email login avoids duplicate Firebase client sign-in",
  (
    authContext.includes("const loginPayload = { email: normalizedEmail, password, portal, targetPortal }")
    || authContext.includes("const loginPayload = { email: normalizedEmail, password, portal, targetPortal };")
  )
    && !between(authContext, "const loginWithEmailPassword", "const sendPasswordReset").includes("getIdToken"),
);
assertCheck(
  "login enforces exact portal role before session mutation",
  authController.includes("const LOGIN_PORTAL_ROLES")
    && authController.includes("loginPortalAllowsRole(requestedLoginPortal, account.role)")
    && authController.includes('message: "You are not authorized to access this portal."')
    && authContext.indexOf("allowedRoles.includes(session.role)") >= 0
    && authContext.indexOf("applySession(session, response.data.token)") > authContext.indexOf("allowedRoles.includes(session.role)"),
  "A grouped finance/bank portal match must not authorize GM or executive credentials on another login screen.",
);
assertCheck(
  "cross-tab logout is portal scoped",
  authSessionManager.includes('payload: type === "logout" ? { scope: scopeFromPath(), ...payload } : payload')
    && authContext.includes("eventScope !== currentScope"),
);
assertCheck(
  "identity collision clears stale frontend session",
  apiClient.includes('"IDENTITY_COLLISION"'),
);
assertCheck(
  "API client caches GET and App Check token for fast tab switching",
  apiClient.includes("getCache = new Map()")
    && apiClient.includes("APP_CHECK_CACHE_TTL_MS")
    && apiClient.includes("config.adapter = () => Promise.resolve(cached)")
    && (apiClient.includes("export function getCachedGetData") || apiClient.includes("export const getCachedGetData")),
);
assertCheck(
  "tables retain rows during refresh",
  read("frontend/src/components/OperationalTable.jsx").includes("const visibleRows = rows")
    && read("frontend/src/components/OperationalTable.jsx").includes("loading && !hasRows"),
);
assertCheck(
  "portal list pages hydrate from cached data on first paint",
  readCombined("frontend/src/pages/dashboard/FinanceDeskPanel.jsx", "frontend/src/pages/dashboard/finance/financeLeadList.data.js").includes("getCachedGetData(\"/dealer/leads\"")
    && readCombined("frontend/src/pages/dashboard/FinanceDeskPanel.jsx", "frontend/src/pages/dashboard/finance/BankTieUpsScreen.jsx").includes("cachedTieUps = getCachedGetData(\"/dealer/bank-tieups\")")
    && readCombined("frontend/src/pages/dashboard/GmTrackingPanel.jsx", "frontend/src/pages/dashboard/gm/gmTracking.data.js").includes("getCachedGetData(\"/gm/leads\"")
    && readCombined("frontend/src/pages/bank/BankBranchManagerPanel.jsx", "frontend/src/pages/bank/bankManager.hooks.js").includes("getCachedGetData(\"/bank/leads\"")
    && readCombined("frontend/src/pages/bank/LoanExecutivePanel.jsx", "frontend/src/pages/bank/loanExecutive.hooks.js").includes("getCachedGetData(\"/bank/leads\"")
    && readCombined("frontend/src/pages/dashboard/SuperAdminDashboard.jsx", "frontend/src/pages/dashboard/superAdmin/useAdminPanelData.js").includes("adminPanelRequest")
    && read("frontend/src/pages/dashboard/BankTieUpSettings.jsx").includes("getCachedGetData(\"/dealer/bank-tieups\""),
);
assertCheck(
  "dashboard sidebar prefetches all portal tabs",
  readCombined("frontend/src/layouts/DashboardLayout.jsx", "frontend/src/layouts/DashboardLayoutCore.jsx", "frontend/src/layouts/DashboardLayout.config.js").includes("function prefetchSpecsForRoute")
    && readCombined("frontend/src/layouts/DashboardLayout.jsx", "frontend/src/layouts/DashboardLayoutCore.jsx", "frontend/src/layouts/DashboardLayout.config.js").includes("nav.forEach((item, index)")
    && readCombined("frontend/src/layouts/DashboardLayout.jsx", "frontend/src/layouts/DashboardLayoutCore.jsx", "frontend/src/layouts/DashboardLayout.config.js").includes("onPointerDown={() => prefetchDashboardRoute(item.to)}"),
);
assertCheck(
  "CORS allows portal header required by login",
  securityMiddleware.includes('"X-CLS-Portal"'),
  "Browser login preflight must allow X-CLS-Portal or every portal login is blocked as a network error.",
);
assertCheck(
  "timeline list is tenant-scoped beyond role visibility",
  timelineService.includes("canReadScopedTimeline") && timelineService.includes("canReadScopedTimeline({ event, lead, actor })"),
  "Shared /api/timeline must filter every returned row by dealership, bank, branch, or executive ownership.",
);
assertCheck(
  "timeline lead access reuses tenant-scoped helper",
  timelineController.includes("canReadTimelineLead(req.user, req.params.leadId)") && !timelineController.includes("managerCity === leadCity"),
  "Lead timeline access must not use city-only bank-manager matching.",
);
assertCheck(
  "timeline events without visibility are not visible to non-admins",
  timelineService.includes("return visibility.length > 0 && visibility.includes(normalize(role))"),
  "Missing visibility must not become an all-role data leak.",
);
assertCheck(
  "authenticated lead creation ignores client dealershipId",
  leadController.includes("function authenticatedDealershipId")
    && leadController.includes("authenticatedDealershipId(req, actorEmail)")
    && leadController.includes("dealershipId,")
    && !leadController.includes("dealershipId: payload.dealershipId || req.user?.dealershipId"),
  "Finance-desk lead creation must derive dealership scope from the authenticated session.",
);
assertCheck(
  "bank manager lead access requires same bank and same branch",
  bankController.includes("function bankManagerCanAccessLead")
    && bankController.includes("const sameBank = anyMatch(leadBankValues(lead), partnerBankValues(partner))")
    && bankController.includes("const sameBranch = anyMatch(leadBranchValues(lead), partnerBranchValues(partner))")
    && bankController.includes("return sameBank && sameBranch"),
  "Bank managers must not access same-bank leads from another branch.",
);
assertCheck(
  "bank branch matching excludes bank-level ids",
  partnerBranchValuesBody
    && !partnerBranchValuesBody.includes("partner.bankPartnerId")
    && !partnerBranchValuesBody.includes("partner.partnerId")
    && !partnerBranchValuesBody.includes("partner.id,"),
  "Branch matching must not treat bankPartnerId, partnerId, or generic id as branch proof.",
);
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
