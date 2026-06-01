import "dotenv/config";
import { listRecords, queryRecords, updateRecord } from "../services/firestore.service.js";

const batchSize = Number(process.env.MIGRATE_LEAD_BRANCH_BATCH_SIZE || 100);

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function branchLookupKey(branch) {
  const bankName = normalize(branch.bankName || branch.bankPartner || branch.bankPartnerId || branch.companyName);
  const branchName = normalize(branch.branchName || branch.bankBranchLocation || branch.branchLocation || branch.branchCity || branch.city);
  return `${bankName}|${branchName}`;
}

function branchMatchesLead(lead, branch) {
  const values = [lead.branchId, lead.bankBranchId, lead.assignedPartnerId, lead.assignedBankId, lead.bankId, lead.ifscCode, lead.bankIfsc, lead.assignedBankName, lead.bankPartner, lead.bankName];
  const normalizedValues = values.map(normalize).filter(Boolean);
  if (!normalizedValues.length) return false;

  const branchId = normalize(branch.id);
  const branchIfsc = normalize(branch.ifscCode || branch.ifsc || "");
  if (normalizedValues.includes(branchId) || (branchIfsc && normalizedValues.includes(branchIfsc))) {
    return true;
  }

  const branchName = normalize(branch.branchName || branch.bankBranchLocation || branch.branchLocation || branch.branchCity || branch.city);
  const bankName = normalize(branch.bankName || branch.bankPartner || branch.bankPartnerId || branch.companyName);
  const leadBranchName = normalize(lead.branchName || lead.bankBranchLocation || lead.branchLocation || lead.branchCity || lead.city);
  const leadBankName = normalize(lead.bankName || lead.bankPartner || lead.assignedBankName || lead.assignedPartnerName || lead.preferredBank);

  return Boolean(branchName && leadBranchName && bankName && leadBankName && leadBranchName === branchName && leadBankName === bankName);
}

function branchPayload(branch) {
  return {
    branchId: branch.id,
    branchName: branch.branchName || branch.bankBranchLocation || branch.branchLocation || branch.branchCity || branch.city || "",
    ifscCode: branch.ifscCode || branch.ifsc || "",
    bankIfsc: branch.ifscCode || branch.ifsc || "",
    bankBranchLocation: branch.bankBranchLocation || branch.branchLocation || branch.branchCity || "",
    bankId: branch.bankPartnerId || branch.bankId || branch.bankPartner || branch.id,
    bankName: branch.bankName || branch.bankPartner || branch.companyName || "",
    assignedPartnerId: branch.id,
    assignedBankId: branch.bankPartnerId || branch.bankId || branch.bankPartner || branch.id,
    bankPartner: branch.bankName || branch.bankPartner || branch.companyName || "",
  };
}

async function migrateBatch(cursor) {
  const result = await queryRecords("leads", {
    where: [],
    orderBy: "createdAt",
    direction: "asc",
    limit: batchSize,
    cursor,
    allowGlobal: true,
  });
  return result;
}

async function main() {
  console.log("Starting legacy lead branch migration...");
  const branches = await listRecords("branches");
  if (!branches.length) {
    console.error("No branches found. Aborting migration.");
    process.exit(1);
  }

  let updates = 0;
  let skipped = 0;
  let processed = 0;
  let cursor = null;
  let page = await migrateBatch(cursor);

  while (page?.data?.length) {
    for (const lead of page.data) {
      processed += 1;
      if (lead.branchId && lead.ifscCode && lead.bankId) {
        skipped += 1;
        continue;
      }

      const candidate = branches.find((branch) => branchMatchesLead(lead, branch));
      if (!candidate) {
        skipped += 1;
        continue;
      }

      const payload = branchPayload(candidate);
      const existingValues = ["branchId", "branchName", "ifscCode", "bankIfsc", "bankBranchLocation", "bankId", "bankName", "assignedPartnerId", "assignedBankId", "bankPartner"];
      const next = {};
      for (const key of existingValues) {
        if (!lead[key] && payload[key]) next[key] = payload[key];
      }
      if (!Object.keys(next).length) {
        skipped += 1;
        continue;
      }

      await updateRecord("leads", lead.id, next);
      updates += 1;
    }
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
    page = await migrateBatch(cursor);
  }

  console.log(JSON.stringify({ processed, updated: updates, skipped }, null, 2));
  console.log("Legacy lead branch migration complete.");
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
