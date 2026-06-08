import crypto from "node:crypto";
import IORedis from "ioredis";
import { logWarn } from "./logger.service.js";

const TICKET_TTL_MS = 60 * 1000;
const EVENT_BUFFER_LIMIT = 500;
const REALTIME_REDIS_CHANNEL = "cls:realtime:events:v1";
const tickets = new Map();
const clients = new Map();
const eventBuffer = [];
const instanceId = crypto.randomUUID();
let redisPublisher = null;
let redisSubscriber = null;
let redisReady = false;

export const REALTIME_EVENTS = {
  LEAD_CREATED: "LEAD_CREATED",
  LEAD_STATUS_CHANGED: "LEAD_STATUS_CHANGED",
  LEAD_ACCEPTED: "LEAD_ACCEPTED",
  LEAD_REJECTED: "LEAD_REJECTED",
  EXECUTIVE_ASSIGNED: "EXECUTIVE_ASSIGNED",
  EXECUTIVE_REASSIGNED: "EXECUTIVE_REASSIGNED",
  DOCUMENT_UPLOADED: "DOCUMENT_UPLOADED",
  DOCUMENT_REQUESTED: "DOCUMENT_REQUESTED",
  LEAD_APPROVED: "LEAD_APPROVED",
  LEAD_DISBURSED: "LEAD_DISBURSED",
  NOTIFICATION_CREATED: "NOTIFICATION_CREATED",
  FINANCE_MANAGER_CHANGED: "FINANCE_MANAGER_CHANGED",
  SALESPERSON_CHANGED: "SALESPERSON_CHANGED",
};

function cleanTickets() {
  const now = Date.now();
  for (const [ticket, entry] of tickets.entries()) {
    if (!entry || entry.expiresAt <= now) tickets.delete(ticket);
  }
}

function redisEnabled() {
  return Boolean(process.env.REDIS_URL);
}

function initRedisPubSub() {
  if (!redisEnabled() || redisReady) return;
  redisReady = true;
  try {
    redisPublisher = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    redisSubscriber = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    redisSubscriber.subscribe(REALTIME_REDIS_CHANNEL).catch((error) => {
      logWarn("Realtime Redis subscribe failed; using local SSE only", { error: error.message });
    });
    redisSubscriber.on("message", (_channel, raw) => {
      try {
        const event = JSON.parse(raw);
        if (!event || event.originInstanceId === instanceId) return;
        dispatchLocalEvent(event);
      } catch {
        // Ignore malformed pub/sub payloads.
      }
    });
  } catch (error) {
    logWarn("Realtime Redis unavailable; using local SSE only", { error: error.message });
    redisPublisher = null;
    redisSubscriber = null;
  }
}

function scope(value) {
  return String(value || "").trim();
}

function unique(values = []) {
  return [...new Set(values.map(scope).filter(Boolean))];
}

function leadRealtimeScopes(lead = {}) {
  const dealershipIds = unique([lead.dealershipId, lead.dealershipEmail, lead.dealerEmail, lead.createdBy]);
  const bankIds = unique([lead.bankId, lead.assignedBankId, lead.assignedPartnerId, lead.bankPartner, lead.assignedBankName]);
  const executiveIds = unique([lead.assignedExecutiveId, lead.assignedExecutiveEmail, lead.updatedByExecutiveId]);
  return { dealershipIds, bankIds, executiveIds };
}

function notificationRealtimeScopes(notification = {}) {
  return {
    dealershipIds: unique([notification.dealershipId, notification.dealerEmail, notification.meta?.dealershipId, notification.meta?.dealershipEmail]),
    bankIds: unique([notification.bankId, notification.partnerId, notification.meta?.bankId, notification.meta?.assignedBankId]),
    executiveIds: unique([notification.assignedExecutiveId, notification.recipientId, notification.meta?.assignedExecutiveId, notification.meta?.assignedExecutiveEmail]),
    recipientIds: unique([notification.recipientId, notification.userId, notification.partnerId, notification.dealerEmail]),
  };
}

function buildLeadSummary(lead = {}) {
  if (!lead?.id) return null;
  return {
    id: lead.id,
    leadId: lead.id,
    caseId: lead.caseId || "",
    status: lead.status || "",
    dealershipId: lead.dealershipId || lead.dealershipEmail || lead.dealerEmail || "",
    dealershipEmail: lead.dealershipEmail || lead.dealerEmail || "",
    bankId: lead.bankId || lead.assignedBankId || lead.assignedPartnerId || "",
    assignedBankName: lead.assignedBankName || lead.bankName || "",
    assignedExecutiveId: lead.assignedExecutiveId || "",
    assignedExecutiveEmail: lead.assignedExecutiveEmail || "",
    financeManagerId: lead.financeManagerId || "",
    salespersonId: lead.salespersonId || "",
    updatedAt: lead.statusUpdatedAt || lead.updatedAt || new Date().toISOString(),
  };
}

function eventKind(eventType = "") {
  if (eventType.includes("DOCUMENT")) return "document";
  if (eventType.includes("NOTIFICATION")) return "notification";
  if (eventType.includes("SALESPERSON") || eventType.includes("FINANCE_MANAGER")) return "staff";
  return "lead";
}

function affectedPortalsForScopes({ dealershipIds = [], bankIds = [], executiveIds = [], recipientIds = [] } = {}) {
  const portals = ["admin"];
  if (dealershipIds.length) portals.push("finance", "gm");
  if (bankIds.length) portals.push("bank-manager");
  if (executiveIds.length || recipientIds.length) portals.push("loan-executive");
  return [...new Set(portals)];
}

