import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const root = process.cwd();
const ignoredParts = new Set(["node_modules", "dist", ".git", ".vercel", ".firebase"]);
const sensitiveFileNames = new Set([".env", "serviceAccount.json", "firebase-adminsdk.json"]);
const patterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /FIREBASE_PRIVATE_KEY\s*=\s*["']?-----BEGIN/,
  /JWT_SECRET\s*=\s*(?!replace-with|your-|example|changeme)[^\s#]{16,}/i,
  /SUPER_ADMIN_PASSWORD\s*=\s*(?!replace-with|your-|example|changeme)[^\s#]{8,}/i,
  /AIza[0-9A-Za-z_-]{20,}/,
  /smtp:\/\/[^:\s]+:[^@\s]+@/i,
];

function isIgnored(file) {
  const parts = file.split(/[\\/]/);
  return parts.some((part) => ignoredParts.has(part));
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (isIgnored(path.relative(root, full))) continue;
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function stagedFiles() {
  try {
    return execSync("git diff --cached --name-only", { encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean)
      .map((file) => path.join(root, file))
      .filter((file) => fs.existsSync(file));
  } catch {
    return walk(root);
  }
}

const files = process.argv.includes("--staged") ? stagedFiles() : walk(root);
const findings = [];

for (const file of files) {
  const relative = path.relative(root, file);
  const base = path.basename(file);
  if (base.endsWith(".example")) continue;
  if (sensitiveFileNames.has(base) || base.endsWith(".pem") || base.endsWith(".key")) {
    findings.push(`${relative}: sensitive file must not be committed`);
    continue;
  }
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (patterns.some((pattern) => pattern.test(text))) findings.push(`${relative}: possible secret detected`);
}

if (findings.length) {
  console.error("Secret scan failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("Secret scan passed.");
