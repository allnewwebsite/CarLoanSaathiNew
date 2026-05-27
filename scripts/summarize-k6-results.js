import fs from "node:fs";
import path from "node:path";

const resultsDir = path.resolve("load-tests/results");
const files = fs.existsSync(resultsDir)
  ? fs.readdirSync(resultsDir).filter((file) => file.endsWith("-summary.json"))
  : [];

function metric(data, name, key) {
  return Number(data.metrics?.[name]?.values?.[key] || 0);
}

const rows = files.map((file) => {
  const data = JSON.parse(fs.readFileSync(path.join(resultsDir, file), "utf8"));
  return {
    file,
    requests: metric(data, "http_reqs", "count"),
    failedRate: metric(data, "http_req_failed", "rate"),
    p50: metric(data, "http_req_duration", "p(50)"),
    p95: metric(data, "http_req_duration", "p(95)"),
    p99: metric(data, "http_req_duration", "p(99)"),
  };
});

if (!rows.length) {
  console.log("No k6 summary files found in load-tests/results.");
  process.exit(0);
}

console.table(rows.map((row) => ({
  file: row.file,
  requests: row.requests,
  failed: `${(row.failedRate * 100).toFixed(2)}%`,
  p50: `${row.p50.toFixed(1)}ms`,
  p95: `${row.p95.toFixed(1)}ms`,
  p99: `${row.p99.toFixed(1)}ms`,
  score: score(row),
})));

function score(row) {
  if (row.failedRate > 0.02 || row.p95 > 2500 || row.p99 > 5000) return "needs-work";
  if (row.failedRate > 0.005 || row.p95 > 1500 || row.p99 > 3500) return "watch";
  return "pass";
}
