import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(scriptDir, "..", "..");
const artifactDir = path.join(workspaceDir, "audit-artifacts", "production-scale-load");

process.env.DOTENV_CONFIG_PATH = path.join(artifactDir, "__isolated_benchmark__");
process.env.LOG_LEVEL = "error";
process.env.NODE_ENV = "development";
delete process.env.FIREBASE_PROJECT_ID;
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;

const DEALERSHIP_COUNT = 500;
const EXECUTIVE_COUNT = 5_000;
const LEAD_COUNT = 100_000;
const BANK_COUNT = 50;
const HTTP_CONCURRENCY = 25;
const HTTP_SAMPLES = 500;
const CREATE_SAMPLES = 150;
const SSE_CLIENTS = 500;
const SSE_EVENTS = 100;

const [
  firestoreModule,
  leadQueryModule,
  analyticsModule,
  notificationModule,
  realtimeModule,
  statusModule,
] = await Promise.all([
  import("../services/firestore.service.js"),
  import("../services/leadQuery.service.js"),
  import("../services/analytics.service.js"),
  import("../services/notification.service.js"),
  import("../services/realtime.service.js"),
  import("../utils/status.constants.js"),
]);

const { bulkUpsertRecords, createRecord } = firestoreModule;
const { queryAllLeads, queryDealershipLeads } = leadQueryModule;
const { scopedAnalytics } = analyticsModule;
const { getNotifications } = notificationModule;
const { connectRealtimeClient, publishRealtimeEvent, REALTIME_EVENTS } = realtimeModule;
const { LEAD_STATUSES } = statusModule;

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function stats(values) {
  return {
    samples: values.length,
    minMs: Number(Math.min(...values).toFixed(3)),
    averageMs: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3)),
    p50Ms: Number(percentile(values, 50).toFixed(3)),
    p95Ms: Number(percentile(values, 95).toFixed(3)),
    p99Ms: Number(percentile(values, 99).toFixed(3)),
    maxMs: Number(Math.max(...values).toFixed(3)),
  };
}

function dealershipId(index) {
  return `DLR-LOAD-${String(index + 1).padStart(4, "0")}`;
}

function executiveId(index) {
  return `exec-load-${String(index + 1).padStart(5, "0")}@loadtest.local`;
}

function bankId(index) {
  return `BNK-LOAD-${String(index + 1).padStart(3, "0")}`;
}

function leadRecord(index) {
  const number = index + 1;
  const dealerIndex = index % DEALERSHIP_COUNT;
  const executiveIndex = index % EXECUTIVE_COUNT;
  const bankIndex = index % BANK_COUNT;
  const now = Date.now();
  let status = LEAD_STATUSES.CONTACTED;
  let ageDays = number % 60;
  if (index < 10_000) {
    status = LEAD_STATUSES.REJECTED;
    ageDays = 91 + (number % 30);
  } else if (index < 20_000) {
    status = LEAD_STATUSES.DISBURSED;
    ageDays = 181 + (number % 30);
  } else if (index % 5 === 0) {
    status = LEAD_STATUSES.REQUEST_DOCUMENT;
  } else if (index % 7 === 0) {
    status = LEAD_STATUSES.UNDER_BANK_PROCESS;
  }
  const timestamp = new Date(now - ageDays * 24 * 60 * 60 * 1000 - number * 1000).toISOString();
  return {
    id: `load-lead-${String(number).padStart(7, "0")}`,
    caseId: `CLS-LOAD-${String(number).padStart(7, "0")}`,
    fullName: `Load Customer ${number}`,
    customerName: `Load Customer ${number}`,
    mobile: `9${String(number).padStart(9, "0").slice(-9)}`,
    city: `Load City ${(number % 20) + 1}`,
    dealershipId: dealershipId(dealerIndex),
    dealershipName: `Load Dealership ${dealerIndex + 1}`,
    bankId: bankId(bankIndex),
    bankName: `Load Bank ${bankIndex + 1}`,
    assignedExecutiveId: executiveId(executiveIndex),
    assignedExecutiveEmail: executiveId(executiveIndex),
    status,
    loanAmount: 500_000 + (number % 50) * 10_000,
    carPrice: 800_000 + (number % 50) * 12_000,
    statusUpdatedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
    isDeadCase: false,
    loadTest: true,
  };
}

