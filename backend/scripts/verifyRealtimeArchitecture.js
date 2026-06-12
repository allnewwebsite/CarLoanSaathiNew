import { EventEmitter } from "node:events";
import { connectRealtimeClient, publishRealtimeEvent, REALTIME_EVENTS } from "../services/realtime.service.js";
import { LEAD_STATUSES } from "../utils/status.constants.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

const lead = {
  id: "lead-realtime-1",
  caseId: "CLS-RT-0001",
  status: LEAD_STATUSES.UNDER_BANK_PROCESS,
  dealershipId: "dealer-rt@example.com",
  dealershipEmail: "dealer-rt@example.com",
  dealerEmail: "dealer-rt@example.com",
  bankId: "BANK-RT-1",
  assignedBankId: "BANK-RT-1",
  assignedPartnerId: "BANK-RT-1",
  assignedExecutiveId: "exec-rt-1",
  assignedExecutiveEmail: "exec-rt@example.com",
  financeManagerId: "fm-rt-1",
  salespersonId: "sp-rt-1",
};

const clients = {
  finance: mockConnection({ role: "finance-desk", email: "finance@dealer-rt.example.com", dealershipId: "dealer-rt@example.com" }),
  gm: mockConnection({ role: "gm", email: "gm@dealer-rt.example.com", dealershipId: "dealer-rt@example.com" }),
  bank: mockConnection({ role: "bank-manager", email: "bank@example.com", bankId: "BANK-RT-1" }),
  executive: mockConnection({ role: "loan-executive", email: "exec-rt@example.com", uid: "exec-rt-1" }),
  admin: mockConnection({ role: "super-admin", email: "admin@example.com", uid: "admin@example.com" }),
  otherDealer: mockConnection({ role: "finance-desk", email: "other@example.com", dealershipId: "other-dealer@example.com" }),
};

publishRealtimeEvent({
  eventType: REALTIME_EVENTS.LEAD_STATUS_CHANGED,
  lead,
  actor: { role: "loan-executive", email: "exec-rt@example.com", uid: "exec-rt-1" },
  data: { status: LEAD_STATUSES.UNDER_BANK_PROCESS },
});

for (const key of ["finance", "gm", "bank", "executive", "admin"]) {
  const events = clients[key].operationalEvents();
  assert(events.length === 1, `${key} should receive one realtime event`);
  assert(events[0].leadId === lead.id, `${key} received wrong lead id`);
  assert(events[0].status === LEAD_STATUSES.UNDER_BANK_PROCESS, `${key} received wrong status`);
}

assert(clients.otherDealer.operationalEvents().length === 0, "unrelated dealership must not receive tenant event");

Object.values(clients).forEach((client) => client.close());

console.log("Realtime architecture verification passed.");
