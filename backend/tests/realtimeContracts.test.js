import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { connectRealtimeClient, publishRealtimeEvent, realtimeStats, REALTIME_EVENTS } from "../services/realtime.service.js";
import { REALTIME_EVENT_REGISTRY, realtimeEventRegistryReport, realtimeRoleDeliveryMatrix } from "../services/realtimeEvents.service.js";
import { consumeRealtimeTicket, createRealtimeTicket } from "../services/realtimeTicket.service.js";

function mockConnection(user) {
  const req = new EventEmitter();
  req.headers = {};
  req.query = {};
  const writes = [];
  const res = {
    writeHead() {},
    write(chunk) {
      writes.push(String(chunk));
    },
    end() {},
  };
  connectRealtimeClient({ user, req, res });
  return {
    writes,
    close: () => req.emit("close"),
    operationalEvents: () => writes
      .join("")
      .split("\n\n")
      .filter((chunk) => chunk.includes("event: operational"))
      .map((chunk) => {
        const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
        return dataLine ? JSON.parse(dataLine.slice(6)) : null;
      })
      .filter(Boolean),
  };
}

test("SSE status dispatch targets operational tenant buckets without leaking to admin or unrelated clients", () => {
  const clients = [];
  const targetDealer = "dealer-realtime-target";
  const targetLead = {
    id: "lead-realtime-target",
    caseId: "CLS-REALTIME-TARGET",
    status: "Under Bank Process",
    dealershipId: targetDealer,
    dealershipEmail: targetDealer,
  };

  const target = mockConnection({
    role: "finance-desk",
    uid: "finance-target",
    email: "finance-target@example.com",
    dealershipId: targetDealer,
  });
  const admin = mockConnection({
    role: "super-admin",
    uid: "admin-realtime",
    email: "admin-realtime@example.com",
  });
  clients.push(target, admin);

  for (let index = 0; index < 30; index += 1) {
    clients.push(mockConnection({
      role: "finance-desk",
      uid: `finance-other-${index}`,
      email: `finance-other-${index}@example.com`,
      dealershipId: `dealer-realtime-other-${index}`,
    }));
  }

  assert.equal(realtimeStats().clients >= clients.length, true);
  assert.equal(realtimeStats().dispatchBuckets > 0, true);

  publishRealtimeEvent({
    eventType: REALTIME_EVENTS.LEAD_STATUS_UPDATED,
    lead: targetLead,
    data: { status: targetLead.status },
  });

  assert.equal(target.operationalEvents().length, 1);
  assert.equal(admin.operationalEvents().length, 0);
  for (const client of clients.slice(2)) {
    assert.equal(client.operationalEvents().length, 0);
  }

  clients.forEach((client) => client.close());
});

test("rejected lifecycle event reaches all four operational owners with archive metadata", () => {
  const lead = {
    id: "lead-rejected-realtime",
    caseId: "CLS-REJECTED-REALTIME",
    status: "REJECTED",
    workflowLocation: "rejected",
    archivedAt: "2026-07-20T10:00:00.000Z",
    terminalStatusAt: "2026-07-20T10:00:00.000Z",
    rejectedAt: "2026-07-20T10:00:00.000Z",
    rejectedBy: "executive-rejected@example.com",
    rejectionReason: "Bank policy",
    dealershipId: "dealer-rejected-realtime",
    bankId: "bank-rejected-realtime",
    branchId: "branch-rejected-realtime",
    assignedExecutiveId: "executive-rejected-realtime",
  };
  const clients = [
    mockConnection({ role: "finance-desk", uid: "finance-rejected", dealershipId: lead.dealershipId }),
    mockConnection({ role: "gm", uid: "gm-rejected", dealershipId: lead.dealershipId }),
    mockConnection({ role: "bank-manager", uid: "manager-rejected", bankId: lead.bankId, branchId: lead.branchId }),
    mockConnection({ role: "loan-executive", uid: lead.assignedExecutiveId }),
  ];

  publishRealtimeEvent({
    eventType: REALTIME_EVENTS.LEAD_STATUS_UPDATED,
    lead,
    data: { status: lead.status, previousStatus: "UNDER_BANK_PROCESS" },
  });

  clients.forEach((client) => {
    const events = client.operationalEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].status, "REJECTED");
    assert.equal(events[0].workflowLocation, "rejected");
    assert.equal(events[0].rejectionReason, "Bank policy");
    client.close();
  });
});

