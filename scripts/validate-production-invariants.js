import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readIfExists(relativePath) {
  const target = path.join(root, relativePath);
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
}

function readCombined(...relativePaths) {
  return relativePaths.map(readIfExists).join("\n");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function includesAll(source, snippets, label) {
  snippets.forEach((snippet) => {
    assert(source.includes(snippet), `${label} missing invariant: ${snippet}`);
  });
}

const checks = [];
function check(name, fn) {
  checks.push({ name, fn });
}

check("frontend lint uses ESLint 9 flat config", () => {
  assert(fs.existsSync(path.join(root, "frontend/eslint.config.js")), "frontend/eslint.config.js is required");
  includesAll(read("frontend/eslint.config.js"), ["@eslint/js", "jsx: true"], "eslint config");
});

check("uploads directory is created before Multer writes", () => {
  includesAll(read("backend/middleware/upload.js"), ["fs.mkdirSync(uploadDir, { recursive: true })", "multer.diskStorage"], "upload middleware");
});

check("production auth logging does not expose token or session details", () => {
  const authContext = readCombined("frontend/src/context/AuthContext.jsx", "frontend/src/context/AuthContextCore.jsx");
  const authController = readCombined("backend/controllers/auth.controller.js", "backend/controllers/auth.controller.impl.js", "backend/controllers/authLogin.controller.js");
  assert(!authContext.includes("[CLS auth]"), "frontend auth decision logging must remain disabled");
  assert(!authContext.includes("logAuthDecision"), "frontend auth session details must not be written to console");
  const backendLogStatements = [...authController.matchAll(/log(?:Info|Warn|Error)\([^;]+?\);/gs)].map((match) => match[0]).join("\n");
  assert(!/\bemail\s*:/.test(backendLogStatements), "backend auth telemetry must not print email");
  assert(!/\bsessionId\s*:/.test(backendLogStatements), "backend auth telemetry must not print session id");
});

check("SSE is the only dashboard realtime transport", () => {
  const realtimeHook = read("frontend/src/hooks/useRealtimeRefresh.js");
  const realtimeClient = readCombined("frontend/src/services/realtimeClient.js", "frontend/src/services/realtimeClientCore.js");
  const authContext = readCombined("frontend/src/context/AuthContext.jsx", "frontend/src/context/AuthContextCore.jsx");
  const monitoringCenter = read("frontend/src/pages/dashboard/AdminMonitoringCenter.jsx");
  assert(!fs.existsSync(path.join(root, "frontend/src/services/realtimeManager.js")), "legacy Firestore realtime manager must be removed");
  assert(!fs.existsSync(path.join(root, "frontend/src/services/firestoreListeners.js")), "legacy Firestore listener helpers must be removed");
  assert(!realtimeHook.includes("onSnapshot"), "dashboard realtime hooks must not open Firestore listeners");
  assert(realtimeHook.includes("cls:data-mutated"), "dashboard refresh must consume SSE mutation events");
  assert(realtimeHook.includes("cls:realtime-connection"), "dashboard refresh must reconcile after SSE reconnect");
  includesAll(realtimeHook, [
    "const refreshRef = useRef(onRefresh);",
    "const mutationFilterRef = useRef(mutationFilter);",
    "const stateRef = useRef(null);",
    "function mutationRefreshKey(refreshKey, detail = {})",
    "const MUTATION_DEDUPE_MS = 2000;",
    "if (!enabled || typeof window === \"undefined\") return undefined;",
  ], "stable realtime refresh hook");
  assert(!realtimeHook.includes("if (!enabled || typeof onRefresh !== \"function\")"), "realtime refresh hook must attach listeners even if callback appears after first render");
  includesAll(realtimeClient, [
    "connectionGeneration",
    "expectedGeneration !== connectionGeneration",
    "REALTIME_LEADER_PREFIX",
    "BroadcastChannel(REALTIME_EVENT_CHANNEL)",
    "writeLeader(activeIdentity)",
    "dispatchConnectionState(true, { shared: true, leaderTab: false })",
    "if (!remote) resetHeartbeatWatch();",
    "if (!remote) queueAck(event.id);",
    "function closeSource({ notify = true, forceNotify = false } = {})",
    "closeSource({ notify: false })",
    "closeSource({ forceNotify: true })",
  ], "single-tab SSE leader and reconnect guard");
  assert(!authContext.includes("setInterval"), "session validation must not poll");
  assert(!monitoringCenter.includes("setInterval"), "monitoring center must not poll");
});

check("executive lifecycle propagates over SSE", () => {
  const bankController = readCombined("backend/controllers/bank.controller.js", "backend/controllers/bank.controller.impl.js", "backend/controllers/bankExecutive.controller.js");
  const realtimeService = read("backend/services/realtime.service.js");
  includesAll(realtimeService, ["BANK_EXECUTIVE_CREATED", "BANK_EXECUTIVE_DELETED"], "realtime executive events");
  includesAll(bankController, [
    "eventType: REALTIME_EVENTS.BANK_EXECUTIVE_CREATED",
    "eventType: REALTIME_EVENTS.BANK_EXECUTIVE_DELETED",
  ], "bank executive lifecycle");
});

check("monitoring detects repeated API and SSE disconnect failures", () => {
  const monitoring = read("backend/services/monitoringCenter.service.js");
  includesAll(monitoring, [
    "REALTIME_DISCONNECT_STORM_THRESHOLD",
    "disconnectStormDetected",
    "REPEATED_API_FAILURE_THRESHOLD",
    "repeatedFailuresDetected",
  ], "monitoring failure detection");
});

check("production App Check is not accidentally bypassed", () => {
  const registrationSecurity = read("backend/middleware/registrationSecurity.js");
  includesAll(registrationSecurity, [
    "process.env.NODE_ENV === \"production\"",
    "process.env.ENFORCE_APP_CHECK !== \"false\"",
    "firebaseAdmin.appCheck().verifyToken(token)",
  ], "registration security");
});

check("frontend API base URL is environment driven", () => {
  const api = readCombined("frontend/src/services/api.js", "frontend/src/services/apiBaseUrl.js");
  assert(!api.includes("carloansaathi-apkaapnasaathi.onrender.com"), "frontend must not hardcode Render API URL");
  includesAll(api, ["import.meta.env.VITE_API_BASE_URL", "import.meta.env.PROD ? \"/api\""], "api base URL");
});

check("frontend keeps Firestore and Storage out of the initial registration bundles", () => {
  const viteConfig = read("frontend/vite.config.js");
  const dealerRegistration = readCombined(
    "frontend/src/pages/DealerRegistrationPage.jsx",
    "frontend/src/pages/dealerRegistration/DealerRegistrationFormPage.jsx",
  );
  const bankRegistration = readCombined(
    "frontend/src/pages/public/BankRegistration.jsx",
    "frontend/src/pages/public/BankRegistrationParts.jsx",
  );
  const uploadHelper = read("frontend/src/services/firebaseUpload.js");
  assert(!fs.existsSync(path.join(root, "frontend/src/services/firebaseDb.js")), "frontend Firestore db wrapper must stay removed");
  assert(!viteConfig.includes("firebase/firestore"), "Vite manual chunks must not force Firestore into production bundles");
  assert(!dealerRegistration.includes("firebase/firestore"), "dealer registration must not import Firestore client APIs");
  assert(!dealerRegistration.includes("setDoc("), "dealer registration must not write duplicate Firestore metadata from the browser");
  assert(!dealerRegistration.includes("serverTimestamp"), "dealer registration must not import Firestore timestamp helpers");
  assert(!dealerRegistration.includes("firebase/storage"), "dealer registration must lazy-load Firebase Storage only on upload");
  assert(!bankRegistration.includes("firebase/storage"), "bank registration must lazy-load Firebase Storage only on upload");
  assert(
    dealerRegistration.includes("import(\"../services/firebaseUpload.js\")")
      || dealerRegistration.includes("import(\"../../services/firebaseUpload.js\")"),
    "dealer registration upload lazy import missing invariant: import(\"../services/firebaseUpload.js\") or import(\"../../services/firebaseUpload.js\")"
  );
  includesAll(bankRegistration, ["import(\"../../services/firebaseUpload.js\")"], "bank registration upload lazy import");
  includesAll(uploadHelper, ["uploadStorageFile", "deleteStoragePath", "uploadBytesResumable"], "lazy Firebase upload helper");
});

check("frontend app shell keeps dashboard, Sentry, and motion out of startup", () => {
  const main = read("frontend/src/main.jsx");
  const errorBoundary = read("frontend/src/components/ErrorBoundary.jsx");
  const router = read("frontend/src/routes/router.jsx");
  const viteConfig = read("frontend/vite.config.js");
  const authContext = readCombined("frontend/src/context/AuthContext.jsx", "frontend/src/context/AuthContextCore.jsx");
  const api = readCombined("frontend/src/services/api.js", "frontend/src/services/apiAppCheck.js");
  const dealerRegistration = read("frontend/src/pages/DealerRegistrationPage.jsx");
  const bankRegistration = read("frontend/src/pages/public/BankRegistration.jsx");
  assert(!main.includes("import { initFrontendMonitoring }"), "main entry must not statically import Sentry monitoring");
  includesAll(main, ["import(\"./services/monitoring.js\")", "requestIdleCallback"], "lazy Sentry startup");
  assert(!errorBoundary.includes("import { captureError }"), "error boundary must not statically import Sentry monitoring");
  includesAll(errorBoundary, ["import(\"../services/monitoring.js\")"], "lazy Sentry error capture");
  assert(!router.includes("import { DashboardLayout }"), "router must not statically import dashboard layout into public startup");
  includesAll(router, ["const DashboardLayout = lazy(() => import(\"../layouts/DashboardLayout.jsx\")"], "lazy dashboard layout");
  assert(!viteConfig.includes("motion: [\"framer-motion\"]"), "Vite manual chunks must not force Framer Motion into shared startup chunks");
  assert(!viteConfig.includes("icons: [\"lucide-react\"]"), "Vite manual chunks must not force Lucide icons into a shared startup chunk");
  assert(!authContext.includes("from \"firebase/auth\""), "AuthContext must lazy-load Firebase Auth");
  assert(!authContext.includes("from \"../services/firebase"), "AuthContext must not statically import Firebase services");
  includesAll(authContext, ["import(\"firebase/auth\")", "import(\"../services/firebaseAuth.js\")"], "lazy Firebase Auth");
  assert(!authContext.includes("from \"../services/api.js\""), "AuthContext must lazy-load the API client");
  assert(!authContext.includes("from \"../services/realtimeClient.js\""), "AuthContext must lazy-load the realtime client");
  includesAll(authContext, ["import(\"../services/api.js\")", "import(\"../services/realtimeClient.js\")"], "lazy API and realtime client");
  assert(!api.includes("from \"firebase/app-check\""), "API client must lazy-load Firebase App Check");
  assert(!api.includes("from \"./firebase.js\""), "API client must not statically import Firebase");
  includesAll(api, ["import(\"firebase/app-check\")"], "lazy Firebase App Check");
  assert(
    api.includes("import(\"./firebase.js\")") || api.includes("import(\"./firebaseAppCheck.js\")"),
    "lazy Firebase App Check missing invariant: import(\"./firebase.js\") or import(\"./firebaseAppCheck.js\")"
  );
  assert(!dealerRegistration.includes("services/firebase.js"), "dealer registration must not statically import Firebase");
  assert(!bankRegistration.includes("services/firebase.js"), "bank registration must not statically import Firebase");
});

check("Firestore direct-id collections avoid fallback query chains", () => {
  const firestoreService = readCombined("backend/services/firestore.service.js", "backend/services/firestoreCore.service.js");
  includesAll(firestoreService, [
    "DIRECT_ID_ONLY_COLLECTIONS",
    "DIRECT_ID_ONLY_COLLECTIONS.has(collection)",
    "where(\"caseId\", \"==\", id)",
  ], "firestore getRecord");
});

check("lead creation and lead status APIs remain registered", () => {
  const leadRoutes = read("backend/routes/lead.routes.js");
  const dealerRoutes = read("backend/routes/dealer.routes.js");
  includesAll(leadRoutes, ["router.post(\"/public\"", "router.post(\"/create\"", "router.patch(\"/:id/status\""], "lead routes");
  includesAll(dealerRoutes, ["router.post(\"/leads\"", "createDealerLead"], "dealer lead routes");
});

check("subscription billing is server-verified and blocks only lead creation", () => {
  const subscriptionService = readCombined("backend/services/subscription.service.js", "backend/services/subscriptionCore.service.js");
  const subscriptionMiddleware = read("backend/middleware/subscription.js");
  const dealerRoutes = read("backend/routes/dealer.routes.js");
  const leadRoutes = read("backend/routes/lead.routes.js");
  const adminRoutes = read("backend/routes/admin.routes.js");
  const billingUi = read("frontend/src/components/PlanBillingModal.jsx");
  const portalMenu = read("frontend/src/components/PortalUserMenu.jsx");
  const firestoreRules = read("firestore.rules");
  includesAll(subscriptionService, [
    "monthlyAmount: 15_000",
    "trialDays: 60",
    "billingCycleDays: 30",
    "validRazorpaySignature",
    "verifiedRazorpayPayment",
    "payment.status === \"captured\"",
    "transaction.set(\"subscriptionPayments\"",
    "transaction.set(\"subscriptionInvoices\"",
    "REALTIME_EVENTS.SUBSCRIPTION_RENEWED",
  ], "subscription service");
  includesAll(subscriptionMiddleware, [
    "assertLeadCreationAllowed",
    "SUBSCRIPTION_EXPIRED",
  ], "subscription middleware");
  includesAll(dealerRoutes, [
    "router.post(\"/leads\", requireLeadCreationSubscription",
    "router.get(\"/billing\"",
    "router.post(\"/billing/order\"",
    "router.post(\"/billing/verify\"",
  ], "Finance Desk subscription routes");
  includesAll(leadRoutes, [
    "router.post(\"/create\", authenticate, requireRole(ROLES.FINANCE_DESK), requireLeadCreationSubscription",
    "router.post(\"/\", requireRole(ROLES.FINANCE_DESK), requireLeadCreationSubscription",
  ], "lead subscription guards");
  includesAll(adminRoutes, [
    "router.get(\"/subscriptions/:dealershipId\"",
    "router.post(\"/subscriptions/:dealershipId/extend\"",
    "router.post(\"/subscriptions/:dealershipId/trial\"",
    "router.post(\"/subscriptions/:dealershipId/suspend\"",
  ], "admin subscription routes");
  includesAll(billingUi, [
    "Plan & Billing",
    "Renew Subscription",
    "Payment History",
    "Invoice History",
    "cls:data-mutated",
  ], "billing UI");
  assert(!billingUi.includes("setInterval("), "billing UI must not poll");
  includesAll(portalMenu, [
    "user?.role === \"finance-desk\"",
    "<PlanBillingModal",
  ], "Finance Desk-only billing menu");
  includesAll(firestoreRules, [
    "match /dealershipSubscriptions/{id}",
    "match /subscriptionPayments/{id}",
    "match /subscriptionInvoices/{id}",
    "allow create, update, delete: if false;",
  ], "subscription Firestore rules");
});

check("SSE ticket, stream, ack, and cleanup contracts remain present", () => {
  const realtimeRoutes = read("backend/routes/realtime.routes.js");
  const realtimeClient = readCombined("frontend/src/services/realtimeClient.js", "frontend/src/services/realtimeClientCore.js");
  const authContext = readCombined("frontend/src/context/AuthContext.jsx", "frontend/src/context/AuthContextCore.jsx");
  const authMiddleware = read("backend/middleware/auth.js");
  includesAll(realtimeRoutes, ["router.post(\"/ticket\"", "router.get(\"/events\"", "router.post(\"/ack\""], "realtime routes");
  includesAll(realtimeClient, ["EventSource", "stopRealtimeClient", "/realtime/ack"], "realtime client");
  includesAll(authContext, ["stopRealtimeIfLoaded();", "import(\"../services/realtimeClient.js\")"], "lazy auth realtime cleanup");
  includesAll(authMiddleware, [
    "REALTIME_TICKET_PATH = \"/api/realtime/ticket\"",
    "realtimeTicketFastAuthEnabled",
    "tokenFreshEnoughForRealtime",
    "REALTIME-AUTH-FAST-PATH",
    "realtime_ticket_fast_auth_skipped",
  ], "realtime ticket auth");
});

check("bank executive management exposes only view and permanent delete", () => {
  const bankRoutes = read("backend/routes/bank.routes.js");
  const bankPanel = readCombined(
    "frontend/src/pages/bank/BankBranchManagerPanel.jsx",
    "frontend/src/pages/bank/BankExecutiveManagementPage.jsx",
    "frontend/src/pages/bank/BankExecutiveManagementParts.jsx",
  );
  const bankController = readCombined("backend/controllers/bank.controller.js", "backend/controllers/bank.controller.impl.js", "backend/controllers/bankExecutive.controller.js");
  includesAll(bankRoutes, ["router.delete(\"/executives/:executiveId\""], "bank executive routes");
  assert(!bankRoutes.includes("/executives/:executiveId/lifecycle"), "bank executive lifecycle route must be removed");
  assert(!bankRoutes.includes("/executives/:executiveId/reset-password"), "bank executive reset-password route must be removed");
  includesAll(bankPanel, [
    ">View</button>",
    ">Delete</button>",
    "executiveDeleteId",
    "api.delete(`/bank/executives/${encodeURIComponent(executiveDeleteId(pendingDelete))}`)",
    "DeleteExecutiveModal",
    "Delete Executive",
    "You are about to permanently delete this executive.",
    "This action cannot be undone.",
    "fixed inset-0 z-50",
  ], "bank executive UI");
  ["Suspend", "Activate", "Reset Password", "Transfer Branch", "Job ID"].forEach((text) => {
    assert(!bankPanel.includes(text), `bank executive UI must not include ${text}`);
  });
  includesAll(bankController, [
    "ACTIVE_EXECUTIVE_LEADS",
    "Executive has active cases.",
    "BANK_EXECUTIVE_DELETED",
    "resolveBankExecutiveForMutation",
    "queryExecutiveSummaryProjection",
    "cleanupExecutiveLinkedRecords",
  ], "bank executive delete controller");
});

check("bank case reassignment uses explicit same-branch executive selection", () => {
  const bankPanel = readCombined(
    "frontend/src/pages/bank/BankBranchManagerPanel.jsx",
    "frontend/src/pages/bank/ReassignLeadDialog.jsx",
    "frontend/src/pages/bank/bankManager.hooks.js",
  );
  const bankController = readCombined("backend/controllers/bank.controller.js", "backend/controllers/bank.controller.impl.js", "backend/controllers/bankLeadWorkflow.controller.js");
  const assignmentService = read("backend/services/assignment.service.js");
  const firestoreService = readCombined("backend/services/firestore.service.js", "backend/services/firestoreCore.service.js", "backend/services/firestoreTransaction.service.js");
  const projectionService = readCombined("backend/services/projection.service.js", "backend/services/projectionCore.service.js", "backend/services/projectionLead.service.js");
  includesAll(bankPanel, [
    "Reassign Case",
    "Select New Executive",
    "newExecutiveId",
    "branchMatch(lead, executive)",
    "No eligible executives found.",
    "CASE_REASSIGNMENT_EXECUTIVE_FILTER",
  ], "bank reassignment UI");
  includesAll(bankController, [
    "req.body.newExecutiveId",
    "Case reassigned successfully",
    "BANK_MANAGER_REASSIGN",
  ], "bank reassignment controller");
  includesAll(assignmentService, [
    "runRecordTransaction",
    "resolveTargetExecutive",
    "queryBankExecutiveCandidates",
    "CASE_REASSIGNMENT_EXECUTIVE_FILTER",
    "INVALID_REASSIGNMENT_TARGET",
    "SAME_EXECUTIVE_REASSIGNMENT",
    "removeLeadExecutiveProjection",
    "Case Reassigned",
    "refreshExecutiveSummary",
    "REALTIME_EVENTS.EXECUTIVE_REASSIGNED",
  ], "bank reassignment service");
  includesAll(firestoreService, ["runRecordTransaction"], "firestore transaction helper");
  includesAll(projectionService, ["removeLeadExecutiveProjection"], "old executive projection cleanup");
});

check("bank analytics uses maintained aggregate data", () => {
  const bankController = readCombined("backend/controllers/bank.controller.js", "backend/controllers/bank.controller.impl.js", "backend/controllers/bankAnalytics.controller.js");
  const aggregateService = read("backend/services/bankAnalyticsAggregate.service.js");
  const firestoreService = readCombined("backend/services/firestore.service.js", "backend/services/firestoreCore.service.js");
  const bankPanel = readCombined(
    "frontend/src/pages/bank/BankBranchManagerPanel.jsx",
    "frontend/src/pages/bank/bankManager.hooks.js",
    "frontend/src/pages/bank/BankAnalyticsPage.jsx",
  );
  const apiService = readCombined("frontend/src/services/api.js", "frontend/src/services/apiMutationEvents.js", "frontend/src/services/apiCache.js");
  const realtimeClient = readCombined("frontend/src/services/realtimeClient.js", "frontend/src/services/realtimeClientCore.js");
  includesAll(bankController, [
    "getBankAnalyticsAggregate",
    "source: \"bank-analytics-aggregates\"",
    "aggregateReady: Boolean(aggregate)",
    "executivePagination",
  ], "bank analytics backend");
  includesAll(aggregateService, [
    "bankAnalyticsSummaries",
    "bankAnalyticsLeadStates",
    "bankExecutiveAnalytics",
    "bankRecentCases",
    "rebuildBankAnalyticsAggregates",
  ], "bank analytics aggregate service");
  includesAll(firestoreService, [
    "syncBankAnalyticsAggregate(record)",
    "bulkUpsertRecords",
  ], "bank analytics write synchronization");
  assert(!bankController.includes("collectLiveBankAnalyticsLeads"), "bank analytics must not scan live leads");
  assert(!bankController.includes("getBankAnalyticsFromLeadScan"), "legacy bank analytics lead scan must be removed");
  includesAll(bankPanel, [
    "bankAnalyticsMutationFilter",
    "data?.branches ?? data?.branchMetrics?.length",
    "data?.executives ?? data?.executivePerformance?.length",
  ], "bank analytics frontend");
  includesAll(apiService, ["\"/bank/analytics\""], "api lead cache invalidation");
  includesAll(realtimeClient, ["\"/bank/analytics\""], "SSE lead cache invalidation");
});

check("WhatsApp business notifications are idempotent and backend-only", () => {
  const whatsappService = readCombined("backend/services/whatsapp.service.js", "backend/services/whatsappCore.service.js");
  const notificationService = read("backend/services/notification.service.js");
  const queueService = read("backend/services/queue.service.js");
  const queueWorkers = read("backend/services/queueWorkers.service.js");
  const realtimeService = read("backend/services/realtime.service.js");
  const realtimeClient = readCombined("frontend/src/services/realtimeClient.js", "frontend/src/services/realtimeClientCore.js");
  const firestoreRules = read("firestore.rules");
  const firestoreIndexes = read("firestore.indexes.json");
  includesAll(whatsappService, [
    "notificationIdentity",
    "metadata.eventVersion",
    "canonicalEventType",
    "WHATSAPP_NOTIFICATION_DEDUPED",
    "processingWhatsAppKeys",
    "upsertRecord(\"whatsappQueue\", identity.notificationKey",
    "upsertRecord(\"notificationLogs\", notificationKey",
    ".filter((candidate) => !candidate.messageSid)",
    "status: \"processing\"",
    "processWhatsAppQueue({ queueId: payload?.queueId, limit: 1 })",
    "const eventVersion = lead.statusUpdatedAt",
  ], "WhatsApp idempotency");
  includesAll(notificationService, ["queueWhatsAppNotification", "publishRealtimeEvent"], "notification service");
  includesAll(queueService, ["jobId: options.jobId || payload.jobId || undefined"], "queue stable job ids");
  includesAll(queueWorkers, ["processWhatsAppQueue({ queueId: payload?.queueId })"], "WhatsApp queue worker");
  includesAll(firestoreRules, ["match /whatsappQueue/{queueId}", "match /notificationLogs/{logId}"], "Firestore WhatsApp rules");
  includesAll(firestoreIndexes, [
    "\"collectionGroup\": \"whatsappQueue\"",
    "\"fieldPath\": \"status\", \"order\": \"ASCENDING\"",
    "\"fieldPath\": \"createdAt\", \"order\": \"DESCENDING\"",
    "\"fieldPath\": \"recipientId\", \"order\": \"ASCENDING\"",
    "\"fieldPath\": \"phoneNumber\", \"order\": \"ASCENDING\"",
    "\"collectionGroup\": \"notificationLogs\"",
  ], "Firestore WhatsApp indexes");
  assert(!realtimeService.includes("queueWhatsAppNotification"), "SSE service must not queue WhatsApp sends");
  assert(!realtimeService.includes("sendWhatsApp"), "SSE service must not send WhatsApp messages");
  assert(!realtimeClient.includes("queueWhatsAppNotification"), "frontend realtime client must not queue WhatsApp sends");
  assert(!realtimeClient.includes("sendWhatsApp"), "frontend realtime client must not send WhatsApp messages");
});

check("Redis queues and realtime pubsub are explicit opt-in", () => {
  const queueService = read("backend/services/queue.service.js");
  const realtimeService = read("backend/services/realtime.service.js");
  const envExample = read("backend/.env.example");
  includesAll(queueService, [
    "process.env.ENABLE_REDIS_QUEUE === \"true\"",
    "ENABLE_REDIS_QUEUE is not true",
    "local-fallback",
    "queueDisabledLogged",
  ], "queue Redis opt-in");
  includesAll(realtimeService, [
    "process.env.ENABLE_REALTIME_REDIS === \"true\"",
    "Realtime Redis publisher unavailable; local SSE remains active",
    "Realtime Redis subscriber unavailable; local SSE remains active",
  ], "realtime Redis opt-in");
  includesAll(envExample, [
    "ENABLE_REDIS_QUEUE=false",
    "ENABLE_REALTIME_REDIS=false",
  ], "Redis opt-in env example");
});

check("registration email verification gates remain enforced", () => {
  const authContext = readCombined("frontend/src/context/AuthContext.jsx", "frontend/src/context/AuthContextCore.jsx");
  const dealerController = readCombined("backend/controllers/dealer.controller.js", "backend/controllers/dealer.controller.impl.js", "backend/controllers/dealerRegistration.controller.js");
  const bankController = readCombined("backend/controllers/bank.controller.js", "backend/controllers/bank.controller.impl.js", "backend/controllers/bankRegistration.controller.js");
  const router = read("frontend/src/routes/router.jsx");
  includesAll(authContext, [
    "dealer: \"/dealer-registration/verify-email\"",
    "bank: \"/bank-registration/verify-email\"",
    "createRegistrationAccount({ email, password, portal: \"dealer\" })",
    "createRegistrationAccount({ email, password, portal: \"bank\" })",
    "await credential.user.reload();",
    "await currentUser.reload();",
    "getIdToken(true)",
  ], "frontend registration verification");
  includesAll(dealerController, [
    "assertDealerRegistrationEmailVerified",
    "dealerEmailPendingPayload",
    "accountState: \"EMAIL_PENDING\"",
    "accountState: \"EMAIL_VERIFIED\"",
    "accountState: \"PENDING_APPROVAL\"",
    "accountState: \"APPROVED\"",
    "Your dealership registration was rejected.",
    "Your dealership account is suspended.",
    "Verify your email address before submitting dealership registration.",
    "redirectTo: \"/dealer-registration/verify-email\"",
    "/dealer-registration/rejected",
    "/dealer-registration/suspended",
  ], "dealer registration backend");
  includesAll(bankController, [
    "assertBankRegistrationEmailVerified",
    "bankEmailPendingPayload",
    "accountState: \"EMAIL_PENDING\"",
    "accountState: \"EMAIL_VERIFIED\"",
    "accountState: \"PENDING_APPROVAL\"",
    "accountState: \"APPROVED\"",
    "Your bank registration was rejected.",
    "Your bank account is suspended.",
    "Verify your email address before submitting bank registration.",
    "redirectTo: \"/bank-registration/verify-email\"",
    "/bank-registration/rejected",
    "/bank-registration/suspended",
  ], "bank registration backend");
  includesAll(router, [
    "/dealer-registration/verify-email",
    "/dealer-registration/rejected",
    "/dealer-registration/suspended",
    "/bank-registration/verify-email",
    "/bank-registration/rejected",
    "/bank-registration/suspended",
  ], "registration status routes");
});

check("dealership GSTIN is restored while bank GSTIN stays removed", () => {
  const dealerRegistration = readCombined(
    "frontend/src/pages/DealerRegistrationPage.jsx",
    "frontend/src/pages/dealerRegistration/DealerRegistrationFormPage.jsx",
    "frontend/src/pages/dealerRegistration/DealerRegistrationFormSections.jsx",
    "frontend/src/pages/dealerRegistration/dealerRegistration.helpers.js",
    "frontend/src/pages/dealerRegistration/dealerRegistration.constants.js",
  );
  const bankRegistration = readCombined(
    "frontend/src/pages/public/BankRegistration.jsx",
    "frontend/src/pages/public/BankRegistrationParts.jsx",
  );
  const dealerController = readCombined("backend/controllers/dealer.controller.js", "backend/controllers/dealer.controller.impl.js", "backend/controllers/dealerRegistration.controller.js");
  const bankController = readCombined("backend/controllers/bank.controller.js", "backend/controllers/bank.controller.impl.js", "backend/controllers/bankRegistration.controller.js");
  const adminController = readCombined("backend/controllers/admin.controller.js", "backend/controllers/admin.controller.impl.js", "backend/controllers/adminApprovals.controller.js");
  const superAdmin = read("frontend/src/pages/dashboard/SuperAdminDashboard.jsx");
  const superAdminDealership = readCombined(
    "frontend/src/pages/dashboard/SuperAdminDashboard.jsx",
    "frontend/src/pages/dashboard/superAdmin/SuperAdminDealershipDetailPage.jsx",
    "frontend/src/pages/dashboard/superAdmin/SuperAdminApprovalDetailPage.jsx",
  );
  assert(!dealerRegistration.includes("officialDealershipEmail"), "dealer registration UI must not contain Official Dealership Email state or inputs");
  includesAll(dealerRegistration, ["gstinNumber", "GSTIN Number", "06ABCDE1234F1Z5"], "dealer GSTIN registration UI");
  includesAll(dealerController, ["requiredGstin", "gstinNumber: requiredGstin", "gstinNumber: dealership.gstinNumber"], "dealer GSTIN backend");
  includesAll(superAdminDealership, ["[\"GSTIN\", dealer.gstinNumber || dealer.dealership?.gstinNumber]", "[\"GSTIN\", item.gstinNumber || item.dealership?.gstinNumber]"], "dealer GSTIN admin review");
  assert(!bankRegistration.includes("gstin"), "bank registration UI must not contain GSTIN state, validation, or payload");
  assert(!bankRegistration.includes("GSTIN"), "bank registration UI must not show GSTIN label or validation text");
  assert(!bankRegistration.includes("GST Certificate"), "bank registration UI must not request GST Certificate");
  assert(!bankController.includes("req.body.gstin"), "bank registration backend must not read GSTIN from request body");
  assert(!bankController.includes("gstin:"), "bank registration backend must not write GSTIN for new registrations");
  const approvalFields = adminController.match(/const APPROVAL_LIST_FIELDS = \[[\s\S]*?\];/)?.[0] || "";
  assert(!approvalFields.includes("\"gstin\""), "admin bank approval projection must not include GSTIN");
  const bankApprovalDetail = superAdmin.match(/const sections = type === "banks"[\s\S]*?: \[/)?.[0] || superAdmin;
  assert(!bankApprovalDetail.includes("[\"GSTIN\""), "admin bank review must not display GSTIN");
  includesAll(dealerController, ["stripRemovedDealershipFields", "officialDealershipEmail"], "legacy dealership email sanitizer");
});

check("public header hides dealership menu while preserving dealer entry points", () => {
  const publicLayout = read("frontend/src/layouts/PublicLayout.jsx");
  const router = read("frontend/src/routes/router.jsx");
  const publicCtas = read("frontend/src/components/PublicConversionCtas.jsx");
  assert(!publicLayout.includes("For Dealerships"), "public header must not show For Dealerships");
  assert(!publicLayout.includes("key: \"dealerships\""), "public header must not keep dealership role group");
  assert(!publicLayout.includes("Users"), "public header must not import or show dealership icon");
  assert(!publicLayout.includes("Dealer Registration"), "public header dropdown must not link dealer registration");
  includesAll(publicLayout, ["For Banks", "Bank Registration", "key: \"banks\"", "mobileSections"], "bank header menu");
  includesAll(router, [
    "{ path: \"/dealer/register\", element: <DealerRegistrationPage /> }",
    "{ path: \"/dealer-registration\", element: <DealerRegistrationPage /> }",
    "{ path: \"/dealer-registration/form\", element: <DealerRegistrationFormPage /> }",
  ], "dealer routes preserved");
  includesAll(publicCtas, ["to=\"/dealer/register\"", "Dealer"], "dealer CTAs preserved");
});

check("dashboard Firestore cost optimizations stay in place", () => {
  const bankService = read("backend/services/bank.service.js");
  const dealershipService = read("backend/services/dealership.service.js");
  const superAdmin = readCombined(
    "frontend/src/pages/dashboard/SuperAdminDashboard.jsx",
    "frontend/src/pages/dashboard/superAdmin/superAdmin.hooks.js",
    "frontend/src/pages/dashboard/superAdmin/SuperAdminLeadDetailPage.jsx",
  );
  includesAll(bankService, [
    "queryRecords(\"bankBranchCatalog\"",
    "if (catalogRows.length) {",
    "return catalogRows.sort",
  ], "bank branch catalog fast path");
  includesAll(dealershipService, [
    "const availableBranches = await getBankBranchCatalog();",
    "const branchesByIfsc = new Map",
    "const activeLeadChecks = await Promise.all",
    "await Promise.all(uniqueCodes.map",
    "await Promise.all(removedIFSCs.map",
  ], "dealer tie-up bulk update");
  includesAll(superAdmin, [
    "function useAdminEcosystem({ includeAudit = false } = {})",
    "includeAudit ? api.get(\"/admin/audit-logs\") : Promise.resolve({ data: [] })",
    "useAdminEcosystem({ includeAudit: true })",
  ], "admin audit lazy loading");
});

check("auth hot path avoids avoidable Firestore reads and writes", () => {
  const authController = readCombined("backend/controllers/auth.controller.js", "backend/controllers/auth.controller.impl.js", "backend/controllers/authLogin.controller.js", "backend/controllers/authSession.controller.js");
  includesAll(authController, [
    "AUTH_ENTITLEMENT_CACHE_TTL_MS",
    "auth:dealership-entitlement:",
    "getDealershipSubscription(dealershipId, { initialize: false })",
    "auth:approved-dealership:",
    "AUTH_DEALERSHIP_ACCESS_CACHE_TTL_MS",
    "scheduleLoginMaintenance(req.requestId",
    "name: \"canonical-session-user\"",
    "name: \"firebase-claims\"",
    "name: \"password-lifecycle\"",
    "name: \"login-activity\"",
  ], "auth login and restore fast path");
  assert(!authController.includes("Object.assign(user, await accountPresentation"), "restore session must not perform presentation Firestore reads before response");
});

let failed = 0;
for (const item of checks) {
  try {
    item.fn();
    console.log(`PASS ${item.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${item.name}`);
    console.error(`  ${error.message}`);
  }
}

if (failed) {
  console.error(`\n${failed} production invariant check(s) failed.`);
  process.exit(1);
}

console.log(`\n${checks.length} production invariant checks passed.`);
