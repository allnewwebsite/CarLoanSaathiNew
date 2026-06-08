if (process.env.VERIFY_USE_MEMORY === "true") {
  process.env.FIREBASE_PROJECT_ID = "";
  process.env.FIREBASE_CLIENT_EMAIL = "";
  process.env.FIREBASE_PRIVATE_KEY = "";
}

const { firestore } = await import("../firebase/admin.js");
const { getRecord, queryRecords, updateRecord, upsertRecord } = await import("../services/firestore.service.js");
const { syncLeadProjection } = await import("../services/projection.service.js");
const { clearCachedValue } = await import("../services/ttlCache.service.js");
const { LEAD_STATUSES } = await import("../utils/status.constants.js");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function projectionRow(collection, scopeId, leadId) {
  const page = await queryRecords(collection, {
    where: [
      { field: "viewType", value: "lead" },
      { field: "scopeId", value: scopeId },
      { field: "sourceId", value: leadId },
    ],
    orderBy: "updatedAt",
    direction: "desc",
    limit: 5,
    maxLimit: 5,
  });
  return page.data[0] || null;
}

async function assertProjectionStatus({ collection, scopeId, leadId, status }) {
  const row = await projectionRow(collection, scopeId, leadId);
  assert(row, `${collection} projection missing for ${scopeId}`);
  assert(row.status === status, `${collection} projection stale: expected ${status}, got ${row.status}`);
}

async function assertLeadDetailStatus(leadId, status) {
  const page = await queryRecords("leadDetailsProjection", {
    where: [{ field: "leadId", value: leadId }],
    orderBy: "updatedAt",
    direction: "desc",
    limit: 1,
    maxLimit: 1,
  });
  const detail = page.data[0];
  assert(detail, "leadDetailsProjection missing");
  assert(detail.status === status, `leadDetailsProjection stale: expected ${status}, got ${detail.status}`);
  assert(detail.statusSummary?.status === status, `leadDetailsProjection statusSummary stale: expected ${status}, got ${detail.statusSummary?.status}`);
}

async function assertAllPortalStatuses(leadId, status) {
  const source = await getRecord("leads", leadId);
  assert(source?.status === status, `source lead stale: expected ${status}, got ${source?.status}`);
  await assertProjectionStatus({ collection: "adminViews", scopeId: "global", leadId, status });
  await assertProjectionStatus({ collection: "financeViews", scopeId: "dealer-sync@example.com", leadId, status });
  await assertProjectionStatus({ collection: "gmViews", scopeId: "dealer-sync@example.com", leadId, status });
  await assertProjectionStatus({ collection: "bankViews", scopeId: "BANK-SYNC-1", leadId, status });
  await assertProjectionStatus({ collection: "executiveViews", scopeId: "exec-sync-1", leadId, status });
  await assertProjectionStatus({ collection: "executiveViews", scopeId: "exec-sync@example.com", leadId, status });
  await assertLeadDetailStatus(leadId, status);
}

let statusTick = Date.now();

async function mutateLeadStatus(leadId, status) {
  statusTick += 1000;
  const statusUpdatedAt = new Date(statusTick).toISOString();
  const updated = await updateRecord("leads", leadId, {
    status,
    statusUpdatedAt,
    updatedByExecutiveId: "exec-sync-1",
    updatedByExecutiveName: "Sync Executive",
  });
  clearCachedValue(`lead-detail:${leadId}:`);
  clearCachedValue(`timeline:lead:${leadId}:`);
  clearCachedValue("admin:");
  clearCachedValue("bank:");
  clearCachedValue("dealer:");
  clearCachedValue("finance:");
  clearCachedValue("gm:");
  clearCachedValue("lead-query:");
  await syncLeadProjection(updated);
  return updated;
}

async function run() {
  if (firestore && process.env.ALLOW_DB_WORKFLOW_VERIFY !== "true") {
    throw new Error("Refusing to write status-sync verification records to Firestore. Set VERIFY_USE_MEMORY=true for local memory verification.");
  }

  const leadId = "status-sync-lead-1";
  await upsertRecord("leads", leadId, {
    id: leadId,
    caseId: "CLS-SYNC-0001",
    fullName: "Status Sync Customer",
    mobile: "9876543210",
    city: "Jhajjar",
    dealershipId: "dealer-sync@example.com",
    dealershipEmail: "dealer-sync@example.com",
    dealerEmail: "dealer-sync@example.com",
    dealershipName: "Sync Motors",
    bankId: "BANK-SYNC-1",
    assignedBankId: "BANK-SYNC-1",
    assignedPartnerId: "BANK-SYNC-1",
    bankName: "Sync Bank",
    assignedBankName: "Sync Bank",
    assignedBankIfsc: "SYNC0001",
    assignedExecutiveId: "exec-sync-1",
    assignedExecutiveEmail: "exec-sync@example.com",
    assignedExecutiveName: "Sync Executive",
    loanAmount: 500000,
    requiredLoanAmount: 500000,
    carPrice: 700000,
    carOnRoadPrice: 700000,
    status: LEAD_STATUSES.NEW,
    createdAt: new Date().toISOString(),
  });

  await syncLeadProjection(await getRecord("leads", leadId));
  await assertAllPortalStatuses(leadId, LEAD_STATUSES.NEW);

  const statuses = [
    LEAD_STATUSES.UNDER_BANK_PROCESS,
    LEAD_STATUSES.DOCUMENT_RECEIVED,
    LEAD_STATUSES.APPROVED,
    LEAD_STATUSES.DISBURSED,
  ];

  for (const status of statuses) {
    await mutateLeadStatus(leadId, status);
    await assertAllPortalStatuses(leadId, status);
  }

  console.log("Status synchronization workflow verification passed.");
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
