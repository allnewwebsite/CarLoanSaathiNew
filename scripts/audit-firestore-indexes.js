import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, "firestore.indexes.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const requiredIndexes = [
  ["leads", "dealershipId:ASCENDING", "createdAt:DESCENDING"],
  ["leads", "dealershipId:ASCENDING", "status:ASCENDING", "createdAt:DESCENDING"],
  ["leads", "bankId:ASCENDING", "createdAt:DESCENDING"],
  ["leads", "bankId:ASCENDING", "status:ASCENDING", "createdAt:DESCENDING"],
  ["leads", "assignedExecutiveId:ASCENDING", "createdAt:DESCENDING"],
  ["leads", "assignedExecutiveEmail:ASCENDING", "createdAt:DESCENDING"],
  ["leads", "caseId:ASCENDING", "createdAt:DESCENDING"],
  ["leads", "dealershipId:ASCENDING", "isDeadCase:ASCENDING", "deadCaseDate:DESCENDING"],
  ["leads", "bankId:ASCENDING", "isDeadCase:ASCENDING", "deadCaseDate:DESCENDING"],
  ["documents", "leadId:ASCENDING", "createdAt:DESCENDING"],
  ["bankDocuments", "leadId:ASCENDING", "createdAt:DESCENDING"],
  ["notifications", "recipientId:ASCENDING", "createdAt:DESCENDING"],
  ["notifications", "recipientId:ASCENDING", "read:ASCENDING", "createdAt:DESCENDING"],
  ["pendingDealershipApprovals", "status:ASCENDING", "createdAt:DESCENDING"],
  ["pendingBankApprovals", "status:ASCENDING", "updatedAt:DESCENDING"],
  ["approvalLogs", "entityType:ASCENDING", "createdAt:DESCENDING"],
  ["financeViews", "viewType:ASCENDING", "scopeId:ASCENDING", "createdAt:DESCENDING"],
  ["financeViews", "viewType:ASCENDING", "scopeId:ASCENDING", "status:ASCENDING", "createdAt:DESCENDING"],
  ["gmViews", "viewType:ASCENDING", "scopeId:ASCENDING", "createdAt:DESCENDING"],
  ["bankViews", "viewType:ASCENDING", "scopeId:ASCENDING", "createdAt:DESCENDING"],
  ["executiveViews", "viewType:ASCENDING", "scopeId:ASCENDING", "createdAt:DESCENDING"],
  ["timelineProjection", "viewType:ASCENDING", "leadId:ASCENDING", "createdAt:DESCENDING"],
];

function indexSignature(index = {}) {
  return [
    index.collectionGroup,
    ...(index.fields || []).map((field) => `${field.fieldPath}:${field.order || field.arrayConfig}`),
  ].join("|");
}

const present = new Set((manifest.indexes || []).map(indexSignature));
const missing = requiredIndexes.filter((contract) => !present.has(contract.join("|")));

if (missing.length) {
  console.error("Missing required Firestore composite indexes:");
  for (const contract of missing) console.error(`- ${contract.join(" | ")}`);
  process.exit(1);
}

console.log(`Firestore index audit passed (${requiredIndexes.length} required indexes).`);