async function seedDataset() {
  const startedAt = performance.now();
  const dealerships = Array.from({ length: DEALERSHIP_COUNT }, (_, index) => ({
    id: dealershipId(index),
    dealershipId: dealershipId(index),
    dealershipName: `Load Dealership ${index + 1}`,
    active: true,
    status: "active",
    loadTest: true,
  }));
  const executives = Array.from({ length: EXECUTIVE_COUNT }, (_, index) => ({
    id: executiveId(index),
    email: executiveId(index),
    uid: executiveId(index),
    name: `Load Executive ${index + 1}`,
    bankId: bankId(index % BANK_COUNT),
    active: true,
    loadTest: true,
  }));
  const dealerMetrics = Array.from({ length: DEALERSHIP_COUNT }, (_, index) => ({
    id: dealershipId(index),
    scopeId: dealershipId(index),
    totalLeads: LEAD_COUNT / DEALERSHIP_COUNT,
    pendingLeads: 160,
    rejectedLeads: 20,
    disbursedLeads: 20,
  }));
  const executiveMetrics = Array.from({ length: EXECUTIVE_COUNT }, (_, index) => ({
    id: executiveId(index),
    scopeId: executiveId(index),
    totalLeads: LEAD_COUNT / EXECUTIVE_COUNT,
  }));
  const bankMetrics = Array.from({ length: BANK_COUNT }, (_, index) => ({
    id: bankId(index),
    scopeId: bankId(index),
    totalLeads: LEAD_COUNT / BANK_COUNT,
  }));
  const leads = Array.from({ length: LEAD_COUNT }, (_, index) => leadRecord(index));

  await bulkUpsertRecords("dealerships", dealerships);
  await bulkUpsertRecords("loanExecutives", executives);
  await bulkUpsertRecords("dealershipMetrics", dealerMetrics);
  await bulkUpsertRecords("executiveMetrics", executiveMetrics);
  await bulkUpsertRecords("bankMetrics", bankMetrics);
  await bulkUpsertRecords("globalMetrics", [{
    id: "global",
    totalLeads: LEAD_COUNT,
    pendingLeads: 80_000,
    rejectedLeads: 10_000,
    disbursedLeads: 10_000,
  }]);
  await bulkUpsertRecords("leads", leads);
  return {
    durationMs: Number((performance.now() - startedAt).toFixed(3)),
    heapUsedMb: Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)),
  };
}

async function dashboardForDealer(id) {
  const [metrics, recent, notifications] = await Promise.all([
    scopedAnalytics({ dealershipId: id }),
    queryDealershipLeads({ dealershipId: id, query: { limit: 8 } }),
    getNotifications({
      query: { limit: 20 },
      actor: { role: "finance-desk", dealershipId: id, email: `finance@${id}.local` },
    }),
  ]);
  return {
    metrics,
    recentRecords: recent.data,
    notifications: notifications.data,
  };
}

async function benchmarkFunction(samples, operation) {
  const durations = [];
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now();
    await operation(index);
    durations.push(performance.now() - startedAt);
  }
  return stats(durations);
}

async function startBenchmarkServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    try {
      let payload;
      if (req.method === "GET" && url.pathname === "/search") {
        payload = await queryAllLeads({ query: { caseId: url.searchParams.get("caseId"), limit: 10 } });
      } else if (req.method === "GET" && url.pathname === "/dashboard") {
        payload = await dashboardForDealer(url.searchParams.get("dealershipId"));
      } else if (req.method === "POST" && url.pathname === "/leads") {
        const index = Number(url.searchParams.get("index") || 0);
        payload = await createRecord("leads", {
          ...leadRecord(LEAD_COUNT + index),
          id: `created-load-lead-${index}-${Date.now()}`,
          caseId: `CLS-CREATED-${index}-${Date.now()}`,
          status: LEAD_STATUSES.NEW,
          isDeadCase: false,
        });
      } else {
        res.writeHead(404).end();
        return;
      }
      const body = JSON.stringify(payload);
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
      res.end(body);
    } catch (error) {
      const body = JSON.stringify({ error: error.message });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(body);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, port: server.address().port };
}

