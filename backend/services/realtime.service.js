import crypto from "node:crypto";
import IORedis from "ioredis";
import { logInfo, logWarn } from "./logger.service.js";
import { logRealtimeTicketStep, measureRealtimeTicketSync } from "./realtimeTicketLatency.service.js";
import { recordRealtimeMetric } from "./monitoringCenter.service.js";

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
let acknowledgedEvents = 0;
let lastAcknowledgedEventAt = null;

export const REALTIME_EVENTS = {
  LEAD_CREATED: "LEAD_CREATED",
  LEAD_STATUS_UPDATED: "LEAD_STATUS_UPDATED",
  LEAD_STATUS_CHANGED: "LEAD_STATUS_UPDATED",
  LEAD_REMARK_ADDED: "LEAD_REMARK_ADDED",
  LEAD_ACCEPTED: "LEAD_ACCEPTED",
  LEAD_REJECTED: "LEAD_REJECTED",
  EXECUTIVE_ASSIGNED: "EXECUTIVE_ASSIGNED",
  EXECUTIVE_REASSIGNED: "EXECUTIVE_REASSIGNED",
  DOCUMENT_UPLOADED: "DOCUMENT_UPLOADED",
  DOCUMENT_REQUESTED: "DOCUMENT_REQUESTED",
  LEAD_APPROVED: "LEAD_APPROVED",
  LEAD_DISBURSED: "LEAD_DISBURSED",
  BANK_CREATED: "BANK_CREATED",
  BANK_UPDATED: "BANK_UPDATED",
  BANK_DISABLED: "BANK_DISABLED",
  BANK_EXECUTIVE_DELETED: "BANK_EXECUTIVE_DELETED",
  BRANCH_CREATED: "BRANCH_CREATED",
  BRANCH_UPDATED: "BRANCH_UPDATED",
  BRANCH_DISABLED: "BRANCH_DISABLED",
  DEALER_CREATED: "DEALER_CREATED",
  DEALER_APPROVED: "DEALER_APPROVED",
  DEALER_UPDATED: "DEALER_UPDATED",
  DEALER_DISABLED: "DEALER_DISABLED",
  DEALER_LOCATION_UPDATED: "DEALER_LOCATION_UPDATED",
  DEALER_CAPACITY_UPDATED: "DEALER_CAPACITY_UPDATED",
  NOTIFICATION_CREATED: "NOTIFICATION_CREATED",
  FINANCE_MANAGER_CHANGED: "FINANCE_MANAGER_CHANGED",
  SALESPERSON_CHANGED: "SALESPERSON_CHANGED",
};

const PHASE_ONE_EVENTS = new Set([
  REALTIME_EVENTS.LEAD_CREATED,
  REALTIME_EVENTS.LEAD_STATUS_UPDATED,
  REALTIME_EVENTS.LEAD_REMARK_ADDED,
  REALTIME_EVENTS.DOCUMENT_UPLOADED,
]);

function cleanTickets() {
  const now = Date.now();
  for (const [ticket, entry] of tickets.entries()) {
    if (!entry || entry.expiresAt <= now) tickets.delete(ticket);
  }
}

