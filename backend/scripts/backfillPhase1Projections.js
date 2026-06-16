import "dotenv/config";
import { queryRecords, syncWriteProjections } from "../services/firestore.service.js";
import { syncLeadProjection } from "../services/projection.service.js";

const apply = process.argv.includes("--apply");
const sample = process.argv.includes("--sample");
const batchSize = Math.min(Math.max(Number(process.env.BACKFILL_BATCH_SIZE || 50), 1), 250);
const maxLeads = Math.max(Number(process.env.BACKFILL_MAX_LEADS || 0), 0);

const workflowSources = [
  "leadAssignments",
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
    if (!apply) break;
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

async function scanLeadProjections() {
  const seen = new Set();
  let cursor = null;
  let scanned = 0;
  let projected = 0;
  do {
    const page = await queryRecords("leads", {
      limit: batchSize,
      maxLimit: batchSize,
      cursor,
      orderBy: "createdAt",
      direction: "desc",
      allowGlobal: true,
    }).catch(() => ({ data: [], nextCursor: null }));
    const rows = page.data || [];
    for (const lead of rows) {
      const key = `leads:${lead.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      scanned += 1;
      if (apply) {
        await syncLeadProjection(lead);
        projected += 1;
      }
      if (maxLeads && scanned >= maxLeads) break;
    }
    if (maxLeads && scanned >= maxLeads) break;
    if (!apply) break;
    cursor = page.nextCursor;
  } while (cursor);
  return { collection: "leads", scanned, projected };
}

const collections = [...workflowSources, ...bankSources];

if (!apply && !sample) {
  console.log(JSON.stringify({
    mode: "dry-run",
    note: "No Firestore reads or writes performed. Re-run with --sample to inspect one page, or --apply to write projections.",
    leadProjectionRepair: {
      collection: "leads",
      writes: ["adminViews", "financeViews", "gmViews", "bankViews", "executiveViews", "leadDetailsProjection", "bankDealershipViews"],
    },
    collections,
    batchSize,
    maxLeads: maxLeads || "unlimited",
  }, null, 2));
  process.exit(0);
}

const results = [await scanLeadProjections()];
for (const collection of collections) {
  results.push(await scanCollection(collection));
}

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  note: apply ? "Phase 1 projections backfilled." : "No writes performed. Re-run with --apply to write projections.",
  results,
}, null, 2));