test("assigned lead realtime reaches admin, bank manager, and target loan executive", () => {
  const clients = [];
  const lead = {
    id: "lead-assigned-realtime",
    caseId: "CLS-ASSIGNED-REALTIME",
    status: "New",
    dealershipId: "dealer-assigned-realtime",
    dealershipEmail: "dealer-assigned-realtime",
    bankId: "bank-assigned-realtime",
    branchId: "branch-assigned-realtime",
    assignedExecutiveId: "executive-assigned-realtime",
    assignedExecutiveEmail: "executive-assigned@example.com",
    assignedExecutiveMobile: "9876543210",
  };

  const admin = mockConnection({ role: "super-admin", uid: "admin-assigned", email: "admin-assigned@example.com" });
  const bank = mockConnection({
    role: "bank-manager",
    uid: "bank-manager-assigned",
    email: "bank-manager-assigned@example.com",
    bankId: "bank-assigned-realtime",
    branchId: "branch-assigned-realtime",
  });
  const executive = mockConnection({
    role: "loan-executive",
    uid: "executive-assigned-realtime",
    email: "executive-assigned@example.com",
    mobile: "9876543210",
  });
  const otherExecutive = mockConnection({
    role: "loan-executive",
    uid: "executive-other-realtime",
    email: "executive-other@example.com",
    mobile: "9876543211",
  });
  clients.push(admin, bank, executive, otherExecutive);

  publishRealtimeEvent({
    eventType: REALTIME_EVENTS.EXECUTIVE_ASSIGNED,
    lead,
    data: {
      bankId: lead.bankId,
      branchId: lead.branchId,
      executiveId: lead.assignedExecutiveId,
      recipientId: lead.assignedExecutiveId,
    },
  });

  assert.equal(admin.operationalEvents().length, 1);
  assert.equal(bank.operationalEvents().length, 1);
  assert.equal(executive.operationalEvents().length, 1);
  assert.equal(otherExecutive.operationalEvents().length, 0);

  clients.forEach((client) => client.close());
});

test("reassignment realtime reaches both previous and new owner but no unrelated executive", () => {
  const previous = mockConnection({ role: "loan-executive", uid: "executive-previous", email: "previous@example.com" });
  const next = mockConnection({ role: "loan-executive", uid: "executive-next", email: "next@example.com" });
  const unrelated = mockConnection({ role: "loan-executive", uid: "executive-unrelated", email: "unrelated@example.com" });

  const event = publishRealtimeEvent({
    eventType: REALTIME_EVENTS.EXECUTIVE_REASSIGNED,
    lead: {
      id: "lead-owner-transfer",
      caseId: "CLS-OWNER-TRANSFER",
      assignedExecutiveId: "executive-next",
      assignedExecutiveEmail: "next@example.com",
    },
    data: {
      executiveId: "executive-next",
      recipientId: "executive-next",
      previousExecutiveId: "executive-previous",
      previousExecutiveIds: ["executive-previous", "previous@example.com"],
    },
  });

  assert.equal(previous.operationalEvents().length, 1);
  assert.equal(next.operationalEvents().length, 1);
  assert.equal(unrelated.operationalEvents().length, 0);
  assert.deepEqual(event.data.previousExecutiveIds, ["executive-previous", "previous@example.com"]);
  previous.close();
  next.close();
  unrelated.close();
});

