import { spawnSync } from "node:child_process";

const projects = [
  { name: "backend", args: ["--prefix", "backend", "audit", "--audit-level=high"] },
  { name: "frontend", args: ["--prefix", "frontend", "audit", "--audit-level=high"] },
];

let failed = false;

for (const project of projects) {
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm", ...project.args] : project.args;
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    failed = true;
    console.error(`Dependency audit failed for ${project.name}.`);
  }
}

if (failed) {
  process.exit(1);
}

console.log("Dependency audit passed for high/critical vulnerabilities.");
