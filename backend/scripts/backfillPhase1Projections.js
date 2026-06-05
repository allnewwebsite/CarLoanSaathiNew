import "dotenv/config";
import { queryRecords, syncWriteProjections } from "../services/firestore.service.js";

const apply = process.argv.includes("--apply");
const batchSize = Math.min(Math.max(Number(process.env.BACKFILL_BATCH_SIZE || 250), 1), 500);

const workflowSources = [
  "leadAssignments",
  "slaLogs",
  "reassignmentLogs",
  "payouts",
  "commissions",
  "notifications",
  "settings",
];

const bankSources = [
  "banks",
  "bankPartners",
  "branches",
  "branchManagers",
  "pendingBankApprovals",
];

async function scanCollectionByOrder(collection, orderBy, seen) {
  let cursor = null;
  let scanned = 0;
  let projected = 0;
  do {
    const page = await queryRecords(collection, {
      limit: batchSize,
      maxLimit: batchSize,
      cursor,
      orderBy,
      direction: "desc",
    }).catch(() => ({ data: [], nextCursor: null }));
    const rows = page.data || [];
    for (const row of rows) {
      const key = `${collection}:${row.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      scanned += 1;
      if (apply) {
        await syncWriteProjections(collection, row);
        projected += 1;
      }
    }
    cursor = page.nextCursor;
  } while (cursor);
  return { scanned, projected };
}

async function scanCollection(collection) {
  const seen = new Set();
  const updated = await scanCollectionByOrder(collection, "updatedAt", seen);
  const created = await scanCollectionByOrder(collection, "createdAt", seen);
  return {
    collection,
    scanned: updated.scanned + created.scanned,
    projected: apply ? updated.projected + created.projected : 0,
  };
}

const collections = [...workflowSources, ...bankSources];
const results = [];
for (const collection of collections) {
  results.push(await scanCollection(collection));
}

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  note: apply ? "Phase 1 projections backfilled." : "No writes performed. Re-run with --apply to write projections.",
  results,
}, null, 2));
