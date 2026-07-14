import fs from "node:fs";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const strict = args.has("--strict");
const now = Date.now();
const maxEvidenceAgeDays = positiveNumber(process.env.PERFORMANCE_EVIDENCE_MAX_AGE_DAYS, 14);
const minReadMeterDays = positiveNumber(process.env.PERFORMANCE_READ_METER_MIN_DAYS, 7);
const resultsDir = path.resolve(process.env.PERFORMANCE_K6_RESULTS_DIR || "load-tests/results");
const readMeterLog = process.env.PERFORMANCE_READ_METER_LOG;
const projectionReport = process.env.PROJECTION_FRESHNESS_REPORT;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function evidenceDate(data, file) {
  const candidates = [data.generatedAt, data.timestamp, data.runAt, data.state?.testRunDurationMs ? fs.statSync(file).mtime : null];
  for (const candidate of candidates) {
    const value = candidate instanceof Date ? candidate.getTime() : Date.parse(candidate);
    if (Number.isFinite(value)) return value;
  }
  return fs.statSync(file).mtimeMs;
}

function ageDays(timestamp) {
  return (now - timestamp) / 86_400_000;
}

function result(gate, status, detail, evidence = {}) {
  return { gate, status, detail, evidence };
}

function metric(data, name, key) {
  const value = Number(data.metrics?.[name]?.values?.[key]);
  return Number.isFinite(value) ? value : null;
}

function certifyK6() {
  if (!fs.existsSync(resultsDir)) {
    return result("staging_load", "PENDING", `No k6 result directory: ${resultsDir}`);
  }
  const files = fs.readdirSync(resultsDir)
    .filter((name) => name.endsWith("-summary.json"))
    .map((name) => path.join(resultsDir, name));
  if (!files.length) return result("staging_load", "PENDING", "No k6 summary evidence found");

  const runs = files.map((file) => {
    const data = readJson(file);
    const failedRate = metric(data, "http_req_failed", "rate");
    const p95 = metric(data, "http_req_duration", "p(95)");
    const p99 = metric(data, "http_req_duration", "p(99)");
    const requests = metric(data, "http_reqs", "count");
    const thresholdFailures = Object.entries(data.metrics || {})
      .flatMap(([name, item]) => Object.entries(item.thresholds || {}).filter(([, itemResult]) => itemResult?.ok === false).map(([threshold]) => `${name}:${threshold}`));
    return { file: path.relative(process.cwd(), file), generatedAt: new Date(evidenceDate(data, file)).toISOString(), failedRate, p95, p99, requests, thresholdFailures };
  }).sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
  const recent = runs.filter((run) => ageDays(Date.parse(run.generatedAt)) <= maxEvidenceAgeDays);
  if (!recent.length) return result("staging_load", "PENDING", `k6 evidence is older than ${maxEvidenceAgeDays} days`, { runs });
  const invalid = recent.filter((run) => !run.requests || run.failedRate === null || run.p95 === null || run.p99 === null);
  if (invalid.length) return result("staging_load", "FAIL", "k6 summaries are missing required request or latency metrics", { invalid });
  const failed = recent.filter((run) => run.thresholdFailures.length || run.failedRate >= 0.02 || run.p95 >= 2500 || run.p99 >= 5000);
  if (failed.length) return result("staging_load", "FAIL", "One or more recent k6 runs breach certification thresholds", { failed });
  return result("staging_load", "PASS", `${recent.length} recent k6 run(s) passed`, { runs: recent });
}

function parseLogLine(line) {
  try { return JSON.parse(line); } catch {
    const start = line.indexOf("{");
    if (start < 0) return null;
    try { return JSON.parse(line.slice(start)); } catch { return null; }
  }
}

