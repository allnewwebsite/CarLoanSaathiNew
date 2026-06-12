import "dotenv/config";
import { rebuildBankAnalyticsAggregates } from "../services/bankAnalyticsAggregate.service.js";

const result = await rebuildBankAnalyticsAggregates({
  dryRun: process.env.BANK_ANALYTICS_BACKFILL_APPLY !== "true",
  batchSize: Number(process.env.BANK_ANALYTICS_BACKFILL_BATCH_SIZE || 500),
});

console.log(JSON.stringify(result, null, 2));