function redisEnabled() {
  return process.env.ENABLE_REALTIME_REDIS === "true" && Boolean(process.env.REDIS_URL);
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
    redisPublisher.on("error", (error) => {
      logWarn("Realtime Redis publisher unavailable; local SSE remains active", { error: error.message });
    });
    redisSubscriber.on("error", (error) => {
      logWarn("Realtime Redis subscriber unavailable; local SSE remains active", { error: error.message });
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
  const branchIds = unique([
    lead.branchId,
    lead.bankBranchId,
    lead.branchIfsc,
    lead.assignedBankIfsc,
    lead.ifscCode,
    lead.bankIfsc,
    lead.bankBranchCity,
    lead.branchCity,
    lead.branchLocation,
    lead.bankBranchLocation,
  ]);
  return { dealershipIds, bankIds, executiveIds, branchIds };
}

function notificationRealtimeScopes(notification = {}) {
  return {
    dealershipIds: unique([notification.dealershipId, notification.dealerEmail, notification.meta?.dealershipId, notification.meta?.dealershipEmail]),
    bankIds: unique([notification.bankId, notification.partnerId, notification.meta?.bankId, notification.meta?.assignedBankId]),
    executiveIds: unique([notification.assignedExecutiveId, notification.recipientId, notification.meta?.assignedExecutiveId, notification.meta?.assignedExecutiveEmail]),
    recipientIds: unique([notification.recipientId, notification.userId, notification.partnerId, notification.dealerEmail]),
  };
}

function lightweightLeadPatch(lead = {}, data = {}) {
  if (!lead?.id) return null;
  return {
    leadId: lead.id,
    caseId: lead.caseId || "",
    fullName: lead.fullName || lead.customerName || "",
    customerName: lead.customerName || lead.fullName || "",
    mobile: lead.mobile || lead.customerMobile || "",
    city: lead.city || lead.customerCity || lead.dealershipCity || "",
    dealershipName: lead.dealershipName || lead.dealerName || "",
    dealerName: lead.dealerName || lead.dealershipName || "",
    dealerEmail: lead.dealerEmail || lead.dealershipEmail || "",
    dealershipCity: lead.dealershipCity || lead.city || "",
    carPrice: lead.carPrice || lead.carOnRoadPrice || lead.onRoadPrice || "",
    carOnRoadPrice: lead.carOnRoadPrice || lead.onRoadPrice || lead.carPrice || "",
    onRoadPrice: lead.onRoadPrice || lead.carOnRoadPrice || lead.carPrice || "",
    loanAmount: lead.loanAmount || lead.requiredLoanAmount || "",
    requiredLoanAmount: lead.requiredLoanAmount || lead.loanAmount || "",
    status: lead.status || "",
    dealershipId: lead.dealershipId || lead.dealershipEmail || lead.dealerEmail || "",
    dealershipEmail: lead.dealershipEmail || lead.dealerEmail || "",
    bankId: lead.bankId || lead.assignedBankId || lead.assignedPartnerId || "",
    assignedBankName: lead.assignedBankName || lead.bankName || "",
    bankName: lead.bankName || lead.assignedBankName || "",
    assignedBankIfsc: lead.assignedBankIfsc || lead.bankIfsc || lead.ifscCode || "",
    bankIfsc: lead.bankIfsc || lead.assignedBankIfsc || lead.ifscCode || "",
    ifscCode: lead.ifscCode || lead.assignedBankIfsc || lead.bankIfsc || "",
    branchId: lead.branchId || lead.bankBranchId || "",
    bankBranchId: lead.bankBranchId || lead.branchId || "",
    bankBranchCity: lead.bankBranchCity || lead.branchCity || "",
    branchCity: lead.branchCity || lead.bankBranchCity || "",
    assignedExecutiveId: lead.assignedExecutiveId || "",
    assignedExecutiveName: lead.assignedExecutiveName || lead.assignedExecutiveEmail || "",
    assignedExecutiveMobile: lead.assignedExecutiveMobile || lead.executiveMobile || "",
    executiveMobile: lead.executiveMobile || lead.assignedExecutiveMobile || "",
    financeManagerId: lead.financeManagerId || "",
    financeManagerName: lead.financeManagerName || lead.assignedFinanceManager || "",
    assignedFinanceManager: lead.assignedFinanceManager || lead.financeManagerName || "",
    financeManagerMobile: lead.financeManagerMobile || "",
    salespersonId: lead.salespersonId || "",
    salespersonName: lead.salespersonName || lead.assignedSalesperson || "",
    assignedSalesperson: lead.assignedSalesperson || lead.salespersonName || "",
    createdAt: lead.createdAt || data.timestamp || new Date().toISOString(),
    timestamp: data.timestamp || lead.statusUpdatedAt || lead.updatedAt || new Date().toISOString(),
  };
}

function eventKind(eventType = "") {
  if (eventType.includes("DOCUMENT")) return "document";
  if (eventType.includes("NOTIFICATION")) return "notification";
  if (eventType.includes("BANK") || eventType.includes("BRANCH")) return "bank";
  if (eventType.includes("DEALER")) return "dealer";
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

function canReceiveEvent(user = {}, event = {}) {
  if (!user?.role) return false;
  if (user.role === "super-admin") return true;
  if (event.kind === "bank" && event.publicCatalog === true && ["finance-desk", "gm-sm"].includes(user.role)) return true;
  if (event.kind === "dealer" && event.publicDealerCatalog === true && ["finance-desk", "gm-sm", "bank-manager", "loan-executive"].includes(user.role)) return true;
  const scopes = event.scopes || {};
  const userEmail = scope(user.email || user.uid);
  if (["finance-desk", "gm-sm"].includes(user.role)) {
    const dealershipId = scope(user.dealershipId || user.email || user.uid);
    return dealershipId && scopes.dealershipIds?.includes(dealershipId);
  }
  if (user.role === "bank-manager") {
    const bankIds = unique([user.bankId, user.bankName, user.email, user.uid]);
    const branchIds = unique([
      user.branchId,
      user.branchIfsc,
      user.bankIfsc,
      user.ifscCode,
      user.branchCity,
      user.branchLocation,
      user.bankBranchLocation,
    ]);
    const sameBank = bankIds.some((id) => scopes.bankIds?.includes(id));
    const sameBranch = scopes.branchIds?.length
      ? branchIds.some((id) => scopes.branchIds?.includes(id))
      : sameBank;
    return sameBank && sameBranch;
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
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
    } catch {
      clients.delete(clientId);
      clearInterval(heartbeat);
    }
  }, 25_000);
  heartbeat.unref?.();

  const client = { id: clientId, user, res, heartbeat };
  clients.set(clientId, client);
  recordRealtimeMetric({ eventType: "SSE_CONNECTED", activeClients: clients.size });

  const lastEventId = Number(req.headers["last-event-id"] || req.query.lastEventId || 0);
  if (Number.isFinite(lastEventId) && lastEventId > 0) {
    eventBuffer
      .filter((event) => event.id > lastEventId && canReceiveEvent(user, event))
      .forEach((event) => writeSse(res, event));
  }

  req.on("close", () => {
    clients.delete(clientId);
    clearInterval(heartbeat);
    recordRealtimeMetric({ eventType: "SSE_DISCONNECTED", activeClients: clients.size, disconnected: 1 });
  });
}

function dispatchLocalEvent(event) {
  const startedAt = Date.now();
  eventBuffer.push(event);
  if (eventBuffer.length > EVENT_BUFFER_LIMIT) eventBuffer.splice(0, eventBuffer.length - EVENT_BUFFER_LIMIT);

  let delivered = 0;
  let errors = 0;
  let ignored = 0;
  for (const client of clients.values()) {
    if (!canReceiveEvent(client.user, event)) {
      ignored += 1;
      continue;
    }
    try {
      writeSse(client.res, event);
      delivered += 1;
    } catch {
      errors += 1;
      if (client.heartbeat) clearInterval(client.heartbeat);
      clients.delete(client.id);
    }
  }
  recordRealtimeMetric({
    eventType: event.eventType,
    delivered,
    errors,
    activeClients: clients.size,
    durationMs: Date.now() - startedAt,
  });
  logInfo("SSE_EVENT_DELIVERED", {
    tag: "SSE_EVENT_DELIVERED",
    eventType: event.eventType,
    delivered,
    errors,
    activeClients: clients.size,
    eventId: event.id,
  });
  if (ignored) {
    logInfo("SSE_EVENT_IGNORED", {
      tag: "SSE_EVENT_IGNORED",
      eventType: event.eventType,
      ignored,
      eventId: event.id,
    });
  }
  if (errors) {
    logWarn("SSE_EVENT_FAILED", {
      tag: "SSE_EVENT_FAILED",
      eventType: event.eventType,
      errors,
      eventId: event.id,
    });
  }
}

export function publishRealtimeEvent({ eventType, lead = null, notification = null, document = null, actor = null, data = {} } = {}) {
  initRedisPubSub();
  const now = new Date().toISOString();
  const phaseOneEvent = PHASE_ONE_EVENTS.has(eventType);
  const leadSummary = lightweightLeadPatch(lead || data.lead || {}, { ...data, timestamp: now });
  const leadScopes = leadSummary ? leadRealtimeScopes({ ...lead, ...leadSummary }) : { dealershipIds: [], bankIds: [], executiveIds: [], branchIds: [] };
  const notificationScopes = notification ? notificationRealtimeScopes(notification) : { dealershipIds: [], bankIds: [], executiveIds: [], recipientIds: [] };
  const kind = eventKind(eventType);
  const scopes = {
    dealershipIds: unique([...(leadScopes.dealershipIds || []), ...(notificationScopes.dealershipIds || []), data.dealershipId]),
    bankIds: unique([...(leadScopes.bankIds || []), ...(notificationScopes.bankIds || []), data.bankId]),
    executiveIds: unique([...(leadScopes.executiveIds || []), ...(notificationScopes.executiveIds || []), data.executiveId]),
    recipientIds: unique([...(notificationScopes.recipientIds || []), data.recipientId]),
    branchIds: unique([...(leadScopes.branchIds || []), data.branchId, data.branchIfsc, data.bankIfsc, data.ifscCode, data.branchLocation]),
  };
  const event = {
    id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
    event: eventType,
    eventType,
    kind,
    leadId: leadSummary?.leadId || data.leadId || notification?.leadId || document?.leadId || "",
    caseId: leadSummary?.caseId || data.caseId || notification?.caseId || document?.caseId || "",
    status: leadSummary?.status || data.status || notification?.leadSnapshot?.status || "",
    dealershipId: scopes.dealershipIds[0] || "",
    bankId: scopes.bankIds[0] || "",
    executiveId: scopes.executiveIds[0] || "",
    financeManagerId: leadSummary?.financeManagerId || data.financeManagerId || "",
    salespersonId: leadSummary?.salespersonId || data.salespersonId || "",
    fullName: leadSummary?.fullName || "",
    customerName: leadSummary?.customerName || "",
    mobile: leadSummary?.mobile || "",
    city: leadSummary?.city || "",
    dealershipName: leadSummary?.dealershipName || "",
    dealerName: leadSummary?.dealerName || "",
    dealerEmail: leadSummary?.dealerEmail || "",
    dealershipEmail: leadSummary?.dealershipEmail || "",
    dealershipCity: leadSummary?.dealershipCity || "",
    carPrice: leadSummary?.carPrice || "",
    carOnRoadPrice: leadSummary?.carOnRoadPrice || "",
    onRoadPrice: leadSummary?.onRoadPrice || "",
    loanAmount: leadSummary?.loanAmount || "",
    requiredLoanAmount: leadSummary?.requiredLoanAmount || "",
    assignedBankName: leadSummary?.assignedBankName || "",
    bankName: leadSummary?.bankName || "",
    assignedBankIfsc: leadSummary?.assignedBankIfsc || "",
    bankIfsc: leadSummary?.bankIfsc || "",
    ifscCode: leadSummary?.ifscCode || "",
    bankBranchId: leadSummary?.bankBranchId || "",
    bankBranchCity: leadSummary?.bankBranchCity || "",
    branchCity: leadSummary?.branchCity || "",
    assignedExecutiveId: leadSummary?.assignedExecutiveId || "",
    assignedExecutiveName: leadSummary?.assignedExecutiveName || "",
    assignedExecutiveMobile: leadSummary?.assignedExecutiveMobile || "",
    executiveMobile: leadSummary?.executiveMobile || "",
    financeManagerName: leadSummary?.financeManagerName || "",
    assignedFinanceManager: leadSummary?.assignedFinanceManager || "",
    financeManagerMobile: leadSummary?.financeManagerMobile || "",
    salespersonName: leadSummary?.salespersonName || "",
    assignedSalesperson: leadSummary?.assignedSalesperson || "",
    createdAt: leadSummary?.createdAt || now,
    timestamp: now,
    affectedPortals: kind === "dealer" && data.publicDealerCatalog === true
      ? ["admin", "finance", "gm", "bank-manager", "loan-executive"]
      : affectedPortalsForScopes(scopes),
    scopes,
    actor: actor ? { id: actor.uid || actor.email || "", email: actor.email || "", role: actor.role || "" } : null,
    tenantId: scopes.dealershipIds[0] || scopes.bankIds[0] || "platform",
    branchId: scopes.branchIds?.[0] || "",
    previousStatus: data.previousStatus || "",
    bankEvent: data.bankEvent || null,
    publicCatalog: Boolean(data.publicCatalog),
    dealerEvent: data.dealerEvent || null,
    publicDealerCatalog: Boolean(data.publicDealerCatalog),
    documentId: document?.id || data.documentId || "",
    documentType: document?.type || document?.documentType || data.documentType || "",
    remarkType: data.remarkType || "",
    data: {
      status: data.status || leadSummary?.status || "",
      previousStatus: data.previousStatus || "",
      documentStatus: data.documentStatus || "",
      remarkType: data.remarkType || "",
    },
    ...(!phaseOneEvent ? {
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
    } : {}),
    originInstanceId: instanceId,
  };

  logInfo("SSE_EVENT_PUBLISHED", {
    tag: "SSE_EVENT_PUBLISHED",
    eventType,
    leadId: event.leadId,
    dealershipId: event.dealershipId,
    bankId: event.bankId,
    branchId: event.branchId,
    affectedPortals: event.affectedPortals,
  });
  dispatchLocalEvent(event);
  if (redisPublisher) {
    redisPublisher.publish(REALTIME_REDIS_CHANNEL, JSON.stringify(event)).catch((error) => {
      logWarn("SSE_EVENT_FAILED", {
        tag: "SSE_EVENT_FAILED",
        eventType,
        phase: "redis_publish",
        error: error.message,
      });
      logWarn("Realtime Redis publish failed; local clients were still notified", { eventType, error: error.message });
    });
  }
  return event;
}

export function acknowledgeRealtimeEvents({ user = {}, eventIds = [], lastEventId = "" } = {}) {
  const ids = Array.isArray(eventIds) ? eventIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
  acknowledgedEvents += ids.length;
  lastAcknowledgedEventAt = ids.length ? new Date().toISOString() : lastAcknowledgedEventAt;
  recordRealtimeMetric({
    eventType: "SSE_EVENT_ACKED",
    delivered: ids.length,
    activeClients: clients.size,
  });
  logInfo("SSE_EVENT_ACKED", {
    tag: "SSE_EVENT_ACKED",
    count: ids.length,
    lastEventId: String(lastEventId || ""),
    userId: user.uid || user.email || "",
    role: user.role || "",
  });
  return { acknowledged: ids.length, lastEventId: String(lastEventId || "") };
}

export function realtimeStats() {
  cleanTickets();
  return { clients: clients.size, bufferedEvents: eventBuffer.length, pendingTickets: tickets.size, redisEnabled: redisEnabled(), acknowledgedEvents, lastAcknowledgedEventAt };
}
