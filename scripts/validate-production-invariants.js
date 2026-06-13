import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
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
  const authContext = read("frontend/src/context/AuthContext.jsx");
  const authController = read("backend/controllers/auth.controller.js");
  assert(!authContext.includes("[CLS auth]"), "frontend auth decision logging must remain disabled");
  assert(!authContext.includes("logAuthDecision"), "frontend auth session details must not be written to console");
  const backendLogStatements = [...authController.matchAll(/log(?:Info|Warn|Error)\([^;]+?\);/gs)].map((match) => match[0]).join("\n");
  assert(!/\bemail\s*:/.test(backendLogStatements), "backend auth telemetry must not print email");
  assert(!/\bsessionId\s*:/.test(backendLogStatements), "backend auth telemetry must not print session id");
});

check("SSE is the only dashboard realtime transport", () => {
  const realtimeHook = read("frontend/src/hooks/useRealtimeRefresh.js");
  const authContext = read("frontend/src/context/AuthContext.jsx");
  const monitoringCenter = read("frontend/src/pages/dashboard/AdminMonitoringCenter.jsx");
  assert(!fs.existsSync(path.join(root, "frontend/src/services/realtimeManager.js")), "legacy Firestore realtime manager must be removed");
  assert(!fs.existsSync(path.join(root, "frontend/src/services/firestoreListeners.js")), "legacy Firestore listener helpers must be removed");
  assert(!realtimeHook.includes("onSnapshot"), "dashboard realtime hooks must not open Firestore listeners");
  assert(realtimeHook.includes("cls:data-mutated"), "dashboard refresh must consume SSE mutation events");
  assert(realtimeHook.includes("cls:realtime-connection"), "dashboard refresh must reconcile after SSE reconnect");
  assert(!authContext.includes("setInterval"), "session validation must not poll");
  assert(!monitoringCenter.includes("setInterval"), "monitoring center must not poll");
});

check("executive lifecycle propagates over SSE", () => {
  const bankController = read("backend/controllers/bank.controller.js");
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
  const api = read("frontend/src/services/api.js");
  assert(!api.includes("carloansaathi-apkaapnasaathi.onrender.com"), "frontend must not hardcode Render API URL");
  includesAll(api, ["import.meta.env.VITE_API_BASE_URL", "import.meta.env.PROD ? \"/api\""], "api base URL");
});

check("Firestore direct-id collections avoid fallback query chains", () => {
  const firestoreService = read("backend/services/firestore.service.js");
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
  const subscriptionService = read("backend/services/subscription.service.js");
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
  const realtimeClient = read("frontend/src/services/realtimeClient.js");
  const authContext = read("frontend/src/context/AuthContext.jsx");
  const authMiddleware = read("backend/middleware/auth.js");
  includesAll(realtimeRoutes, ["router.post(\"/ticket\"", "router.get(\"/events\"", "router.post(\"/ack\""], "realtime routes");
  includesAll(realtimeClient, ["EventSource", "stopRealtimeClient", "/realtime/ack"], "realtime client");
  includesAll(authContext, ["stopRealtimeClient();"], "auth cleanup");
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
  const bankPanel = read("frontend/src/pages/bank/BankBranchManagerPanel.jsx");
  const bankController = read("backend/controllers/bank.controller.js");
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
  const bankPanel = read("frontend/src/pages/bank/BankBranchManagerPanel.jsx");
  const bankController = read("backend/controllers/bank.controller.js");
  const assignmentService = read("backend/services/assignment.service.js");
  const firestoreService = read("backend/services/firestore.service.js");
  const projectionService = read("backend/services/projection.service.js");
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
  const bankController = read("backend/controllers/bank.controller.js");
  const aggregateService = read("backend/services/bankAnalyticsAggregate.service.js");
  const firestoreService = read("backend/services/firestore.service.js");
  const bankPanel = read("frontend/src/pages/bank/BankBranchManagerPanel.jsx");
  const apiService = read("frontend/src/services/api.js");
  const realtimeClient = read("frontend/src/services/realtimeClient.js");
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
  const whatsappService = read("backend/services/whatsapp.service.js");
  const notificationService = read("backend/services/notification.service.js");
  const queueService = read("backend/services/queue.service.js");
  const queueWorkers = read("backend/services/queueWorkers.service.js");
  const realtimeService = read("backend/services/realtime.service.js");
  const realtimeClient = read("frontend/src/services/realtimeClient.js");
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
