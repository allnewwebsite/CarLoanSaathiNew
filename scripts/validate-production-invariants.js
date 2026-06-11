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
  assert(/if \(!import\.meta\.env\.DEV\) return;/.test(authContext), "auth logging must be development-only");
  const logStatement = authContext.match(/console\.info\("\[CLS auth\]"[\s\S]*?\n  \}\);/)?.[0] || "";
  assert(logStatement, "auth decision log statement must remain detectable");
  assert(!/\bemail\s*:/.test(logStatement), "auth logging must not print email");
  assert(!/\btoken\s*:/.test(logStatement), "auth logging must not print token");
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

check("SSE ticket, stream, ack, and cleanup contracts remain present", () => {
  const realtimeRoutes = read("backend/routes/realtime.routes.js");
  const realtimeClient = read("frontend/src/services/realtimeClient.js");
  const authContext = read("frontend/src/context/AuthContext.jsx");
  includesAll(realtimeRoutes, ["router.post(\"/ticket\"", "router.get(\"/events\"", "router.post(\"/ack\""], "realtime routes");
  includesAll(realtimeClient, ["EventSource", "stopRealtimeClient", "/realtime/ack"], "realtime client");
  includesAll(authContext, ["stopRealtimeClient();", "teardownRealtimeSubscriptions();"], "auth cleanup");
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
    "Delete Executive?",
    "This action cannot be undone.",
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
    "canonicalEventType",
    "WHATSAPP_NOTIFICATION_DEDUPED",
    "processingWhatsAppKeys",
    "upsertRecord(\"whatsappQueue\", identity.notificationKey",
    "upsertRecord(\"notificationLogs\", notificationKey",
    ".filter((candidate) => !candidate.messageSid)",
    "status: \"processing\"",
    "processWhatsAppQueue({ queueId: payload?.queueId, limit: 1 })",
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