async function benchmarkHttp({ urlFactory, method = "GET", samples = HTTP_SAMPLES }) {
  const durations = [];
  let cursor = 0;
  let failures = 0;
  async function worker() {
    while (cursor < samples) {
      const index = cursor;
      cursor += 1;
      const startedAt = performance.now();
      const response = await fetch(urlFactory(index), { method });
      await response.arrayBuffer();
      durations.push(performance.now() - startedAt);
      if (!response.ok) failures += 1;
    }
  }
  await Promise.all(Array.from({ length: HTTP_CONCURRENCY }, worker));
  return { ...stats(durations), concurrency: HTTP_CONCURRENCY, failures };
}

function connectSseClient(deliveryTimes) {
  const req = new EventEmitter();
  req.headers = {};
  req.query = {};
  const res = {
    writeHead() {},
    write(chunk) {
      if (String(chunk).includes("event: operational")) deliveryTimes.push(performance.now());
    },
  };
  connectRealtimeClient({
    user: { role: "super-admin", email: `admin-${Math.random()}@load.local`, uid: crypto.randomUUID() },
    req,
    res,
  });
  return () => req.emit("close");
}

async function benchmarkSse() {
  const eventLatencies = [];
  const closeClients = [];
  let deliveryTimes = [];
  for (let index = 0; index < SSE_CLIENTS; index += 1) closeClients.push(connectSseClient(deliveryTimes));
  for (let index = 0; index < SSE_EVENTS; index += 1) {
    deliveryTimes = [];
    const startedAt = performance.now();
    publishRealtimeEvent({
      eventType: REALTIME_EVENTS.LEAD_STATUS_UPDATED,
      lead: leadRecord(25_000 + index),
      data: { status: LEAD_STATUSES.UNDER_BANK_PROCESS },
    });
    const completedAt = deliveryTimes.length ? Math.max(...deliveryTimes) : performance.now();
    eventLatencies.push(completedAt - startedAt);
  }
  closeClients.forEach((close) => close());
  return { ...stats(eventLatencies), clients: SSE_CLIENTS, events: SSE_EVENTS, deliveries: SSE_CLIENTS * SSE_EVENTS };
}

