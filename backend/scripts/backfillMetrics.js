import "dotenv/config";
import { rebuildHistoricalMetrics, validateMetricsIntegrity } from "../services/metricsBackfill.service.js";

const dryRun = process.env.BACKFILL_APPLY !== "true";
const limit = Number(process.env.BACKFILL_BATCH_SIZE || 250);

const result = await rebuildHistoricalMetrics({ dryRun, limit });
const integrity = await validateMetricsIntegrity();

console.log(JSON.stringify({ result, integrity }, null, 2));
