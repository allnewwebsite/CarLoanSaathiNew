if (process.env.VERIFY_USE_MEMORY === "true") {
  process.env.FIREBASE_PROJECT_ID = "";
  process.env.FIREBASE_CLIENT_EMAIL = "";
  process.env.FIREBASE_PRIVATE_KEY = "";
}

const { firestore } = await import("../firebase/admin.js");
const { upsertRecord, createRecord } = await import("../services/firestore.service.js");
const { updateDealershipBankTieUps, getDealershipBankTieUps, validateBranchTieUp } = await import("../services/dealership.service.js");
const { getBankByIFSC } = await import("../services/bank.service.js");
const { queryBankLeads, queryDealershipLeads, queryExecutiveLeads } = await import("../services/leadQuery.service.js");
const { reassignLeadToNextBranchExecutive } = await import("../services/assignment.service.js");
const { LEAD_STATUSES } = await import("../utils/status.constants.js");

const banks = [
  { id: "ICIC0000461", bankName: "ICICI Bank", ifscCode: "ICIC0000461", branchName: "Jhajjar", city: "Jhajjar", state: "Haryana" },
  { id: "HDFC0000461", bankName: "HDFC Bank", ifscCode: "HDFC0000461", branchName: "Rohtak", city: "Rohtak", state: "Haryana" },
  { id: "SBIN0000461", bankName: "SBI", ifscCode: "SBIN0000461", branchName: "Sonipat", city: "Sonipat", state: "Haryana" },
];

