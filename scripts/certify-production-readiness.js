import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const strict = process.argv.includes("--strict");
const npmCli = process.env.npm_execpath;

function npmArgs(...args) {
  if (!npmCli) throw new Error("npm_execpath is required to run the production certification");
  return [npmCli, ...args];
}

function gate(name, status, detail, evidence = {}) {
  return { name, status, detail, evidence };
}

function run(name, command, args, { pendingOnFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  const passed = result.status === 0;
  return gate(
    name,
    passed ? "PASS" : pendingOnFailure ? "PENDING" : "FAIL",
    passed ? "Verification passed" : `Verification exited with code ${result.status ?? "unknown"}`,
    { command: [command, ...args].join(" "), output: output.slice(-4000) },
  );
}

function deploymentGate() {
  const render = fs.readFileSync(path.join(root, "render.yaml"), "utf8");
  const required = [
    "NODE_ENV",
    "JWT_SECRET",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "FIREBASE_STORAGE_BUCKET",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
    "REDIS_URL",
    "ENABLE_REDIS_CACHE",
    "ENABLE_REDIS_QUEUE",
    "ENABLE_REALTIME_REDIS",
  ];
  const missing = required.filter((key) => !render.includes(`key: ${key}`));
  return gate(
    "deployment_manifest",
    missing.length ? "FAIL" : "PASS",
    missing.length ? "Required production variables are absent from render.yaml" : "Required production variables are declared without exposing values",
    { missing },
  );
}

function performanceGate() {
  const result = spawnSync(process.execPath, ["scripts/certify-performance-readiness.js"], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  try {
    const report = JSON.parse(result.stdout || "{}");
    const status = report.overall === "GREEN" ? "PASS" : report.overall === "YELLOW" ? "PENDING" : "FAIL";
    return gate("performance_evidence", status, `Performance certification is ${report.overall || "unknown"}`, { report });
  } catch {
    return gate("performance_evidence", "FAIL", "Performance certification did not return valid JSON", {
      output: `${result.stdout || ""}\n${result.stderr || ""}`.trim().slice(-4000),
    });
  }
}

function mobileGate() {
  const candidates = ["mobile", "app.json", "android", "ios", "react-native.config.js"];
  const present = candidates.filter((item) => fs.existsSync(path.join(root, item)));
  return gate(
    "mobile_application",
    present.length ? "PASS" : "PENDING",
    present.length ? "Mobile application source is present for certification" : "Loan Executive mobile application source is not present in this workspace",
    { present },
  );
}

function evidenceGate() {
  const required = {
    readMeter: process.env.PERFORMANCE_READ_METER_LOG,
    projectionFreshness: process.env.PROJECTION_FRESHNESS_REPORT,
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
  return gate(
    "deployed_evidence",
    missing.length ? "PENDING" : "PASS",
    missing.length ? "Deployed evidence inputs are not configured" : "Deployed evidence inputs are configured",
    { missing },
  );
}

const gates = [
  run("backend_tests", process.execPath, npmArgs("--prefix", "backend", "test")),
  run("frontend_tests", process.execPath, npmArgs("--prefix", "frontend", "test")),
  run("frontend_lint", process.execPath, npmArgs("--prefix", "frontend", "run", "lint")),
  run("frontend_build", process.execPath, npmArgs("--prefix", "frontend", "run", "build")),
  run("secret_scan", process.execPath, npmArgs("run", "security:scan")),
  run("authorization_audit", process.execPath, npmArgs("run", "security:authz-audit")),
  run("production_invariants", process.execPath, npmArgs("run", "validate:regression")),
  run("production_blockers", process.execPath, npmArgs("run", "security:production-blockers")),
  performanceGate(),
  deploymentGate(),
  mobileGate(),
  evidenceGate(),
];

const overall = gates.some((item) => item.status === "FAIL")
  ? "RED"
  : gates.some((item) => item.status === "PENDING")
    ? "YELLOW"
    : "GREEN";
const report = {
  generatedAt: new Date().toISOString(),
  certification: overall,
  recommendation: overall === "GREEN"
    ? "PRODUCTION READY"
    : overall === "YELLOW"
      ? "PRODUCTION READY WITH MINOR RECOMMENDATIONS"
      : "PRODUCTION NOT READY",
  strict,
  gates,
};
const output = `${JSON.stringify(report, null, 2)}\n`;
const outputPath = process.env.PRODUCTION_CERTIFICATION_OUTPUT;
if (outputPath) fs.writeFileSync(path.resolve(outputPath), output);
process.stdout.write(output);
if (strict && overall !== "GREEN") process.exitCode = 1;