function timestampOf(item) {
  for (const value of [item.timestamp, item.time, item.generatedAt, item.createdAt, item.loggedAt]) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function certifyReadMeter() {
  if (!readMeterLog) return result("read_meter", "PENDING", "Set PERFORMANCE_READ_METER_LOG to a representative production log export");
  if (!fs.existsSync(readMeterLog)) return result("read_meter", "FAIL", `Read-meter log not found: ${readMeterLog}`);
  let calls = 0;
  let reads = 0;
  let first = Infinity;
  let last = -Infinity;
  for (const line of fs.readFileSync(readMeterLog, "utf8").split(/\r?\n/)) {
    const item = parseLogLine(line);
    if (item?.tag !== "READ-METER") continue;
    calls += 1;
    reads += Number(item.totalEstimatedReads || 0);
    const timestamp = timestampOf(item);
    if (timestamp !== null) { first = Math.min(first, timestamp); last = Math.max(last, timestamp); }
  }
  if (!calls) return result("read_meter", "FAIL", "The supplied export contains no READ-METER events");
  if (!Number.isFinite(first) || !Number.isFinite(last)) return result("read_meter", "FAIL", "READ-METER events need parseable timestamps");
  const observedDays = (last - first) / 86_400_000;
  const evidence = { calls, estimatedReads: reads, firstAt: new Date(first).toISOString(), lastAt: new Date(last).toISOString(), observedDays: Number(observedDays.toFixed(2)) };
  if (observedDays < minReadMeterDays) return result("read_meter", "FAIL", `Observation window is below ${minReadMeterDays} days`, evidence);
  if (ageDays(last) > maxEvidenceAgeDays) return result("read_meter", "FAIL", `Read-meter evidence is older than ${maxEvidenceAgeDays} days`, evidence);
  return result("read_meter", "PASS", "Representative read-meter window is present", evidence);
}

function certifyProjections() {
  if (!projectionReport) return result("projection_freshness", "PENDING", "Set PROJECTION_FRESHNESS_REPORT to a deployed freshness report");
  if (!fs.existsSync(projectionReport)) return result("projection_freshness", "FAIL", `Projection report not found: ${projectionReport}`);
  const data = readJson(projectionReport);
  const timestamp = evidenceDate(data, projectionReport);
  const checked = Number(data.checked ?? data.summary?.checked ?? 0);
  const stale = Number(data.stale ?? data.summary?.stale ?? 0);
  const rebuildQueued = Number(data.rebuildQueued ?? data.summary?.rebuildQueued ?? 0);
  const backfillComplete = data.backfillComplete ?? data.summary?.backfillComplete;
  const evidence = { checked, stale, rebuildQueued, backfillComplete, generatedAt: new Date(timestamp).toISOString() };
  if (ageDays(timestamp) > maxEvidenceAgeDays) return result("projection_freshness", "FAIL", "Projection evidence is stale", evidence);
  if (!checked || backfillComplete !== true) return result("projection_freshness", "FAIL", "Projection sampling and explicit backfill completion are required", evidence);
  if (stale || rebuildQueued) return result("projection_freshness", "FAIL", "Stale projections remain or rebuilds are queued", evidence);
  return result("projection_freshness", "PASS", "Projection backfill and freshness evidence passed", evidence);
}

function certifyRedis() {
  const enabled = {
    cache: process.env.ENABLE_REDIS_CACHE === "true",
    queue: process.env.ENABLE_REDIS_QUEUE === "true",
    realtime: process.env.ENABLE_REALTIME_REDIS === "true",
  };
  const urlConfigured = Boolean(process.env.REDIS_URL);
  if (!urlConfigured || Object.values(enabled).some((value) => !value)) {
    return result("distributed_runtime", "FAIL", "Multi-instance certification requires Redis cache, queue, and realtime pub/sub", { urlConfigured, enabled });
  }
  return result("distributed_runtime", "PASS", "All distributed Redis capabilities are enabled", { urlConfigured, enabled });
}

function certifySseContract() {
  const source = fs.readFileSync(path.resolve("backend/services/realtime.service.js"), "utf8");
  const required = ['"Content-Type": "text/event-stream"', '"Cache-Control": "no-store, no-transform"', '"X-Accel-Buffering": "no"', "event: heartbeat", "ENABLE_REALTIME_REDIS"];
  const missing = required.filter((token) => !source.includes(token));
  if (missing.length) return result("sse_proxy_contract", "FAIL", "Realtime stream is missing required proxy/distribution controls", { missing });
  return result("sse_proxy_contract", "PASS", "SSE anti-buffering, heartbeat, and distributed pub/sub contracts are present");
}

const gates = [certifyK6(), certifyReadMeter(), certifyProjections(), certifyRedis(), certifySseContract()];
const overall = gates.some((gate) => gate.status === "FAIL") ? "RED" : gates.some((gate) => gate.status === "PENDING") ? "YELLOW" : "GREEN";
const report = { generatedAt: new Date(now).toISOString(), overall, strict, gates };
const output = `${JSON.stringify(report, null, 2)}\n`;
if (process.env.PERFORMANCE_CERTIFICATION_OUTPUT) fs.writeFileSync(path.resolve(process.env.PERFORMANCE_CERTIFICATION_OUTPUT), output);
process.stdout.write(output);
if (strict && overall !== "GREEN") process.exitCode = 1;
