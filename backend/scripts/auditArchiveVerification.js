import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(scriptDir, "..");
const workspaceDir = path.resolve(backendDir, "..");
const artifactDir = path.join(workspaceDir, "audit-artifacts", "archive-verification");

// This audit must be isolated from every configured Firebase project.
process.env.DOTENV_CONFIG_PATH = path.join(artifactDir, "__no_audit_env_file__");
delete process.env.FIREBASE_PROJECT_ID;
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;

const [
  firestoreModule,
  archivalModule,
  leadQueryModule,
  statusModule,
] = await Promise.all([
  import("../services/firestore.service.js"),
  import("../services/archival.service.js"),
  import("../services/leadQuery.service.js"),
  import("../utils/status.constants.js"),
]);

const {
  createRecord,
  getRecord,
  queryRecords,
  updateRecord,
} = firestoreModule;
const { archiveClosedLeads } = archivalModule;
const {
  queryAllLeads,
  queryArchivedLeads,
  queryDealershipLeads,
} = leadQueryModule;
const { LEAD_STATUSES } = statusModule;

const startedAt = new Date();
const runId = `archive-audit-${startedAt.toISOString().replace(/[:.]/g, "-")}`;
const dealershipId = `${runId}-dealer`;
const oldRejectedDate = new Date(startedAt.getTime() - 91 * 24 * 60 * 60 * 1000).toISOString();
const oldDisbursedDate = new Date(startedAt.getTime() - 181 * 24 * 60 * 60 * 1000).toISOString();
const activeDate = new Date(startedAt.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
const checks = [];
const logLines = [];

function log(message, data) {
  const suffix = data === undefined ? "" : ` ${JSON.stringify(data)}`;
  logLines.push(`[${new Date().toISOString()}] ${message}${suffix}`);
}

function check(name, operation) {
  try {
    operation();
    checks.push({ name, status: "PASS" });
    log(`PASS ${name}`);
  } catch (error) {
    checks.push({ name, status: "FAIL", error: error.message });
    log(`FAIL ${name}`, { error: error.message });
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function selectedBusinessData(record) {
  return {
    id: record.id,
    caseId: record.caseId,
    dealershipId: record.dealershipId,
    status: record.status,
    statusUpdatedAt: record.statusUpdatedAt,
    customerName: record.customerName,
    customerPhone: record.customerPhone,
    requestedAmount: record.requestedAmount,
    vehicle: record.vehicle,
    auditMarker: record.auditMarker,
    createdAt: record.createdAt,
  };
}

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderChecks(items) {
  return items.map((item) => `
    <tr>
      <td>${htmlEscape(item.name)}</td>
      <td class="${item.status === "PASS" ? "pass" : "fail"}">${item.status}</td>
      <td>${htmlEscape(item.error || "")}</td>
    </tr>`).join("");
}

function reportShell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(title)}</title>
  <style>
    :root { color-scheme: light; font-family: Inter, Segoe UI, Arial, sans-serif; }
    body { margin: 0; background: #f1f5f9; color: #0f172a; }
    main { max-width: 1180px; margin: 0 auto; padding: 36px; }
    h1 { margin: 0 0 8px; font-size: 30px; }
    h2 { margin-top: 28px; font-size: 20px; }
    .subtitle { color: #475569; margin-bottom: 24px; }
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
    .card, table, pre { background: white; border: 1px solid #cbd5e1; border-radius: 10px; }
    .card { padding: 18px; }
    .metric { font-size: 28px; font-weight: 700; margin-top: 8px; }
    .pass { color: #047857; font-weight: 700; }
    .fail { color: #b91c1c; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; overflow: hidden; }
    th, td { padding: 11px 13px; border-bottom: 1px solid #e2e8f0; text-align: left; }
    th { background: #e2e8f0; }
    pre { padding: 16px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; }
    .note { padding: 14px 16px; border-left: 4px solid #2563eb; background: #dbeafe; }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

log("Archive verification audit started", { runId, storage: "isolated-memory" });

const common = {
  dealershipId,
  customerName: "Archive Audit Customer",
  customerPhone: "9999999999",
  requestedAmount: 875000,
  vehicle: { make: "Audit Motors", model: "Integrity", variant: "V1" },
  auditMarker: runId,
};

const active = await createRecord("leads", {
  ...common,
  id: `${runId}-active`,
  caseId: `CLS-ACTIVE-${runId}`,
  customerName: "Active Audit Customer",
  status: LEAD_STATUSES.CONTACTED,
  statusUpdatedAt: activeDate,
  updatedAt: activeDate,
});
const rejected = await createRecord("leads", {
  ...common,
  id: `${runId}-rejected`,
  caseId: `CLS-REJECTED-${runId}`,
  customerName: "Rejected Audit Customer",
  status: LEAD_STATUSES.REJECTED,
  statusUpdatedAt: oldRejectedDate,
  updatedAt: oldRejectedDate,
});
const disbursed = await createRecord("leads", {
  ...common,
  id: `${runId}-disbursed`,
  caseId: `CLS-DISBURSED-${runId}`,
  customerName: "Disbursed Audit Customer",
  status: LEAD_STATUSES.DISBURSED,
  statusUpdatedAt: oldDisbursedDate,
  updatedAt: oldDisbursedDate,
});

const original = {
  active: clone(active),
  rejected: clone(rejected),
  disbursed: clone(disbursed),
};
log("Fixture leads created", {
  active: active.id,
  rejected: rejected.id,
  disbursed: disbursed.id,
});

const firstRun = await archiveClosedLeads({ limit: 50 });
const afterFirst = {
  active: await getRecord("leads", active.id),
  rejected: await getRecord("leads", rejected.id),
  disbursed: await getRecord("leads", disbursed.id),
};
log("First archival execution completed", firstRun);

check("Active lead remains unarchived", () => assert.notEqual(afterFirst.active.isArchived, true));
check("Rejected lead is archived after 90 days", () => {
  assert.equal(afterFirst.rejected.isArchived, true);
  assert.equal(afterFirst.rejected.archiveReason, "AUTO_REJECTED_90_DAYS");
});
check("Disbursed lead is archived after 180 days", () => {
  assert.equal(afterFirst.disbursed.isArchived, true);
  assert.equal(afterFirst.disbursed.archiveReason, "AUTO_DISBURSED_180_DAYS");
});
check("First run archives exactly the two eligible leads", () => {
  assert.equal(firstRun.archived, 2);
  assert.deepEqual(new Set(firstRun.archivedIds), new Set([rejected.id, disbursed.id]));
});
check("Active lead business data is unchanged", () => {
  assert.deepEqual(selectedBusinessData(afterFirst.active), selectedBusinessData(original.active));
});
check("Rejected lead business data is preserved", () => {
  assert.deepEqual(selectedBusinessData(afterFirst.rejected), selectedBusinessData(original.rejected));
});
check("Disbursed lead business data is preserved", () => {
  assert.deepEqual(selectedBusinessData(afterFirst.disbursed), selectedBusinessData(original.disbursed));
});

const recoveredRejectedById = await getRecord("leads", rejected.id);
const recoveredRejectedByCaseId = await getRecord("leads", rejected.caseId);
const recoveredDisbursedById = await getRecord("leads", disbursed.id);
const archivedPage = await queryArchivedLeads({ dealershipId, query: { limit: 20 } });
const activeDealerPage = await queryDealershipLeads({ dealershipId, query: { limit: 20 } });
const activeAdminPage = await queryAllLeads({ query: { limit: 100 } });
const fixtureIds = new Set([active.id, rejected.id, disbursed.id]);

check("Archived rejected lead recovers by record ID", () => {
  assert.deepEqual(selectedBusinessData(recoveredRejectedById), selectedBusinessData(original.rejected));
});
check("Archived rejected lead recovers by case ID", () => {
  assert.equal(recoveredRejectedByCaseId.id, rejected.id);
  assert.deepEqual(selectedBusinessData(recoveredRejectedByCaseId), selectedBusinessData(original.rejected));
});
check("Archived disbursed lead recovers without data loss", () => {
  assert.deepEqual(selectedBusinessData(recoveredDisbursedById), selectedBusinessData(original.disbursed));
});
check("Archive listing contains only the two eligible fixtures", () => {
  const listedIds = archivedPage.data.filter((lead) => fixtureIds.has(lead.id)).map((lead) => lead.id);
  assert.deepEqual(new Set(listedIds), new Set([rejected.id, disbursed.id]));
});
check("Active dealership listing excludes archived fixtures", () => {
  const listedIds = activeDealerPage.data.filter((lead) => fixtureIds.has(lead.id)).map((lead) => lead.id);
  assert.deepEqual(listedIds, [active.id]);
});
check("Active admin listing excludes archived fixtures", () => {
  const listedIds = activeAdminPage.data.filter((lead) => fixtureIds.has(lead.id)).map((lead) => lead.id);
  assert.deepEqual(listedIds, [active.id]);
});

let immutableError = null;
try {
  await updateRecord("leads", rejected.id, { status: LEAD_STATUSES.CONTACTED });
} catch (error) {
  immutableError = { code: error.code, status: error.status, message: error.message };
}
check("Archived records reject mutation", () => {
  assert.equal(immutableError?.code, "ARCHIVED_LEAD_IMMUTABLE");
  assert.equal(immutableError?.status, 409);
});

const secondRun = await archiveClosedLeads({ limit: 50 });
const afterSecond = {
  active: await getRecord("leads", active.id),
  rejected: await getRecord("leads", rejected.id),
  disbursed: await getRecord("leads", disbursed.id),
};
log("Second archival execution completed", secondRun);

check("Second run performs no duplicate archival", () => {
  assert.equal(secondRun.archived, 0);
  assert.deepEqual(secondRun.archivedIds, []);
});
check("Second run does not alter archived rejected lead", () => {
  assert.deepEqual(afterSecond.rejected, afterFirst.rejected);
});
check("Second run does not alter archived disbursed lead", () => {
  assert.deepEqual(afterSecond.disbursed, afterFirst.disbursed);
});
check("No fixture lead is deleted", () => {
  assert.ok(afterSecond.active);
  assert.ok(afterSecond.rejected);
  assert.ok(afterSecond.disbursed);
});

const rejectedAudits = await queryRecords("auditLogs", {
  where: [{ field: "leadId", value: rejected.id }],
  limit: 20,
  maxLimit: 20,
  allowGlobal: true,
});
const disbursedAudits = await queryRecords("auditLogs", {
  where: [{ field: "leadId", value: disbursed.id }],
  limit: 20,
  maxLimit: 20,
  allowGlobal: true,
});
const archivalLogs = await queryRecords("archivalLogs", {
  where: [{ field: "type", value: "lead-archival" }],
  orderBy: "createdAt",
  direction: "desc",
  limit: 10,
  maxLimit: 10,
  allowGlobal: true,
});

check("Rejected lead has one archival audit event", () => {
  assert.equal(rejectedAudits.data.filter((item) => item.actionType === "LEAD_ARCHIVED").length, 1);
});
check("Disbursed lead has one archival audit event", () => {
  assert.equal(disbursedAudits.data.filter((item) => item.actionType === "LEAD_ARCHIVED").length, 1);
});
check("Archival run log records execution and idempotent rerun", () => {
  assert.ok(archivalLogs.data.some((item) => item.archived === 2));
  assert.ok(archivalLogs.data.some((item) => item.archived === 0));
});

const failedChecks = checks.filter((item) => item.status === "FAIL");
const result = {
  audit: "CarLoanSaathi archive verification",
  runId,
  startedAt: startedAt.toISOString(),
  completedAt: new Date().toISOString(),
  executionMode: "isolated-memory",
  productionDataTouched: false,
  policy: { rejectedDays: 90, disbursedDays: 180 },
  fixtures: {
    active: { id: active.id, status: active.status, archived: afterSecond.active.isArchived === true },
    rejected: { id: rejected.id, status: rejected.status, archived: afterSecond.rejected.isArchived === true },
    disbursed: { id: disbursed.id, status: disbursed.status, archived: afterSecond.disbursed.isArchived === true },
  },
  firstRun,
  secondRun,
  immutableError,
  recovery: {
    rejectedById: recoveredRejectedById.id,
    rejectedByCaseId: recoveredRejectedByCaseId.id,
    disbursedById: recoveredDisbursedById.id,
  },
  counts: {
    checks: checks.length,
    passed: checks.length - failedChecks.length,
    failed: failedChecks.length,
    fixtureRecordsRemaining: Object.values(afterSecond).filter(Boolean).length,
  },
  checks,
  verdict: failedChecks.length ? "FAIL" : "PASS",
  limitation: "Archive recovery verifies retained-record retrieval. The product intentionally has no unarchive workflow.",
};

log("Archive verification audit completed", {
  verdict: result.verdict,
  passed: result.counts.passed,
  failed: result.counts.failed,
});

await fs.mkdir(artifactDir, { recursive: true });
await fs.writeFile(path.join(artifactDir, "archive-audit.json"), `${JSON.stringify(result, null, 2)}\n`);
await fs.writeFile(path.join(artifactDir, "archive-audit.log"), `${logLines.join("\n")}\n`);

const overviewBody = `
  <h1>Archive Verification Audit</h1>
  <p class="subtitle">${htmlEscape(result.runId)} | Isolated memory simulation | ${htmlEscape(result.completedAt)}</p>
  <div class="cards">
    <div class="card"><div>Verdict</div><div class="metric ${result.verdict === "PASS" ? "pass" : "fail"}">${result.verdict}</div></div>
    <div class="card"><div>Checks Passed</div><div class="metric">${result.counts.passed}/${result.counts.checks}</div></div>
    <div class="card"><div>First Run Archived</div><div class="metric">${result.firstRun.archived}</div></div>
    <div class="card"><div>Duplicate Archives</div><div class="metric">${result.secondRun.archived}</div></div>
  </div>
  <h2>Fixture Outcome</h2>
  <table>
    <thead><tr><th>Lead</th><th>Status</th><th>Archived</th><th>Expected</th></tr></thead>
    <tbody>
      <tr><td>Active</td><td>${htmlEscape(result.fixtures.active.status)}</td><td>${result.fixtures.active.archived}</td><td>false</td></tr>
      <tr><td>Rejected, 91 days</td><td>${htmlEscape(result.fixtures.rejected.status)}</td><td>${result.fixtures.rejected.archived}</td><td>true</td></tr>
      <tr><td>Disbursed, 181 days</td><td>${htmlEscape(result.fixtures.disbursed.status)}</td><td>${result.fixtures.disbursed.archived}</td><td>true</td></tr>
    </tbody>
  </table>
  <h2>Safety Summary</h2>
  <div class="note">All three fixture records remain present. Archival is an in-place immutable marker operation; no lead deletion occurred.</div>`;

const integrityBody = `
  <h1>Archive Integrity Evidence</h1>
  <p class="subtitle">${htmlEscape(result.runId)} | Detailed assertions</p>
  <table>
    <thead><tr><th>Assertion</th><th>Result</th><th>Error</th></tr></thead>
    <tbody>${renderChecks(checks)}</tbody>
  </table>
  <h2>Execution Evidence</h2>
  <pre>${htmlEscape(JSON.stringify({
    firstRun: result.firstRun,
    secondRun: result.secondRun,
    recovery: result.recovery,
    immutableError: result.immutableError,
    fixtureRecordsRemaining: result.counts.fixtureRecordsRemaining,
  }, null, 2))}</pre>
  <div class="note">${htmlEscape(result.limitation)}</div>`;

await fs.writeFile(
  path.join(artifactDir, "archive-audit-overview.html"),
  reportShell("Archive Audit Overview", overviewBody),
);
await fs.writeFile(
  path.join(artifactDir, "archive-audit-integrity.html"),
  reportShell("Archive Audit Integrity", integrityBody),
);

console.log(JSON.stringify(result, null, 2));
process.exit(failedChecks.length ? 1 : 0);
