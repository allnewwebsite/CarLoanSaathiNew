import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const strict = process.argv.includes("--strict");
const npmCli = process.env.npm_execpath;

function execute(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ...env },
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    passed: result.status === 0,
    exitCode: result.status,
    output: `${result.stdout || ""}\n${result.stderr || ""}`.trim().slice(-4000),
  };
}

function npm(...args) {
  if (!npmCli) return { passed: false, exitCode: null, output: "npm_execpath is unavailable" };
  return execute(process.execPath, [npmCli, ...args]);
}

function node(script, env = {}) {
  return execute(process.execPath, [script], env);
}

const evidence = {
  backend: npm("--prefix", "backend", "test"),
  frontend: npm("--prefix", "frontend", "test"),
  statusSync: node("backend/scripts/verifyStatusSyncWorkflow.js", { VERIFY_USE_MEMORY: "true" }),
  realtime: node("backend/scripts/verifyRealtimeArchitecture.js"),
  subscriptions: node("backend/scripts/verifySubscriptionBilling.js"),
  payments: node("backend/scripts/verifyRazorpayWebhook.js"),
  authorization: npm("run", "security:authz-audit"),
  invariants: npm("run", "validate:regression"),
};

function localEvidencePassed(...keys) {
  return keys.every((key) => evidence[key]?.passed === true);
}

function scenario(number, name, keys, { deployed = true, mobile = false, detail = "" } = {}) {
  const localPassed = localEvidencePassed(...keys);
  const deployedEvidence = process.env.BUSINESS_E2E_DEPLOYED_EVIDENCE === "true";
  const mobilePresent = ["mobile", "app.json", "android", "ios"].some((item) => fs.existsSync(path.join(root, item)));
  let status = localPassed ? "PASS" : "FAIL";
  const gaps = [];
  if (!localPassed) gaps.push(`failed executable evidence: ${keys.filter((key) => !evidence[key]?.passed).join(", ")}`);
  if (deployed && !deployedEvidence) {
    if (status === "PASS") status = "WARNING";
    gaps.push("authenticated deployed multi-portal evidence not supplied");
  }
  if (mobile && !mobilePresent) {
    if (status === "PASS") status = "WARNING";
    gaps.push("mobile source/evidence unavailable");
  }
  return { number, name, status, detail, evidence: keys, gaps };
}

const scenarios = [
  scenario(1, "Lead creation", ["backend", "invariants"]),
  scenario(2, "Lead distribution", ["backend", "statusSync", "realtime"]),
  scenario(3, "Loan Executive acceptance", ["backend", "frontend", "realtime"]),
  scenario(4, "Status progression", ["backend", "statusSync", "frontend", "realtime"]),
  scenario(5, "Document workflow", ["backend", "frontend", "authorization"]),
  scenario(6, "Reassignment", ["backend", "frontend", "realtime", "authorization"]),
  scenario(7, "Dead case", ["backend", "frontend", "realtime"]),
  scenario(8, "Rejected lifecycle", ["backend", "frontend", "statusSync"]),
  scenario(9, "Disbursed lifecycle", ["backend", "frontend", "statusSync"]),
  scenario(10, "Archive and deletion", ["backend", "frontend", "invariants"]),
  scenario(11, "Login and authentication", ["backend", "frontend", "authorization"], { mobile: true }),
  scenario(12, "Payments and subscriptions", ["backend", "payments", "subscriptions"]),
  scenario(13, "Realtime synchronization", ["backend", "frontend", "realtime"], { mobile: true }),
  scenario(14, "Lifecycle search", ["backend", "frontend"]),
  scenario(15, "Permissions and tenant isolation", ["backend", "frontend", "authorization"]),
  scenario(16, "Error recovery", ["backend", "frontend", "realtime"], { mobile: true }),
];

const hasFailure = scenarios.some((item) => item.status === "FAIL");
const hasWarning = scenarios.some((item) => item.status === "WARNING");
const certification = hasFailure || hasWarning ? "FAIL" : "PASS";
const report = {
  generatedAt: new Date().toISOString(),
  certification,
  recommendation: certification === "PASS" ? "Business Workflow Certification: PASS" : "Business Workflow Certification: FAIL",
  strict,
  scenarios,
  executableEvidence: Object.fromEntries(Object.entries(evidence).map(([key, value]) => [key, {
    status: value.passed ? "PASS" : "FAIL",
    exitCode: value.exitCode,
    output: value.output,
  }])),
};

const output = `${JSON.stringify(report, null, 2)}\n`;
if (process.env.BUSINESS_CERTIFICATION_OUTPUT) fs.writeFileSync(path.resolve(process.env.BUSINESS_CERTIFICATION_OUTPUT), output);
process.stdout.write(output);
if (strict && certification !== "PASS") process.exitCode = 1;
