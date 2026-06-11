import { createRecord, getRecord, queryRecords } from "./firestore.service.js";
import { queryTimelineProjection, syncTimelineProjectionSoon } from "./projection.service.js";
import { cached } from "./ttlCache.service.js";

export const TIMELINE_EVENTS = {
  LEAD_CREATED: "lead-created",
  DOCUMENT_UPLOADED: "document-uploaded",
  DOCUMENT_REPLACED: "document-replaced",
  LEAD_SENT_TO_BANK: "lead-sent-to-bank",
  BRANCH_ASSIGNED: "branch-assigned",
  EXECUTIVE_ASSIGNED: "executive-assigned",
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
  ESCALATION_TRIGGERED: "escalation-triggered",
  STATUS_CHANGED: "status-changed",
};

function asList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function valuesMatch(values, targets) {
  const normalizedTargets = asList(targets).map(normalize).filter(Boolean);
  if (!normalizedTargets.length) return false;
  return asList(values).map(normalize).filter(Boolean).some((value) => normalizedTargets.includes(value));
}

function roleCanSeeEvent(event, role) {
  const visibility = asList(event.visibility).map(normalize).filter(Boolean);
  if (role === "super-admin") return true;
  return visibility.length > 0 && visibility.includes(normalize(role));
}

function leadDealershipValues(lead = {}) {
  return [lead.dealershipId, lead.dealershipEmail, lead.dealerEmail, lead.createdBy];
}

function eventDealershipValues(event = {}) {
  return [
    event.dealershipId,
    event.dealershipEmail,
    event.metadata?.dealershipId,
    event.metadata?.dealershipEmail,
    event.metadata?.dealerEmail,
  ];
}

function leadBankValues(lead = {}) {
  return [
    lead.bankId,
    lead.assignedBankId,
    lead.assignedPartnerId,
    lead.bankPartner,
    lead.assignedBankName,
    lead.preferredBank,
  ];
}

function eventBankValues(event = {}) {
  return [
    event.bankId,
    event.partnerId,
    event.metadata?.bankId,
    event.metadata?.assignedBankId,
    event.metadata?.assignedPartnerId,
    event.metadata?.bankPartner,
    event.metadata?.assignedBankName,
    event.metadata?.preferredBank,
  ];
}

function leadBranchValues(lead = {}) {
  return [
    lead.branchId,
    lead.bankBranchId,
    lead.selectedBankBranchId,
    lead.ifscCode,
    lead.bankIfsc,
    lead.assignedBankIfsc,
    lead.bankBranchCity,
    lead.branchCity,
    lead.routingCity,
  ];
}

function eventBranchValues(event = {}) {
  return [
    event.branchId,
    event.metadata?.branchId,
    event.metadata?.bankBranchId,
    event.metadata?.selectedBankBranchId,
    event.metadata?.ifscCode,
    event.metadata?.bankIfsc,
    event.metadata?.assignedBankIfsc,
    event.metadata?.bankBranchCity,
    event.metadata?.branchCity,
    event.metadata?.routingCity,
  ];
}

function leadExecutiveValues(lead = {}) {
  return [lead.assignedExecutiveId, lead.assignedExecutiveEmail, lead.assignedExecutiveMobile, lead.assignedExecutiveName];
}

function eventExecutiveValues(event = {}) {
  return [
    event.assignedExecutiveId,
    event.assignedExecutiveEmail,
    event.metadata?.assignedExecutiveId,
    event.metadata?.assignedExecutiveEmail,
    event.metadata?.assignedExecutiveMobile,
    event.metadata?.executiveName,
  ];
}

function actorBankValues(actor = {}) {
  return [actor.bankId, actor.partnerId, actor.uid, actor.email, actor.bankName, actor.companyName];
}

function actorBranchValues(actor = {}) {
  return [actor.branchId, actor.bankBranchId, actor.ifsc, actor.ifscCode, actor.bankIfsc, actor.branchCity, actor.city, actor.operatingCity];
}

function actorExecutiveValues(actor = {}) {
  return [actor.uid, actor.email, actor.mobile, actor.name, actor.fullName];
}

function canReadScopedTimeline({ event = {}, lead = null, actor = {} }) {
  const role = normalize(actor.role);
  const actorEmail = normalize(actor.email || actor.uid);
  const actorDealershipId = normalize(actor.dealershipId || actorEmail);

  if (role === "super-admin") return true;

  if (["finance-desk", "gm-sm"].includes(role)) {
    return valuesMatch(eventDealershipValues(event), [actorDealershipId, actorEmail])
      || valuesMatch(leadDealershipValues(lead), [actorDealershipId, actorEmail]);
  }

  if (role === "loan-executive") {
    return valuesMatch(eventExecutiveValues(event), actorExecutiveValues(actor))
      || valuesMatch(leadExecutiveValues(lead), actorExecutiveValues(actor));
  }

  if (role === "bank-manager") {
    const sameBank = valuesMatch(eventBankValues(event), actorBankValues(actor))
      || valuesMatch(leadBankValues(lead), actorBankValues(actor));
    if (!sameBank) return false;
    const branchTargets = actorBranchValues(actor).map(normalize).filter(Boolean);
    if (!branchTargets.length) return true;
    const scopedBranchValues = [...eventBranchValues(event), ...leadBranchValues(lead)].map(normalize).filter(Boolean);
    return !scopedBranchValues.length || scopedBranchValues.some((value) => branchTargets.includes(value));
  }

  return false;
}