const dealers = [
  { id: "dealer-a@example.com", dealershipName: "Dealer A", city: "Jhajjar" },
  { id: "dealer-b@example.com", dealershipName: "Dealer B", city: "Rohtak" },
  { id: "dealer-c@example.com", dealershipName: "Dealer C", city: "Sonipat" },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function seedBanksAndDealers() {
  for (const bank of banks) {
    await upsertRecord("banks", bank.id, {
      ...bank,
      bankId: bank.id,
      ifsc: bank.ifscCode,
      bankIfsc: bank.ifscCode,
      approved: true,
      active: true,
      status: "active",
      approvalStatus: "approved",
    });
  }

  for (const dealer of dealers) {
    await upsertRecord("dealerships", dealer.id, {
      ...dealer,
      dealershipId: dealer.id,
      approved: true,
      active: true,
      status: "active",
    });
  }
}

async function createLead({ dealershipId, customerName, ifscCode, executiveId = "" }) {
  const dealer = dealers.find((item) => item.id === dealershipId);
  const bank = await validateBranchTieUp(dealershipId, ifscCode);
  const caseId = `TEST-${dealershipId.split("@")[0]}-${ifscCode}-${customerName}`.toUpperCase();
  return upsertRecord("leads", caseId, {
    caseId,
    fullName: customerName,
    mobile: "9876543210",
    city: dealer.city,
    dealershipId,
    dealershipEmail: dealershipId,
    dealerEmail: dealershipId,
    dealershipName: dealer.dealershipName,
    bankId: bank.bankId,
    assignedBankId: bank.bankId,
    assignedPartnerId: bank.bankId,
    bankName: bank.bankName,
    assignedBankName: bank.bankName,
    branchName: bank.branchName,
    selectedBankName: bank.bankName,
    selectedBranchName: bank.branchName,
    ifscCode,
    assignedBankIfsc: ifscCode,
    bankBranchCity: bank.city,
    branchCity: bank.city,
    routingCity: bank.city,
    branchId: bank.bankId,
    bankBranchId: bank.bankId,
    assignedExecutiveId: executiveId,
    assignedExecutiveEmail: executiveId ? `${executiveId}@example.com` : "",
    loanAmount: 500000,
    requiredLoanAmount: 500000,
    carPrice: 750000,
    carOnRoadPrice: 750000,
    status: LEAD_STATUSES.NEW,
  });
}

async function run() {
  if (firestore && process.env.ALLOW_DB_WORKFLOW_VERIFY !== "true") {
    throw new Error("Refusing to write verification records to Firestore. Set VERIFY_USE_MEMORY=true for local memory verification, or ALLOW_DB_WORKFLOW_VERIFY=true only in a safe test project.");
  }

  await seedBanksAndDealers();

  await updateDealershipBankTieUps("dealer-a@example.com", ["ICIC0000461", "HDFC0000461"]);
  await updateDealershipBankTieUps("dealer-b@example.com", ["ICIC0000461"]);
  await updateDealershipBankTieUps("dealer-c@example.com", ["SBIN0000461"]);

  const dealerATieUps = await getDealershipBankTieUps("dealer-a@example.com");
  const dealerBTieUps = await getDealershipBankTieUps("dealer-b@example.com");
  const dealerCTieUps = await getDealershipBankTieUps("dealer-c@example.com");
  assert(dealerATieUps.length === 2, "Dealer A should have ICICI + HDFC tie-ups");
  assert(dealerBTieUps.length === 1 && dealerBTieUps[0].ifscCode === "ICIC0000461", "Dealer B should have ICICI only");
  assert(dealerCTieUps.length === 1 && dealerCTieUps[0].ifscCode === "SBIN0000461", "Dealer C should have SBI only");

  const dealerALead = await createLead({ dealershipId: "dealer-a@example.com", customerName: "Rahul", ifscCode: "ICIC0000461", executiveId: "exec-icici" });
  const dealerBLead = await createLead({ dealershipId: "dealer-b@example.com", customerName: "Aman", ifscCode: "ICIC0000461" });
  const dealerCLead = await createLead({ dealershipId: "dealer-c@example.com", customerName: "Neha", ifscCode: "SBIN0000461" });

  await createRecord("loanExecutives", {
    id: "sun@example.com",
    name: "Sun",
    fullName: "Sun",
    email: "sun@example.com",
    officialEmail: "sun@example.com",
    mobile: "8578451145",
    jobId: "78454",
    bankId: "ICIC0000461",
    bankPartnerId: "ICIC0000461",
    bankName: "ICICI Bank",
    bankIfsc: "ICIC0000461",
    ifsc: "ICIC0000461",
    branchCity: "Jhajjar",
    city: "Jhajjar",
    active: true,
    status: "active",
  });

  const icici = await getBankByIFSC("ICIC0000461");
  const hdfc = await getBankByIFSC("HDFC0000461");
  const sbi = await getBankByIFSC("SBIN0000461");

  const iciciLeads = (await queryBankLeads({ bankId: icici.id, query: { limit: 20 } })).data;
  const hdfcLeads = (await queryBankLeads({ bankId: hdfc.id, query: { limit: 20 } })).data;
  const sbiLeads = (await queryBankLeads({ bankId: sbi.id, query: { limit: 20 } })).data;
  assert(iciciLeads.some((lead) => lead.id === dealerALead.id), "ICICI should receive Dealer A ICICI lead");
  assert(iciciLeads.some((lead) => lead.id === dealerBLead.id), "ICICI should receive Dealer B ICICI lead");
  assert(!hdfcLeads.some((lead) => lead.id === dealerALead.id), "HDFC must not receive Dealer A ICICI lead");
  assert(sbiLeads.some((lead) => lead.id === dealerCLead.id), "SBI should receive Dealer C SBI lead");

  const dealerALeads = (await queryDealershipLeads({ dealershipId: "dealer-a@example.com", query: { limit: 20 } })).data;
  const dealerBLeads = (await queryDealershipLeads({ dealershipId: "dealer-b@example.com", query: { limit: 20 } })).data;
  assert(dealerALeads.some((lead) => lead.id === dealerALead.id), "Dealer A should see its own lead");
  assert(!dealerBLeads.some((lead) => lead.id === dealerALead.id), "Dealer B must not see Dealer A lead");

  const executiveLeads = (await queryExecutiveLeads({ executiveId: "exec-icici", executiveEmail: "exec-icici@example.com", query: { limit: 20 } })).data;
  assert(executiveLeads.some((lead) => lead.id === dealerALead.id), "Assigned executive should see assigned lead");
  assert(!executiveLeads.some((lead) => lead.id === dealerBLead.id), "Executive must not see unassigned Dealer B lead");

  const assignedDealerBLead = await reassignLeadToNextBranchExecutive(dealerBLead.id, "verification-assignment", "bank-manager@example.com");
  assert(assignedDealerBLead.assignedExecutiveId === "sun@example.com", "Bank manager assignment should write executive id");
  assert(assignedDealerBLead.assignedExecutiveEmail === "sun@example.com", "Bank manager assignment should write executive email");
  assert(assignedDealerBLead.assignedExecutiveName === "Sun", "Bank manager assignment should write executive name");
  assert(assignedDealerBLead.assignedExecutiveMobile === "8578451145", "Bank manager assignment should write executive mobile");
  const sunLeads = (await queryExecutiveLeads({ executiveId: "sun@example.com", executiveEmail: "sun@example.com", query: { limit: 20 } })).data;
  assert(sunLeads.some((lead) => lead.id === dealerBLead.id), "Loan executive should see lead after bank manager assignment");

  console.log("Bank tie-up workflow verification passed.");
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
