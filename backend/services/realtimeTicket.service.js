import crypto from "node:crypto";
import { logRealtimeTicketStep, measureRealtimeTicketSync } from "./realtimeTicketLatency.service.js";

const TICKET_TTL_MS = 60 * 1000;
const tickets = new Map();

function cleanTickets() {
  const now = Date.now();
  for (const [ticket, entry] of tickets.entries()) {
    if (!entry || entry.expiresAt <= now) tickets.delete(ticket);
  }
}

export function createRealtimeTicket(user = {}) {
  const startedAt = Date.now();
  cleanTickets();
  const ticket = measureRealtimeTicketSync("token_generation", () => crypto.randomUUID(), { summaryField: "tokenGenerationDurationMs" });
  tickets.set(ticket, {
    user,
    createdAt: Date.now(),
    expiresAt: Date.now() + TICKET_TTL_MS,
  });
  logRealtimeTicketStep("ticket_generation", Date.now() - startedAt, { summaryField: "ticketGenerationDurationMs" });
  return { ticket, expiresInMs: TICKET_TTL_MS };
}

export function consumeRealtimeTicket(ticket = "") {
  cleanTickets();
  const entry = tickets.get(ticket);
  tickets.delete(ticket);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.user || null;
}

export function pendingRealtimeTickets() {
  cleanTickets();
  return tickets.size;
}