export async function canReadTimelineLead(actor = {}, leadId) {
  if (normalize(actor.role) === "super-admin") return true;
  const projected = await queryTimelineProjection({ leadId, actor, query: { limit: 1 } }).catch(() => null);
  return Boolean(projected?.data?.length);
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

function legacyTimelineFallbackAllowed(query = {}) {
  return String(query.legacyFallback || query.includeLegacyFallback || "").toLowerCase() === "true"
    || String(process.env.ALLOW_TIMELINE_FALLBACK || "").toLowerCase() === "true";
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
  leadSnapshot = null,
  visibility,
}) {
  const metaPayload = { ...meta, ...metadata };
  delete metaPayload.leadSnapshot;
  const snapshot = leadSnapshot || metadata.leadSnapshot || meta.leadSnapshot || null;
  const hasScope = Boolean(
    snapshot
    || metaPayload.caseId
    || metaPayload.dealershipId
    || metaPayload.dealershipEmail
    || metaPayload.bankId
    || metaPayload.assignedExecutiveId
    || metaPayload.assignedExecutiveEmail
  );
  const lead = snapshot || null;
  const event = await createRecord("leadTimeline", {
    leadId,
    caseId: lead?.caseId || metaPayload.caseId || null,
    eventType: eventType || type,
    title,
    description,
    actorId: actorId || actor || "system",
    actorName: actorName || actor || "System",
    actorRole: actorRole || type || "system",
    branchId: branchId || metaPayload.branchId || null,
    dealershipId: dealershipId || metaPayload.dealershipId || lead?.dealershipId || lead?.dealershipEmail || null,
    dealershipEmail: lead?.dealershipEmail || lead?.dealerEmail || metaPayload.dealershipEmail || null,
    bankId: lead?.bankId || metaPayload.bankId || null,
    assignedExecutiveId: lead?.assignedExecutiveId || metaPayload.assignedExecutiveId || null,
    assignedExecutiveEmail: lead?.assignedExecutiveEmail || metaPayload.assignedExecutiveEmail || null,
    metadata: metaPayload,
    visibility: visibility || ["finance-desk", "gm-sm", "bank-manager", "loan-executive", "super-admin"],
  });
  syncTimelineProjectionSoon(event);
  return event;
}

export async function getTimelineForLead(leadId) {
  return cached(`timeline:lead:${leadId}:v1`, 10000, async () => {
  const result = await queryRecords("leadTimeline", {
    where: [{ field: "leadId", value: leadId }],
    orderBy: "createdAt",
    direction: "asc",
    limit: 100,
  });
  return result.data;
  });
}

export async function getTimelineEvents({ leadId, query = {}, actor = {} } = {}) {
  const projected = await queryTimelineProjection({ leadId, query, actor }).catch(() => null);
  if (projected?.data?.length) {
    return {
      data: projected.data,
      total: projected.data.length,
      page: Math.max(Number(query.page || 1), 1),
      limit: projected.limit || Math.min(Math.max(Number(query.limit || 20), 1), 100),
    };
  }
  if (!legacyTimelineFallbackAllowed(query)) {
    const limit = Math.min(Math.max(Number(query.limit || 20), 1), 100);
    return {
      data: [],
      total: 0,
      page: Math.max(Number(query.page || 1), 1),
      limit,
      projectionOnly: true,
    };
  }
  const page = Math.max(Number(query.page || 1), 1);
  const limit = Math.min(Math.max(Number(query.limit || 20), 1), 100);
  const search = String(query.search || "").trim().toLowerCase();
  const status = String(query.status || "").trim();
  const user = String(query.user || "").trim().toLowerCase();
  const eventType = String(query.eventType || "").trim();
  const dateFilter = String(query.date || "").trim();
  const role = actor.role || "";
  const lead = leadId ? await getRecord("leads", leadId).catch(() => null) : null;

  const where = [];
  if (leadId) where.push({ field: "leadId", value: leadId });
  if (eventType) where.push({ field: "eventType", value: eventType });
  const result = await queryRecords("leadTimeline", {
    where,
    orderBy: "createdAt",
    direction: "desc",
    limit: Math.min(Math.max(page * limit * 3, limit), 300),
    search,
    searchFields: ["title", "description", "actorName", "actorId", "leadId", "caseId"],
  });
  let events = result.data;
  events = events.map((event) => {
    if (!roleCanSeeEvent(event, role)) return null;
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
    if (canReadScopedTimeline({ event, lead, actor })) return event;
    return null;
  }).filter(Boolean);

  events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const start = (page - 1) * limit;
  return {
    data: events.slice(start, start + limit),
    total: events.length,
    page,
    limit,
  };
}
