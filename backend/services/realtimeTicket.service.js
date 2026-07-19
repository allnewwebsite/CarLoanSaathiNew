import crypto from "node:crypto";
import IORedis from "ioredis";
import { logWarn } from "./logger.service.js";
import { logRealtimeTicketStep, measureRealtimeTicketSync } from "./realtimeTicketLatency.service.js";

const TICKET_TTL_MS = 60 * 1000;
const TICKET_KEY_PREFIX = "cls:realtime:ticket:v1:";
const tickets = new Map();
let redisClient = null;

function redisEnabled() {
  return process.env.ENABLE_REALTIME_REDIS === "true" && Boolean(process.env.REDIS_URL);
}

function realtimeTicketRedis() {
  if (!redisEnabled()) return null;
  if (redisClient) return redisClient;
  redisClient = new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    lazyConnect: true,
    connectTimeout: 2_000,
  });
  redisClient.on("error", (error) => {
    logWarn("Realtime ticket Redis unavailable; using instance-local tickets", { error: error.message });
  });
  return redisClient;
}

function cleanTickets() {
  const now = Date.now();
  for (const [ticket, entry] of tickets.entries()) {
    if (!entry || entry.expiresAt <= now) tickets.delete(ticket);
  }
}

export async function createRealtimeTicket(user = {}) {
  const startedAt = Date.now();
  cleanTickets();
  const ticket = measureRealtimeTicketSync("token_generation", () => crypto.randomUUID(), { summaryField: "tokenGenerationDurationMs" });
  const entry = {
    user,
    createdAt: Date.now(),
    expiresAt: Date.now() + TICKET_TTL_MS,
  };
  const redis = realtimeTicketRedis();
  if (redis) {
    try {
      await redis.set(`${TICKET_KEY_PREFIX}${ticket}`, JSON.stringify(entry), "PX", TICKET_TTL_MS, "NX");
    } catch (error) {
      tickets.set(ticket, entry);
      logWarn("Realtime ticket could not be shared through Redis; using instance-local fallback", { error: error.message });
    }
  } else {
    tickets.set(ticket, entry);
  }
  logRealtimeTicketStep("ticket_generation", Date.now() - startedAt, { summaryField: "ticketGenerationDurationMs" });
  return { ticket, expiresInMs: TICKET_TTL_MS };
}

export async function consumeRealtimeTicket(ticket = "") {
  cleanTickets();
  const normalizedTicket = String(ticket || "").trim();
  if (!normalizedTicket) return null;
  let entry = null;
  const redis = realtimeTicketRedis();
  if (redis) {
    try {
      const raw = await redis.call("GETDEL", `${TICKET_KEY_PREFIX}${normalizedTicket}`);
      entry = raw ? JSON.parse(raw) : null;
    } catch (error) {
      logWarn("Realtime ticket Redis consume failed; checking instance-local fallback", { error: error.message });
    }
  }
  if (!entry) entry = tickets.get(normalizedTicket);
  tickets.delete(normalizedTicket);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.user || null;
}

export function pendingRealtimeTickets() {
  cleanTickets();
  return tickets.size;
}
