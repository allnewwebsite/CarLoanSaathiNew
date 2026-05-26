import { createRecord, getRecord, queryRecords } from "./firestore.service.js";

export const TIMELINE_EVENTS = {
  LEAD_CREATED: "lead-created",
  DOCUMENT_UPLOADED: "document-uploaded",
  DOCUMENT_REPLACED: "document-replaced",
  LEAD_SENT_TO_BANK: "lead-sent-to-bank",
  BRANCH_ASSIGNED: "branch-assigned",
  EXECUTIVE_ASSIGNED: "executive-assigned",
  SLA_STARTED: "sla-started",
  EXECUTIVE_ACCEPTED: "executive-accepted",
  PENDING_DOCUMENTS_REQUESTED: "pending-documents-requested",
  PENDING_DOCUMENTS_UPLOADED: "pending-documents-uploaded",
  LEAD_REASSIGNED: "lead-reassigned",
  APPROVAL: "approval",
  REJECTION: "rejection",
  REJECTION_REASON_ADDED: "rejection-reason-added",
  SANCTION_LETTER_UPLOADED: "sanction-letter-uploaded",
  DISBURSEMENT_MARKED: "disbursement-marked",
  CUSTOMER_FOLLOW_UP_ADDED: "customer-follow-up-added",
  INTERNAL_REMARKS_ADDED: "internal-remarks-added",
  SLA_MISSED: "sla-missed",
  ESCALATION_TRIGGERED: "escalation-triggered",
  STATUS_CHANGED: "status-changed",
};

function asList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function eventText(event) {
  return [
    event.leadId,
    event.caseId,
    event.title,
    event.description,
    event.actorName,
    event.actorRole,
    event.eventType,
    event.branchId,
    event.dealershipId,
    event.metadata?.customerName,
    event.metadata?.executiveName,
    event.metadata?.dealershipName,
    event.metadata?.bankName,
  ].filter(Boolean).join(" ").toLowerCase();
}

function dateWindow(filter) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  if (filter === "yesterday") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  }

  if (filter === "last7") {
    start.setDate(start.getDate() - 6);
  }

  return { start, end };
}

export async function addTimelineEvent({
  leadId,
  eventType,
  title,
  description,
  actor,
  actorId,
  actorName,
  actorRole,
  branchId,
  dealershipId,
  type = "system",
  meta = {},
  metadata = {},
  visibility,
}) {
  const lead = leadId ? await getRecord("leads", leadId) : null;
  return createRecord("leadTimeline", {
    leadId,
    caseId: lead?.caseId || metadata.caseId || meta.caseId || null,
    eventType: eventType || type,
    title,
    description,
    actorId: actorId || actor || "system",
    actorName: actorName || actor || "System",
    actorRole: actorRole || type || "system",
    branchId: branchId || metadata.branchId || meta.branchId || null,
    dealershipId: dealershipId || metadata.dealershipId || meta.dealershipId || null,
    metadata: { ...meta, ...metadata },
    visibility: visibility || ["finance-desk", "gm-sm", "bank-manager", "loan-executive", "super-admin"],
  });
}

export async function getTimelineForLead(leadId) {
  const result = await queryRecords("leadTimeline", {
    where: [{ field: "leadId", value: leadId }],
    orderBy: "createdAt",
    direction: "asc",
    limit: 100,
  });
  return result.data;
}

export async function getTimelineEvents({ leadId, query = {}, actor = {} } = {}) {
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 20), 1), 100);
  const search = String(query.search || "").trim().toLowerCase();
  const status = String(query.status || "").trim();
  const user = String(query.user || "").trim().toLowerCase();
  const eventType = String(query.eventType || "").trim();
  const dateFilter = String(query.date || "").trim();
  const role = actor.role || "";

  const where = [];
  if (leadId) where.push({ field: "leadId", value: leadId });
  if (eventType) where.push({ field: "eventType", value: eventType });
  const result = await queryRecords("leadTimeline", {
    where,
    orderBy: "createdAt",
    direction: "desc",
    limit: page * limit,
    search,
    searchFields: ["title", "description", "actorName", "actorId", "leadId", "caseId"],
  });
  let events = result.data;
  events = events.filter((event) => {
    const visibility = asList(event.visibility);
    const visible = role === "super-admin" || !visibility.length || visibility.includes(role);
    if (!visible) return false;
    if (leadId && event.leadId !== leadId) return false;
    if (eventType && event.eventType !== eventType) return false;
    if (status && event.metadata?.status !== status && event.metadata?.nextStatus !== status) return false;
    if (user && !String(event.actorName || event.actorId || "").toLowerCase().includes(user)) return false;
    if (search && !eventText(event).includes(search)) return false;
    if (dateFilter) {
      const created = new Date(event.createdAt);
      const { start, end } = dateWindow(dateFilter);
      if (created < start || created > end) return false;
    }
    return true;
  });

  events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const start = (page - 1) * limit;
  return {
    data: events.slice(start, start + limit),
    total: events.length,
    page,
    limit,
  };
}
