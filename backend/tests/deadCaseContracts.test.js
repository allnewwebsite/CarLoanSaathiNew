import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..", "..");
process.env.DOTENV_CONFIG_PATH = path.join(workspaceRoot, "__dead_case_contract_test_env__");
delete process.env.FIREBASE_PROJECT_ID;
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

const [
  firestoreModule,
  leadQueryModule,
  deadCaseModule,
  realtimeModule,
  subscriptionModule,
] = await Promise.all([
  import("../services/firestore.service.js"),
  import("../services/leadQuery.service.js"),
  import("../services/deadCase.service.js"),
  import("../services/realtime.service.js"),
  import("../services/subscription.service.js"),
]);

const { createRecord, getRecord, queryRecords, updateRecord } = firestoreModule;
const { queryAllLeads, queryDeadCases } = leadQueryModule;
const { moveLeadToDeadCase, restoreDeadCase } = deadCaseModule;
const { publishRealtimeEvent, REALTIME_EVENTS } = realtimeModule;
const { initializeDealershipTrial, subscriptionSnapshot } = subscriptionModule;

function financeReq(dealershipId) {
  return {
    user: {
      role: "finance-desk",
      email: `${dealershipId}@dealer.test`,
      uid: `finance-${dealershipId}`,
      dealershipId,
    },
    headers: {},
    ip: "127.0.0.1",
    requestId: `req-${dealershipId}`,
  };
}

function roleReq(role, dealershipId) {
  return {
    user: {
      role,
      email: `${role}-${dealershipId}@test.local`,
      uid: `${role}-${dealershipId}`,
      dealershipId,
      bankId: `bank-${dealershipId}`,
    },
    headers: {},
    ip: "127.0.0.1",
  };
}

async function fixtureLead(overrides = {}) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dealershipId = overrides.dealershipId || `dealer-${token}`;
  return createRecord("leads", {
    id: `lead-${token}`,
    caseId: `CLS-DEAD-${token}`,
    fullName: "Dead Case Contract Customer",
    customerName: "Dead Case Contract Customer",
    mobile: "9876543210",
    city: "Mumbai",
    dealershipId,
    dealershipEmail: dealershipId,
    status: "New",
    assignedExecutiveId: `exec-${token}`,
    assignedExecutiveName: "Executive Contract",
    ...overrides,
  });
}

test("Finance Desk can move a lead to dead cases and required fields are enforced", async () => {
  const dealershipId = `dealer-dead-required-${Date.now()}`;
  const lead = await fixtureLead({ dealershipId });
  const req = financeReq(dealershipId);

  await assert.rejects(
    () => moveLeadToDeadCase({ req, leadId: lead.id, reason: "Customer Not Interested", notes: "" }),
    (error) => {
      assert.equal(error.code, "DEAD_CASE_NOTES_REQUIRED");
      assert.equal(error.status, 400);
      return true;
    },
  );

  await assert.rejects(
    () => moveLeadToDeadCase({ req, leadId: lead.id, reason: "Not A Real Reason", notes: "Customer declined." }),
    (error) => {
      assert.equal(error.code, "INVALID_DEAD_CASE_REASON");
      assert.equal(error.status, 400);
      return true;
    },
  );

  const updated = await moveLeadToDeadCase({
    req,
    leadId: lead.id,
    reason: "Customer Not Interested",
    notes: "Customer confirmed they do not want to continue.",
  });

  assert.equal(updated.isDeadCase, true);
  assert.equal(updated.deadCaseReason, "Customer Not Interested");
  assert.equal(updated.deadCaseNotes, "Customer confirmed they do not want to continue.");
  assert.ok(updated.deadCaseDate);
  assert.ok(updated.deadCaseUpdatedAt);
});

test("dead cases leave active lists, enter dead-case lists, search by reason, and restore", async () => {
  const dealershipId = `dealer-dead-list-${Date.now()}`;
  const req = financeReq(dealershipId);
  const activeLead = await fixtureLead({ dealershipId, caseId: `CLS-ACTIVE-${Date.now()}` });
  const deadLead = await fixtureLead({ dealershipId, caseId: `CLS-DEAD-LIST-${Date.now()}` });

  const moved = await moveLeadToDeadCase({
    req,
    leadId: deadLead.id,
    reason: "Duplicate Lead",
    notes: "Same customer already has an active case.",
  });

  const allLeads = await queryAllLeads({ query: { search: "Dead Case Contract Customer", limit: 50 } });
  const allIds = new Set(allLeads.data.map((lead) => lead.id));
  assert.equal(allIds.has(activeLead.id), true);
  assert.equal(allIds.has(deadLead.id), false);

  const deadCases = await queryDeadCases({ dealershipId, query: { limit: 50 } });
  assert.deepEqual(deadCases.data.map((lead) => lead.id), [deadLead.id]);

  const searchResults = await queryDeadCases({ dealershipId, query: { search: "Duplicate", limit: 50 } });
  assert.equal(searchResults.data.some((lead) => lead.id === deadLead.id), true);

  const markedTimeline = await queryRecords("leadTimeline", {
    where: [{ field: "leadId", value: deadLead.id }],
    search: "dead-case-marked",
    searchFields: ["eventType"],
    limit: 20,
  });
  assert.equal(markedTimeline.data.some((event) => event.eventType === "dead-case-marked"), true);

  const markedNotifications = await queryRecords("notifications", {
    search: moved.caseId,
    searchFields: ["caseId", "title", "message"],
    limit: 20,
  });
  assert.equal(markedNotifications.data.some((item) => item.type === "dead-case" && item.read === false), true);

  const restored = await restoreDeadCase({ req, leadId: deadLead.id });
  assert.equal(restored.isDeadCase, false);

  const restoredTimeline = await queryRecords("leadTimeline", {
    where: [{ field: "leadId", value: deadLead.id }],
    search: "dead-case-restored",
    searchFields: ["eventType"],
    limit: 20,
  });
  assert.equal(restoredTimeline.data.some((event) => event.eventType === "dead-case-restored"), true);

  const restoredNotifications = await queryRecords("notifications", {
    search: restored.caseId,
    searchFields: ["caseId", "title", "message"],
    limit: 20,
  });
  assert.equal(restoredNotifications.data.some((item) => item.type === "dead-case-restored" && item.read === false), true);

  const afterRestoreActive = await queryAllLeads({ query: { caseId: deadLead.caseId, limit: 10 } });
  assert.equal(afterRestoreActive.data.some((lead) => lead.id === deadLead.id), true);
  const afterRestoreDead = await queryDeadCases({ dealershipId, query: { limit: 50 } });
  assert.equal(afterRestoreDead.data.some((lead) => lead.id === deadLead.id), false);
});