export function createRealtimeTicket(user = {}) {
  cleanTickets();
  const ticket = crypto.randomUUID();
  tickets.set(ticket, {
    user,
    createdAt: Date.now(),
    expiresAt: Date.now() + TICKET_TTL_MS,
  });
  return { ticket, expiresInMs: TICKET_TTL_MS };
}

export function consumeRealtimeTicket(ticket = "") {
  cleanTickets();
  const entry = tickets.get(ticket);
  tickets.delete(ticket);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.user || null;
}

function canReceiveEvent(user = {}, event = {}) {
  if (!user?.role) return false;
  if (user.role === "super-admin") return true;
  const scopes = event.scopes || {};
  const userEmail = scope(user.email || user.uid);
  if (["finance-desk", "gm-sm"].includes(user.role)) {
    const dealershipId = scope(user.dealershipId || user.email || user.uid);
    return dealershipId && scopes.dealershipIds?.includes(dealershipId);
  }
  if (user.role === "bank-manager") {
    const bankIds = unique([user.bankId, user.bankName, user.email, user.uid]);
    return bankIds.some((id) => scopes.bankIds?.includes(id));
  }
  if (user.role === "loan-executive") {
    const executiveIds = unique([user.uid, user.email]);
    return executiveIds.some((id) => scopes.executiveIds?.includes(id) || scopes.recipientIds?.includes(id)) || scopes.recipientIds?.includes(userEmail);
  }
  return false;
}

function writeSse(res, event) {
  res.write(`id: ${event.id}\n`);
  res.write(`event: operational\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function connectRealtimeClient({ user, req, res }) {
  initRedisPubSub();
  const clientId = crypto.randomUUID();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`event: connected\ndata: ${JSON.stringify({ clientId, timestamp: new Date().toISOString() })}\n\n`);
  const client = { id: clientId, user, res };
  clients.set(clientId, client);

  const lastEventId = Number(req.headers["last-event-id"] || req.query.lastEventId || 0);
  if (Number.isFinite(lastEventId) && lastEventId > 0) {
    eventBuffer
      .filter((event) => event.id > lastEventId && canReceiveEvent(user, event))
      .forEach((event) => writeSse(res, event));
  }

  req.on("close", () => {
    clients.delete(clientId);
  });
}

function dispatchLocalEvent(event) {
  eventBuffer.push(event);
  if (eventBuffer.length > EVENT_BUFFER_LIMIT) eventBuffer.splice(0, eventBuffer.length - EVENT_BUFFER_LIMIT);

  for (const client of clients.values()) {
    if (!canReceiveEvent(client.user, event)) continue;
    try {
      writeSse(client.res, event);
    } catch {
      clients.delete(client.id);
    }
  }
}

export function publishRealtimeEvent({ eventType, lead = null, notification = null, document = null, actor = null, data = {} } = {}) {
  initRedisPubSub();
  const now = new Date().toISOString();
  const leadSummary = buildLeadSummary(lead || data.lead || {});
  const leadScopes = leadSummary ? leadRealtimeScopes({ ...lead, ...leadSummary }) : { dealershipIds: [], bankIds: [], executiveIds: [] };
  const notificationScopes = notification ? notificationRealtimeScopes(notification) : { dealershipIds: [], bankIds: [], executiveIds: [], recipientIds: [] };
  const scopes = {
    dealershipIds: unique([...(leadScopes.dealershipIds || []), ...(notificationScopes.dealershipIds || []), data.dealershipId]),
    bankIds: unique([...(leadScopes.bankIds || []), ...(notificationScopes.bankIds || []), data.bankId]),
    executiveIds: unique([...(leadScopes.executiveIds || []), ...(notificationScopes.executiveIds || []), data.executiveId]),
    recipientIds: unique([...(notificationScopes.recipientIds || []), data.recipientId]),
  };
  const event = {
    id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
    eventType,
    kind: eventKind(eventType),
    leadId: leadSummary?.leadId || data.leadId || notification?.leadId || document?.leadId || "",
    caseId: leadSummary?.caseId || data.caseId || notification?.caseId || document?.caseId || "",
    status: leadSummary?.status || data.status || notification?.leadSnapshot?.status || "",
    dealershipId: scopes.dealershipIds[0] || "",
    bankId: scopes.bankIds[0] || "",
    executiveId: scopes.executiveIds[0] || "",
    financeManagerId: leadSummary?.financeManagerId || data.financeManagerId || "",
    salespersonId: leadSummary?.salespersonId || data.salespersonId || "",
    timestamp: now,
    affectedPortals: affectedPortalsForScopes(scopes),
    scopes,
    actor: actor ? { id: actor.uid || actor.email || "", email: actor.email || "", role: actor.role || "" } : null,
    lead: leadSummary,
    notification: notification ? {
      id: notification.id,
      title: notification.title,
      message: notification.message,
      read: notification.read === true,
      priority: notification.priority || "normal",
      type: notification.type || notification.notificationType || "",
      leadId: notification.leadId || "",
      caseId: notification.caseId || "",
      createdAt: notification.createdAt || now,
    } : null,
    document: document ? {
      id: document.id,
      leadId: document.leadId || "",
      caseId: document.caseId || "",
      type: document.type || document.documentType || "",
      status: document.status || "",
      createdAt: document.createdAt || now,
    } : null,
    data,
    originInstanceId: instanceId,
  };

  dispatchLocalEvent(event);
  if (redisPublisher) {
    redisPublisher.publish(REALTIME_REDIS_CHANNEL, JSON.stringify(event)).catch((error) => {
      logWarn("Realtime Redis publish failed; local clients were still notified", { eventType, error: error.message });
    });
  }
  return event;
}

export function realtimeStats() {
  cleanTickets();
  return { clients: clients.size, bufferedEvents: eventBuffer.length, pendingTickets: tickets.size, redisEnabled: redisEnabled() };
}
