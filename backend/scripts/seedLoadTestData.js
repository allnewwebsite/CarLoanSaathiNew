import "dotenv/config";
import { upsertRecord } from "../services/firestore.service.js";

const env = String(process.env.LOAD_TEST_ENV || process.env.NODE_ENV || "local").toLowerCase();
const apply = process.env.LOAD_TEST_SEED_APPLY === "true";
const count = Number(process.env.LOAD_TEST_LEAD_COUNT || 1000);
const batchSize = Math.min(Number(process.env.LOAD_TEST_BATCH_SIZE || 250), 500);
const dealershipCount = Number(process.env.LOAD_TEST_DEALERSHIPS || 10);
const bankCount = Number(process.env.LOAD_TEST_BANKS || 5);
const executiveCount = Number(process.env.LOAD_TEST_EXECUTIVES || 20);

if (apply && !["staging", "stage", "loadtest", "local", "development"].includes(env)) {
  throw new Error("Refusing to seed load-test data outside staging/local. Set LOAD_TEST_ENV=staging.");
}

const statuses = ["Bank Process", "Pending Documents", "Disbursed", "Rejected With Reason"];
const cities = ["Delhi", "Gurugram", "Bahadurgarh", "Noida", "Jaipur", "Chandigarh"];
const banks = Array.from({ length: bankCount }, (_, index) => `BNK-LT-${String(index + 1).padStart(4, "0")}`);
const dealerships = Array.from({ length: dealershipCount }, (_, index) => `DLR-LT-${String(index + 1).padStart(4, "0")}`);
const executives = Array.from({ length: executiveCount }, (_, index) => `exec-load-${String(index + 1).padStart(4, "0")}@loadtest.local`);

function pick(values, index) {
  return values[index % values.length];
}

function leadRecord(index) {
  const number = index + 1;
  const status = pick(statuses, number);
  const dealershipId = pick(dealerships, number);
  const bankId = pick(banks, number);
  const assignedExecutiveId = pick(executives, number);
  const createdAt = new Date(Date.now() - number * 60_000).toISOString();
  return {
    id: `loadtest-lead-${String(number).padStart(7, "0")}`,
    caseId: `CLS-LT-${String(number).padStart(7, "0")}`,
    customerName: `Load Test Customer ${number}`,
    fullName: `Load Test Customer ${number}`,
    mobileNumber: `98${String(number).padStart(8, "0").slice(-8)}`,
    customerCity: pick(cities, number),
    city: pick(cities, number),
    preferredBank: `Load Test Bank ${((number % bankCount) || bankCount)}`,
    carOnRoadPrice: 900000 + (number % 30) * 10000,
    requiredLoanAmount: 650000 + (number % 20) * 5000,
    loanAmount: 650000 + (number % 20) * 5000,
    status,
    currentStatus: status,
    dealershipId,
    bankId,
    assignedExecutiveId,
    assignedExecutiveEmail: assignedExecutiveId,
    assignedSalespersonId: `sales-load-${String((number % 50) + 1).padStart(4, "0")}`,
    salespersonName: `Load Salesperson ${(number % 50) + 1}`,
    createdAt,
    generatedDate: createdAt.slice(0, 10),
    updatedAt: createdAt,
    loadTest: true,
  };
}

async function seedReferenceData() {
  for (const dealershipId of dealerships) {
    await upsertRecord("dealerships", dealershipId, {
      id: dealershipId,
      dealershipId,
      dealershipName: `Load Test Dealership ${dealershipId}`,
      active: true,
      accountActive: true,
      status: "active",
      loadTest: true,
      createdAt: new Date().toISOString(),
    });
  }
  for (const bankId of banks) {
    await upsertRecord("bankPartners", bankId, {
      id: bankId,
      bankId,
      bankName: `Load Test Bank ${bankId}`,
      active: true,
      activeLeadCount: Math.floor(count / bankCount),
      loadTest: true,
      createdAt: new Date().toISOString(),
    });
  }
  for (const executiveEmail of executives) {
    const bankId = pick(banks, executives.indexOf(executiveEmail));
    await upsertRecord("loanExecutives", executiveEmail, {
      id: executiveEmail,
      email: executiveEmail,
      name: `Load Executive ${executives.indexOf(executiveEmail) + 1}`,
      bankId,
      bankPartnerId: bankId,
      active: true,
      loadTest: true,
      createdAt: new Date().toISOString(),
    });
  }
}

async function main() {
  const startedAt = Date.now();
  const summary = { apply, env, count, batchSize, dealerships: dealershipCount, banks: bankCount, executives: executiveCount };
  if (!apply) {
    console.log(JSON.stringify({ dryRun: true, summary, sample: leadRecord(0) }, null, 2));
    return;
  }

  await seedReferenceData();
  for (let index = 0; index < count; index += batchSize) {
    const batch = Array.from({ length: Math.min(batchSize, count - index) }, (_, offset) => leadRecord(index + offset));
    await Promise.all(batch.map((lead) => upsertRecord("leads", lead.id, lead)));
    console.log(JSON.stringify({ seeded: Math.min(index + batch.length, count), total: count }));
  }

  console.log(JSON.stringify({
    ...summary,
    durationMs: Date.now() - startedAt,
    message: "Synthetic load-test seed complete",
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
