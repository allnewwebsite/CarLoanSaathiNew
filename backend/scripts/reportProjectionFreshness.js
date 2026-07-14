import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { validateProjectionFreshness } from "../services/projection.service.js";

const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
const outputPath = outputArg ? outputArg.slice("--output=".length) : "";
const backfillComplete = process.argv.includes("--backfill-complete");
const sampleLimit = Math.min(Math.max(Number(process.env.PROJECTION_VALIDATION_SAMPLE_LIMIT || 10), 1), 10);

async function main() {
  const summary = await validateProjectionFreshness({ sampleLimit });
  const report = {
    generatedAt: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    backfillComplete,
    ...summary,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) fs.writeFileSync(path.resolve(outputPath), serialized);
  process.stdout.write(serialized);
  if (!backfillComplete || !summary.checked || summary.stale || summary.rebuildQueued) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