test("session revocation realtime targets only the affected authenticated identity", () => {
  const target = mockConnection({ role: "bank-manager", uid: "password-user", email: "password-user@example.com", bankId: "bank-password" });
  const unrelated = mockConnection({ role: "bank-manager", uid: "other-user", email: "other-user@example.com", bankId: "bank-password" });
  publishRealtimeEvent({
    eventType: REALTIME_EVENTS.SESSION_REVOKED,
    data: {
      recipientId: "password-user",
      recipientIds: ["password-user", "password-user@example.com"],
      reason: "password-changed",
    },
  });
  assert.equal(target.operationalEvents().length, 1);
  assert.equal(unrelated.operationalEvents().length, 0);
  target.close();
  unrelated.close();
});

test("SSE keeps one connection per user identity", () => {
  const user = {
    sessionId: "same-session",
    role: "finance-desk",
    uid: "finance-single-connection",
    email: "finance-single-connection@example.com",
    dealershipId: "dealer-single-connection",
  };
  const first = mockConnection(user);
  const second = mockConnection(user);

  publishRealtimeEvent({
    eventType: REALTIME_EVENTS.LEAD_CREATED,
    lead: {
      id: "lead-single-connection",
      caseId: "CLS-SINGLE-CONNECTION",
      dealershipId: "dealer-single-connection",
    },
  });

  assert.equal(first.operationalEvents().length, 0);
  assert.equal(second.operationalEvents().length, 1);
  first.close();
  second.close();
});

test("realtime connection tickets are short-lived one-use credentials", async () => {
  const previousRedisFlag = process.env.ENABLE_REALTIME_REDIS;
  process.env.ENABLE_REALTIME_REDIS = "false";
  try {
    const user = { sessionId: "ticket-session", role: "finance-desk", uid: "ticket-user" };
    const issued = await createRealtimeTicket(user);
    assert.equal(Boolean(issued.ticket), true);
    assert.equal(issued.expiresInMs, 60_000);
    assert.deepEqual(await consumeRealtimeTicket(issued.ticket), user);
    assert.equal(await consumeRealtimeTicket(issued.ticket), null);
  } finally {
    if (previousRedisFlag === undefined) delete process.env.ENABLE_REALTIME_REDIS;
    else process.env.ENABLE_REALTIME_REDIS = previousRedisFlag;
  }
});

test("SSE requests canonical reconciliation when replay history has a gap", () => {
  const req = new EventEmitter();
  req.headers = {};
  req.query = { lastEventId: "1" };
  const writes = [];
  const res = {
    writeHead() {},
    write(chunk) { writes.push(String(chunk)); },
    end() {},
  };
  connectRealtimeClient({
    user: {
      sessionId: "reconcile-session",
      role: "finance-desk",
      uid: "reconcile-user",
      dealershipId: "dealer-reconcile",
    },
    req,
    res,
  });
  assert.equal(writes.some((chunk) => chunk.includes("event: reconcile-required")), true);
  assert.equal(writes.some((chunk) => chunk.includes("replay-buffer-overflow") || chunk.includes("replay-buffer-unavailable")), true);
  req.emit("close");
});

test("realtime registry documents every event and health stats expose audit reports", () => {
  const uniqueEvents = [...new Set(Object.values(REALTIME_EVENTS))];
  uniqueEvents.forEach((eventType) => {
    const definition = REALTIME_EVENT_REGISTRY[eventType];
    assert.equal(Boolean(definition), true, `${eventType} must be registered`);
    assert.equal(Boolean(definition.description), true, `${eventType} must have a description`);
    assert.equal(Array.isArray(definition.roles) && definition.roles.length > 0, true, `${eventType} must define roles`);
    assert.equal(Array.isArray(definition.scopes) && definition.scopes.length > 0, true, `${eventType} must define scopes`);
  });

  const report = realtimeEventRegistryReport();
  const roleMatrix = realtimeRoleDeliveryMatrix();
  const stats = realtimeStats();

  assert.equal(report.length, uniqueEvents.length);
  assert.equal(Array.isArray(roleMatrix["super-admin"]), true);
  assert.equal(Array.isArray(stats.eventRegistry), true);
  assert.equal(Boolean(stats.connectionLifecycle), true);
  assert.equal(Boolean(stats.eventAudit), true);
  assert.equal(Boolean(stats.performance), true);
  assert.equal(Number.isFinite(stats.productionReadinessScore), true);
});
