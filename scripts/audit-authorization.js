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

function between(text, start, end) {
  const startIndex = text.indexOf(start);
  if (startIndex < 0) return "";
  const endIndex = text.indexOf(end, startIndex + start.length);
  return endIndex < 0 ? text.slice(startIndex) : text.slice(startIndex, endIndex);
}

const frontendGuard = read("frontend/src/routes/RoleProtectedRoute.jsx");
const authContext = read("frontend/src/context/AuthContext.jsx");
const authSessionManager = read("frontend/src/services/authSessionManager.js");
const apiClient = read("frontend/src/services/api.js");
const router = read("frontend/src/routes/router.jsx");
const requireRole = read("backend/middleware/requireRole.js");
const auth = read("backend/middleware/auth.js");
const authController = read("backend/controllers/auth.controller.js");
const securityMiddleware = read("backend/middleware/securityMiddleware.js");
const identityService = read("backend/services/identity.service.js");
const timelineController = read("backend/controllers/timeline.controller.js");
const timelineService = read("backend/services/timeline.service.js");
const leadController = read("backend/controllers/lead.controller.js");
const bankController = read("backend/controllers/bank.controller.js");
const partnerBranchValuesBody = between(bankController, "function partnerBranchValues", "function bankManagerCanAccessLead");
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
  authContext.includes("const loginPayload = { email: normalizedEmail, password, portal, targetPortal }")
    && !authContext.includes("idToken = await credential.user.getIdToken(true)"),
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
  apiClient.includes("const getCache = new Map()")
    && apiClient.includes("APP_CHECK_CACHE_TTL_MS")
    && apiClient.includes("config.adapter = () => Promise.resolve(cached)")
    && apiClient.includes("export function getCachedGetData"),
);
assertCheck(
  "tables retain rows during refresh",
  read("frontend/src/components/OperationalTable.jsx").includes("const visibleRows = rows")
    && read("frontend/src/components/OperationalTable.jsx").includes("loading && !hasRows"),
);
assertCheck(
  "portal list pages hydrate from cached data on first paint",
  read("frontend/src/pages/dashboard/FinanceDeskPanel.jsx").includes("getCachedGetData(\"/dealer/leads\"")
    && read("frontend/src/pages/dashboard/FinanceDeskPanel.jsx").includes("const cachedTieUps = getCachedGetData(\"/dealer/bank-tieups\")")
    && read("frontend/src/pages/dashboard/GmTrackingPanel.jsx").includes("getCachedGetData(\"/gm/leads\"")
    && read("frontend/src/pages/bank/BankBranchManagerPanel.jsx").includes("getCachedGetData(\"/bank/leads\"")
    && read("frontend/src/pages/bank/LoanExecutivePanel.jsx").includes("getCachedGetData(\"/bank/leads\"")
    && read("frontend/src/pages/dashboard/SuperAdminDashboard.jsx").includes("adminPanelRequest")
    && read("frontend/src/pages/dashboard/BankTieUpSettings.jsx").includes("getCachedGetData(\"/dealer/bank-tieups\""),
);
assertCheck(
  "dashboard sidebar prefetches all portal tabs",
  read("frontend/src/layouts/DashboardLayout.jsx").includes("function prefetchSpecsForRoute")
    && read("frontend/src/layouts/DashboardLayout.jsx").includes("nav.forEach((item, index)")
    && read("frontend/src/layouts/DashboardLayout.jsx").includes("onPointerDown={() => prefetchDashboardRoute(item.to)}"),
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
