import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { connectRealtimeClient, publishRealtimeEvent, realtimeStats, REALTIME_EVENTS } from "../services/realtime.service.js";

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

test("SSE dispatch targets tenant buckets without leaking to unrelated clients", () => {
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
  assert.equal(admin.operationalEvents().length, 1);
  for (const client of clients.slice(2)) {
    assert.equal(client.operationalEvents().length, 0);
  }

  clients.forEach((client) => client.close());
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
