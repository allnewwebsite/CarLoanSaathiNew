import "dotenv/config";
import { firestore } from "../firebase/admin.js";
import { normalizeIfsc, validateBankLocation } from "../services/bankLocationMaster.service.js";

const APPLY = process.env.APPLY_IFSC_MIGRATION === "true";
const PAGE_SIZE = Math.min(Math.max(Number(process.env.IFSC_MIGRATION_PAGE_SIZE || 250), 25), 500);

const SOURCE_COLLECTIONS = [
  "pendingBankApprovals",
  "banks",
  "bankPartners",
  "branches",
  "branchManagers",
  "loanExecutives",
];

function branchIdentity(record = {}) {
  const ifsc = normalizeIfsc(record.branchIfsc || record.ifscCode || record.ifsc || record.bankIfsc || record.assignedBankIfsc);
  if (!ifsc) return null;
  const location = validateBankLocation({
    state: record.state || "Haryana",
    location: record.branchLocation || record.bankBranchLocation || record.branchName || record.branchCity || record.city,
  });
  if (!location.valid) return null;
  const bankName = String(record.bankName || record.companyName || record.name || "").trim();
  return {
    ifsc,
    bankName,
    branchLocation: location.location,
    state: location.state,
  };
}

function branchPatch(record = {}) {
  const identity = branchIdentity(record);
  if (!identity) return null;
  return {
    bankId: identity.ifsc,
    bankPartnerId: identity.ifsc,
    branchId: identity.ifsc,
    bankBranchId: identity.ifsc,
    ifsc: identity.ifsc,
    ifscCode: identity.ifsc,
    bankIfsc: identity.ifsc,
    branchIfsc: identity.ifsc,
    bankName: identity.bankName || record.bankName || record.companyName || "",
    branchName: record.branchName || identity.branchLocation,
    branchLocation: identity.branchLocation,
    bankBranchLocation: identity.branchLocation,
    branchCity: identity.branchLocation,
    city: identity.branchLocation,
    serviceArea: identity.branchLocation,
    state: identity.state,
    updatedAt: new Date().toISOString(),
  };
}

function catalogPatch(sourceCollection, sourceId, record = {}) {
  const patch = branchPatch(record);
  if (!patch?.ifscCode) return null;
  const status = String(record.status || record.approvalStatus || "").toLowerCase();
  const approved = record.approved === true || ["approved", "active"].includes(status);
  const active = record.active !== false && !["suspended", "disabled", "deleted", "rejected"].includes(status);
  if (!approved || !active || !patch.bankName || !patch.branchName) return null;
  return {
    id: patch.ifscCode,
    sourceCollection,
    sourceId,
    ...patch,
    approved: true,
    active: true,
    approvalStatus: "approved",
    approvedAt: record.approvedAt || null,
    createdAt: record.createdAt || new Date().toISOString(),
  };
}

async function listCollection(collection) {
  const rows = [];
  let cursor = null;
  do {
    let ref = firestore.collection(collection).orderBy("__name__").limit(PAGE_SIZE);
    if (cursor) ref = ref.startAfter(cursor);
    const snapshot = await ref.get();
    snapshot.docs.forEach((doc) => rows.push({ id: doc.id, ...doc.data() }));
    cursor = snapshot.docs.at(-1);
    if (snapshot.size < PAGE_SIZE) break;
  } while (cursor);
  return rows;
}

async function merge(collection, id, payload, counters) {
  counters.writes += 1;
  if (!APPLY) return;
  await firestore.collection(collection).doc(id).set(payload, { merge: true });
}

async function main() {
  if (!firestore) throw new Error("Firestore Admin is not configured");
  const counters = { scanned: 0, patched: 0, catalog: 0, skipped: 0, duplicates: 0, writes: 0 };
  const seenIfsc = new Map();
  const activeBranchIfsc = new Set();
  const disabledBranchIfsc = new Set();

  for (const collection of SOURCE_COLLECTIONS) {
    const rows = await listCollection(collection);
    for (const row of rows) {
      counters.scanned += 1;
      const patch = branchPatch(row);
      if (!patch) {
        counters.skipped += 1;
        continue;
      }
      const existing = seenIfsc.get(patch.ifscCode);
      if (existing && existing !== row.id) counters.duplicates += 1;
      else seenIfsc.set(patch.ifscCode, row.id);

      await merge(collection, row.id, patch, counters);
      counters.patched += 1;

      if (["banks", "bankPartners", "branches", "pendingBankApprovals"].includes(collection)) {
        await merge("branches", patch.ifscCode, { id: patch.ifscCode, ...patch }, counters);
        const catalog = catalogPatch(collection, row.id, { ...row, ...patch });
        if (catalog) {
          await merge("bankBranchCatalog", patch.ifscCode, catalog, counters);
          counters.catalog += 1;
          activeBranchIfsc.add(patch.ifscCode);
        } else {
          const status = String(row.status || row.approvalStatus || "").toLowerCase();
          if (["suspended", "disabled"].includes(status) || row.active === false) disabledBranchIfsc.add(patch.ifscCode);
        }
      }
    }
  }

  if (APPLY) {
    await firestore.collection("systemCounters").doc("platform").set({
      totalBranches: activeBranchIfsc.size + disabledBranchIfsc.size,
      activeBanks: activeBranchIfsc.size,
      bankPartners: activeBranchIfsc.size,
      disabledBranches: disabledBranchIfsc.size,
      updatedAt: new Date().toISOString(),
      ifscMigrationUpdatedAt: new Date().toISOString(),
    }, { merge: true });
  }

  console.log(JSON.stringify({
    mode: APPLY ? "apply" : "dry-run",
    pageSize: PAGE_SIZE,
    collections: SOURCE_COLLECTIONS,
    ...counters,
    uniqueIfsc: seenIfsc.size,
    activeBranches: activeBranchIfsc.size,
    disabledBranches: disabledBranchIfsc.size,
    note: APPLY ? "Migration writes completed." : "Dry run only. Set APPLY_IFSC_MIGRATION=true to write.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
