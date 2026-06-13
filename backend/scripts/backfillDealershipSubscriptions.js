import "dotenv/config";
import { firestore } from "../firebase/admin.js";
import { getDealershipSubscription, initializeDealershipTrial } from "../services/subscription.service.js";

const APPLY = process.env.APPLY_SUBSCRIPTION_BACKFILL === "true";
const PAGE_SIZE = Math.min(Math.max(Number(process.env.SUBSCRIPTION_BACKFILL_BATCH_SIZE || 100), 10), 500);

async function main() {
  if (!firestore) throw new Error("Firestore Admin is not configured");
  const result = { mode: APPLY ? "apply" : "dry-run", scanned: 0, existing: 0, created: 0, skipped: 0, errors: [] };
  let cursor = null;
  do {
    let query = firestore.collection("dealerships").orderBy("__name__").limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    for (const doc of snapshot.docs) {
      result.scanned += 1;
      const dealership = { id: doc.id, ...doc.data() };
      const approved = dealership.approved === true || String(dealership.status || "").toLowerCase() === "approved";
      if (!approved || dealership.active === false) {
        result.skipped += 1;
        continue;
      }
      try {
        const existing = await getDealershipSubscription(doc.id, { initialize: false });
        if (existing) {
          result.existing += 1;
          continue;
        }
        if (APPLY) {
          await initializeDealershipTrial({
            dealershipId: doc.id,
            dealership,
            approvedAt: dealership.approvedAt || dealership.reviewedAt || dealership.accountApprovedAt || new Date().toISOString(),
          });
        }
        result.created += 1;
      } catch (error) {
        result.errors.push({ dealershipId: doc.id, message: error.message });
      }
    }
    cursor = snapshot.docs.at(-1) || null;
    if (snapshot.size < PAGE_SIZE) break;
  } while (cursor);
  console.log(JSON.stringify({
    ...result,
    note: APPLY ? "Subscription backfill completed." : "Dry run only. Set APPLY_SUBSCRIPTION_BACKFILL=true to create records.",
  }, null, 2));
  if (result.errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