test("GM, bank, and executive users cannot mutate dead cases", async () => {
  const dealershipId = `dealer-dead-readonly-${Date.now()}`;
  const req = financeReq(dealershipId);
  const lead = await fixtureLead({ dealershipId });
  const deadLead = await moveLeadToDeadCase({
    req,
    leadId: lead.id,
    reason: "Customer Unreachable",
    notes: "No answer after repeated follow ups.",
  });

  for (const role of ["gm", "bank-manager", "loan-executive"]) {
    await assert.rejects(
      () => moveLeadToDeadCase({
        req: roleReq(role, dealershipId),
        leadId: lead.id,
        reason: "Other",
        notes: "Attempted unauthorized update.",
      }),
      (error) => {
        assert.equal(error.code, "DEAD_CASE_FINANCE_ONLY");
        assert.equal(error.status, 403);
        return true;
      },
    );
    await assert.rejects(
      () => updateRecord("leads", deadLead.id, { status: "Contacted", mutatedBy: role }),
      (error) => {
        assert.equal(error.code, "DEAD_CASE_IMMUTABLE");
        assert.equal(error.status, 409);
        return true;
      },
    );
  }

  const persisted = await getRecord("leads", lead.id);
  assert.equal(persisted.isDeadCase, true);
  assert.equal(persisted.status, "New");
});

test("dead-case SSE event shape includes the realtime patch fields", async () => {
  const lead = {
    id: "lead-sse-contract",
    caseId: "CLS-SSE-DEAD",
    fullName: "SSE Dead Customer",
    mobile: "9876543210",
    dealershipId: "dealer-sse",
    isDeadCase: true,
    deadCaseDate: "2026-06-17T08:00:00.000Z",
    deadCaseBy: "finance@test.local",
    deadCaseReason: "Other",
    deadCaseNotes: "Realtime contract check.",
    deadCaseUpdatedAt: "2026-06-17T08:01:00.000Z",
  };

  const event = publishRealtimeEvent({
    eventType: REALTIME_EVENTS.LEAD_MARKED_DEAD,
    lead,
    actor: { role: "finance-desk", email: "finance@test.local" },
  });

  assert.equal(event.eventType, REALTIME_EVENTS.LEAD_MARKED_DEAD);
  assert.equal(event.leadId, lead.id);
  assert.equal(event.lead.isDeadCase, true);
  assert.equal(event.lead.deadCaseReason, "Other");
  assert.equal(event.lead.deadCaseDate, "2026-06-17T08:00:00.000Z");
  assert.equal(event.affectedPortals.includes("finance"), true);
  assert.equal(event.affectedPortals.includes("admin"), true);
});

test("Firestore indexes include dead-case query contracts", () => {
  const indexPath = path.join(workspaceRoot, "firestore.indexes.json");
  const config = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const leadIndexes = config.indexes.filter((item) => item.collectionGroup === "leads");
  const signatures = leadIndexes.map((item) => item.fields.map((field) => field.fieldPath).join("|"));

  assert.equal(signatures.includes("isDeadCase|deadCaseDate"), true);
  assert.equal(signatures.includes("dealershipId|isDeadCase|deadCaseDate"), true);
  assert.equal(signatures.includes("assignedExecutiveId|status|isDeadCase"), true);
});

test("subscription trial days are dynamic and not stored as a static counter", async () => {
  const dealershipId = `dealer-trial-dynamic-${Date.now()}`;
  const trialStartDate = "2026-06-01T00:00:00.000Z";
  await initializeDealershipTrial({
    dealershipId,
    dealership: { dealershipName: "Dynamic Trial Motors", loginEmail: `${dealershipId}@dealer.test` },
    approvedAt: trialStartDate,
    trialDays: 60,
  });

  const stored = await getRecord("dealershipSubscriptions", dealershipId);
  assert.equal(Object.hasOwn(stored, "daysRemaining"), false);
  assert.equal(Object.hasOwn(stored, "trialEndDate"), true);

  assert.equal(subscriptionSnapshot(stored, "2026-06-01T00:00:00.000Z").daysRemaining, 60);
  assert.equal(subscriptionSnapshot(stored, "2026-06-03T00:00:00.000Z").daysRemaining, 58);
  assert.equal(subscriptionSnapshot(stored, "2026-07-04T00:00:00.000Z").trialStatus, "WARNING");
  assert.equal(subscriptionSnapshot(stored, "2026-07-29T00:00:00.000Z").trialStatus, "EXPIRING");
  assert.equal(subscriptionSnapshot(stored, "2026-08-01T00:00:00.000Z").trialStatus, "EXPIRED");
});