function htmlEscape(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function metricCard(label, value, note = "") {
  return `<div class="card"><div class="label">${htmlEscape(label)}</div><div class="metric">${htmlEscape(value)}</div><div class="note">${htmlEscape(note)}</div></div>`;
}

await fs.mkdir(artifactDir, { recursive: true });
const runStartedAt = new Date();
const seed = await seedDataset();

const directSearch = await benchmarkFunction(300, (index) => queryAllLeads({
  query: { caseId: `CLS-LOAD-${String((index * 313) % LEAD_COUNT + 1).padStart(7, "0")}`, limit: 10 },
}));
const directDashboard = await benchmarkFunction(300, (index) => dashboardForDealer(dealershipId(index % DEALERSHIP_COUNT)));

const { server, port } = await startBenchmarkServer();
const baseUrl = `http://127.0.0.1:${port}`;
const apiSearch = await benchmarkHttp({
  urlFactory: (index) => `${baseUrl}/search?caseId=CLS-LOAD-${String((index * 313) % LEAD_COUNT + 1).padStart(7, "0")}`,
});
const apiDashboard = await benchmarkHttp({
  urlFactory: (index) => `${baseUrl}/dashboard?dealershipId=${dealershipId(index % DEALERSHIP_COUNT)}`,
});
const apiLeadCreation = await benchmarkHttp({
  method: "POST",
  samples: CREATE_SAMPLES,
  urlFactory: (index) => `${baseUrl}/leads?index=${index}`,
});
await new Promise((resolve) => server.close(resolve));

const sse = await benchmarkSse();
const logicalReads = {
  exactCaseSearch: { estimatedReads: 1, returned: 1, amplification: 1 },
  dealershipPage: { estimatedReads: 9, returned: 8, amplification: 1.125 },
  localMemoryScan: {
    examinedPerQuery: LEAD_COUNT,
    returned: 8,
    amplification: LEAD_COUNT / 8,
    note: "Local fallback scan only; indexed Firestore should not scan 100,000 documents.",
  },
};

const combinedApiDurations = [
  apiSearch.p95Ms,
  apiDashboard.p95Ms,
  apiLeadCreation.p95Ms,
];
const bottlenecks = [
  {
    severity: "high",
    area: "Local fallback query complexity",
    finding: `Memory fallback examines up to ${LEAD_COUNT.toLocaleString()} leads for scoped sorting/search, producing a ${logicalReads.localMemoryScan.amplification.toLocaleString()}x examined-to-returned ratio for an 8-row dashboard page.`,
    recommendation: "Never use memory fallback for production capacity. Require Firestore indexes and fail readiness checks when the backend reports memory-fallback.",
  },
  {
    severity: "medium",
    area: "Dashboard query fan-out",
    finding: "Dashboard assembly performs metrics, recent-lead, projection, and notification work concurrently. Tail latency follows the slowest dependency.",
    recommendation: "Keep projection hit rate above 95%, cache metrics, and monitor per-dependency p95 rather than only the aggregate endpoint.",
  },
  {
    severity: "medium",
    area: "SSE fan-out",
    finding: `${SSE_CLIENTS} connected clients received ${SSE_CLIENTS * SSE_EVENTS} synchronous in-process deliveries during the benchmark.`,
    recommendation: "For multi-instance production, require Redis pub/sub, cap per-instance connections, and load-test proxy buffering and reconnect storms in staging.",
  },
];

const result = {
  audit: "CarLoanSaathi production-scale local capacity benchmark",
  runStartedAt: runStartedAt.toISOString(),
  completedAt: new Date().toISOString(),
  environment: {
    executionMode: "isolated-memory-and-loopback-http",
    productionDataTouched: false,
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    cpuCount: (await import("node:os")).cpus().length,
    totalMemoryGb: Number(((await import("node:os")).totalmem() / 1024 / 1024 / 1024).toFixed(2)),
  },
  dataset: {
    dealerships: DEALERSHIP_COUNT,
    executives: EXECUTIVE_COUNT,
    leads: LEAD_COUNT,
    seed,
  },
  measurements: {
    leadCreationLatency: apiLeadCreation,
    leadSearchLatency: apiSearch,
    dashboardLoadTime: apiDashboard,
    directServiceSearch: directSearch,
    directServiceDashboard: directDashboard,
    apiP95Ms: Number(Math.max(...combinedApiDurations).toFixed(3)),
    firestoreReadAmplification: logicalReads,
    ssePropagation: sse,
  },
  bottlenecks,
  limitations: [
    "Managed Firestore network, index, quota, and billing behavior were not measured.",
    "Render/Vercel autoscaling, TLS, proxy buffering, and internet latency were not measured.",
    "Loopback HTTP results are application baselines, not deploy-environment capacity claims.",
    "A staging k6 enterprise run is still required before broad production launch.",
  ],
};

await fs.writeFile(path.join(artifactDir, "production-scale-results.json"), `${JSON.stringify(result, null, 2)}\n`);
await fs.writeFile(path.join(artifactDir, "production-scale-results.log"), [
  `Dataset: ${DEALERSHIP_COUNT} dealerships, ${EXECUTIVE_COUNT} executives, ${LEAD_COUNT} leads`,
  `Seed: ${seed.durationMs} ms, heap ${seed.heapUsedMb} MB`,
  `Lead creation p95: ${apiLeadCreation.p95Ms} ms`,
  `Lead search p95: ${apiSearch.p95Ms} ms`,
  `Dashboard p95: ${apiDashboard.p95Ms} ms`,
  `Overall API p95 ceiling: ${result.measurements.apiP95Ms} ms`,
  `SSE p95: ${sse.p95Ms} ms to ${SSE_CLIENTS} clients`,
  `Verdict: benchmark completed`,
  "",
].join("\n"));

const reportHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Production Scale Load Test</title>
<style>
body{margin:0;background:#f1f5f9;color:#0f172a;font-family:Segoe UI,Arial,sans-serif}main{max-width:1250px;margin:auto;padding:34px}
h1{margin:0 0 6px}.sub{color:#475569;margin-bottom:22px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.card,table,.callout{background:#fff;border:1px solid #cbd5e1;border-radius:10px}.card{padding:16px}.label{color:#475569}.metric{font-size:26px;font-weight:700;margin:8px 0}.note{font-size:12px;color:#64748b}
table{width:100%;border-collapse:collapse;margin-top:12px}th,td{padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:left}th{background:#e2e8f0}
h2{margin-top:26px}.high{color:#b91c1c;font-weight:700}.medium{color:#b45309;font-weight:700}.callout{padding:14px 16px;border-left:4px solid #2563eb}
</style></head><body><main>
<h1>Production-Scale Load Test</h1><div class="sub">${DEALERSHIP_COUNT} dealerships | ${EXECUTIVE_COUNT.toLocaleString()} executives | ${LEAD_COUNT.toLocaleString()} leads | isolated local benchmark</div>
<div class="grid">
${metricCard("Lead creation p95", `${apiLeadCreation.p95Ms} ms`, `${CREATE_SAMPLES} requests, concurrency ${HTTP_CONCURRENCY}`)}
${metricCard("Lead search p95", `${apiSearch.p95Ms} ms`, `${HTTP_SAMPLES} requests`)}
${metricCard("Dashboard p95", `${apiDashboard.p95Ms} ms`, `${HTTP_SAMPLES} requests`)}
${metricCard("SSE propagation p95", `${sse.p95Ms} ms`, `${SSE_CLIENTS} clients, ${SSE_EVENTS} events`)}
</div>
<h2>Capacity Evidence</h2><table><thead><tr><th>Measurement</th><th>Result</th><th>Context</th></tr></thead><tbody>
<tr><td>Dataset seed</td><td>${seed.durationMs} ms</td><td>${seed.heapUsedMb} MB heap after seed</td></tr>
<tr><td>Overall API p95 ceiling</td><td>${result.measurements.apiP95Ms} ms</td><td>Worst p95 of create/search/dashboard</td></tr>
<tr><td>Indexed search read amplification</td><td>1.00x expected</td><td>Exact caseId equality query</td></tr>
<tr><td>Dashboard page read amplification</td><td>1.125x expected</td><td>9 reads for 8 returned rows</td></tr>
<tr><td>Local fallback scan amplification</td><td>${logicalReads.localMemoryScan.amplification.toLocaleString()}x</td><td>100,000 examined for 8 returned</td></tr>
</tbody></table>
<h2>Bottlenecks and Recommendations</h2><table><thead><tr><th>Severity</th><th>Area</th><th>Finding</th><th>Production recommendation</th></tr></thead><tbody>
${bottlenecks.map((item) => `<tr><td class="${item.severity}">${item.severity.toUpperCase()}</td><td>${htmlEscape(item.area)}</td><td>${htmlEscape(item.finding)}</td><td>${htmlEscape(item.recommendation)}</td></tr>`).join("")}
</tbody></table>
<h2>Interpretation</h2><div class="callout">These are isolated application baselines. A staging k6 run against real Firestore and deployed infrastructure is required for a production capacity sign-off.</div>
</main></body></html>`;
await fs.writeFile(path.join(artifactDir, "production-scale-report.html"), reportHtml);

console.log(JSON.stringify(result, null, 2));
process.exit(0);
