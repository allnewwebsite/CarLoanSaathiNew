import { findRecordsByField, getRecord, queryRecords } from "../services/firestore.service.js";
import { logInfo } from "../services/logger.service.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";
import { queryDealershipLeads } from "../services/leadQuery.service.js";
import { cached } from "../services/ttlCache.service.js";
import { getLeadDetailProjection, queryLeadProjectionForUser, queryNotificationProjectionForUser, querySalespersonSummaryProjection, syncSalespersonSummaryProjectionSoon } from "../services/projection.service.js";
import { recordMonitoringSignal } from "../services/monitoringCenter.service.js";

function userEmail(req) {
  return req.user?.email || req.user?.uid;
}

async function dealershipEmailForGm(req) {
  if (req.user?.dealershipId) return req.user.dealershipId;
  const email = userEmail(req);
  if (!email) return null;
  return cached(`context:gm:${email}`, 15000, async () => {
  const manager = await getRecord("dealershipManagers", email);
  if (manager?.dealershipEmail) return manager.dealershipEmail;
  const dealership = await getRecord("dealerships", email) || await getRecord("dealers", email);
  return dealership ? email : null;
  });
}

function belongsToDealership(lead, dealershipEmail) {
  return lead.dealerEmail === dealershipEmail || lead.dealershipEmail === dealershipEmail || lead.createdBy === dealershipEmail;
}

function logProjectionRead(event, req, meta = {}) {
  recordMonitoringSignal(event, { endpoint: req.route?.path, path: req.originalUrl, ...meta });
  logInfo(event, {
    tag: event,
    requestId: req.requestId,
    path: req.originalUrl,
    endpoint: req.route?.path,
    ...meta,
  });
}

function leadDetailResponseFromProjection(projection = {}, extras = {}) {
  const {
    sourceCollection,
    sourceId,
    viewType,
    leadId,
    searchText,
    customerSummary,
    executiveSummary,
    statusSummary,
    documentCounts,
    timelineSummary,
    documents,
    bankDocuments,
    ...lead
  } = projection;
  return { ...lead, id: sourceId || leadId || projection.id, ...extras };
}

function financeStatus(status) {
  const normalized = normalizeStatus(status);
  const map = {
    [LEAD_STATUSES.CONTACTED]: "Contacted",
    [LEAD_STATUSES.REQUEST_DOCUMENT]: "Pending Documents",
    [LEAD_STATUSES.DOCUMENT_RECEIVED]: "Document Received",
    [LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS]: "Pending Documents",
    [LEAD_STATUSES.ALL_DOCUMENTS_RECEIVED]: "Document Received",
    [LEAD_STATUSES.UNDER_BANK_PROCESS]: "Under Bank Process",
    [LEAD_STATUSES.ASSIGNED]: "New",
    [LEAD_STATUSES.ACCEPTED]: "Under Bank Process",
    [LEAD_STATUSES.UNDER_REVIEW]: "Under Bank Process",
    [LEAD_STATUSES.DOCS_PENDING]: "Pending Documents",
    [LEAD_STATUSES.APPROVED]: "Under Bank Process",
    [LEAD_STATUSES.REJECTED]: "Rejected",
    [LEAD_STATUSES.DISBURSED]: "Disbursed",
    [LEAD_STATUSES.CLOSED]: "Disbursed",
  };
  return map[normalized] || "New";
}

function safeIdentity(value) {
  return String(value || "").trim().replace(/[^\w.@-]/g, "_").slice(0, 420).toLowerCase();
}

function salespersonIdentitySet(person = {}, fallback = "") {
  const values = [
    person.id,
    person.sourceId,
    person.salespersonId,
    person.jobId,
    person.email,
    person.mobile,
    person.name,
  ];
  if (fallback) values.push(fallback);
  return new Set(values.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
}

function leadMatchesSalesperson(lead = {}, identitySet = new Set()) {
  if (!identitySet.size) return true;
  return [
    lead.salespersonId,
    lead.salespersonName,
    lead.salespersonJobId,
    lead.salespersonEmail,
    lead.salespersonMobile,
    lead.assignedSalesperson,
  ].some((value) => identitySet.has(String(value || "").trim().toLowerCase()));
}

function salespersonMatchesRequested(person = {}, dealershipEmail = "", requestedId = "") {
  const requested = String(requestedId || "").trim().toLowerCase();
  if (!requested) return false;
  if (salespersonIdentitySet(person).has(requested)) return true;
  return [person.id, person.sourceId, person.salespersonId, person.jobId, person.email, person.mobile]
    .map((value) => safeIdentity(`salesperson_${dealershipEmail}_${value}`))
    .some((value) => value === safeIdentity(requestedId));
}

async function salespersonForDealership(dealershipEmail, salespersonId) {
  const id = String(salespersonId || "").trim();
  if (!id) return null;
  const direct = await getRecord("salespersons", id).catch(() => null);
  if (direct?.dealershipId === dealershipEmail) return direct;
  const people = await cached(`gm:salespersons:staff:${dealershipEmail}`, 30000, () => findRecordsByField("salespersons", "dealershipId", dealershipEmail, 100));
  return people.find((person) => salespersonMatchesRequested(person, dealershipEmail, id)) || null;
}

async function gmLeads(req) {
  const dealershipEmail = await dealershipEmailForGm(req);
  if (!dealershipEmail) return [];
  const result = await queryDealershipLeads({ dealershipId: dealershipEmail, query: { limit: 100 } });
  return result.data;
}

export async function getGmLeads(req, res, next) {
  const startedAt = Date.now();
  let authStarted, authEnded, queryStarted, queryEnded, serializeStarted, serializeEnded;
  try {
    authStarted = Date.now();
    const dealershipEmail = await dealershipEmailForGm(req);
    authEnded = Date.now();
    if (!dealershipEmail) {
      return res.json({ data: [], limit: 20, nextCursor: null, hasMore: false });
    }
    queryStarted = Date.now();
    let page;
    if (req.query.salespersonId) {
      const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 100);
      const requestedPage = Math.max(Number(req.query.page || 1), 1);
      const salesperson = await salespersonForDealership(dealershipEmail, req.query.salespersonId);
      const identitySet = salespersonIdentitySet(salesperson || {}, req.query.salespersonId);
      const { salespersonId: _salespersonId, page: _page, cursor: _cursor, limit: _limit, ...queryWithoutSalesperson } = req.query;
      const projectionPage = salesperson ? await queryLeadProjectionForUser({
        user: { ...req.user, role: "gm", dealershipId: dealershipEmail },
        query: { ...queryWithoutSalesperson, salespersonId: salesperson.id || salesperson.sourceId || salesperson.jobId || salesperson.email, limit, page: requestedPage },
      }).catch(() => null) : null;
      if (projectionPage?.data?.length) {
        page = projectionPage;
      } else {
        const fullPage = await queryLeadProjectionForUser({
        user: { ...req.user, role: "gm", dealershipId: dealershipEmail },
        query: { ...queryWithoutSalesperson, limit: 100 },
        }).catch(() => null) || await queryDealershipLeads({ dealershipId: dealershipEmail, query: { ...queryWithoutSalesperson, limit: 100 } });
        const matched = fullPage.data.filter((lead) => leadMatchesSalesperson(lead, identitySet));
        const start = (requestedPage - 1) * limit;
        const rows = matched.slice(start, start + limit);
        page = {
          data: rows,
          limit,
          total: matched.length,
          nextCursor: null,
          hasMore: start + rows.length < matched.length,
        };
      }
    } else {
      page = await queryLeadProjectionForUser({
        user: { ...req.user, role: "gm", dealershipId: dealershipEmail },
        query: req.query,
      }).catch(() => null) || await queryDealershipLeads({ dealershipId: dealershipEmail, query: req.query });
    }
    queryEnded = Date.now();
    serializeStarted = Date.now();
    const responseJson = JSON.stringify(page);
    serializeEnded = Date.now();
    logInfo("GM lead query completed", {
      requestId: req.requestId,
      path: req.originalUrl,
      role: req.user?.role,
      totalMs: Date.now() - startedAt,
      authMs: authEnded - authStarted,
      queryMs: queryEnded - queryStarted,
      serializeMs: serializeEnded - serializeStarted,
      warmup: String(req.headers["x-cls-warmup"] || "").toLowerCase() === "true",
      dataCount: Array.isArray(page?.data) ? page.data.length : undefined,
    });
    res.json(JSON.parse(responseJson));
  } catch (error) {
    next(error);
  }
}

export async function getGmSalespersons(req, res, next) {
  try {
    const dealershipEmail = await dealershipEmailForGm(req);
    if (!dealershipEmail) return res.json([]);
    const projected = await querySalespersonSummaryProjection({ dealershipId: dealershipEmail, query: req.query }).catch(() => null);
    if (projected?.length) return res.json(projected);
    const leads = await cached(`gm:salespersons:leads:${dealershipEmail}`, 15000, async () => {
      const leadsPage = await queryLeadProjectionForUser({
        user: { ...req.user, role: "gm", dealershipId: dealershipEmail },
        query: { limit: 100 },
      }).catch(() => null) || await queryDealershipLeads({ dealershipId: dealershipEmail, query: { limit: 100 } });
      return leadsPage.data;
    });
    const inactiveStatuses = new Set(["inactive", "removed", "deleted"]);
    const salespersons = (await cached(`gm:salespersons:staff:${dealershipEmail}`, 30000, () => findRecordsByField("salespersons", "dealershipId", dealershipEmail, 100)))
      .filter((person) => (
        person.active !== false
        && !inactiveStatuses.has(String(person.status || "").toLowerCase())
      ))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .map((person) => {
        const identities = salespersonIdentitySet(person);
        const cases = leads.filter((lead) => leadMatchesSalesperson(lead, identities));
        return {
          id: person.id,
          name: person.name,
          mobile: person.mobile,
          jobId: person.jobId,
          email: person.email,
          totalCases: cases.length,
          disbursedCases: cases.filter((lead) => financeStatus(lead.status) === "Disbursed").length,
          rejectedCases: cases.filter((lead) => normalizeStatus(lead.status) === LEAD_STATUSES.REJECTED).length,
          pendingCases: cases.filter((lead) => ![LEAD_STATUSES.DISBURSED, LEAD_STATUSES.CLOSED, LEAD_STATUSES.REJECTED].includes(normalizeStatus(lead.status))).length,
        };
      });
    salespersons.forEach((person) => syncSalespersonSummaryProjectionSoon({ ...person, dealershipId: dealershipEmail }, person));
    res.json(salespersons);
  } catch (error) {
    next(error);
  }
}

export async function getGmLead(req, res, next) {
  try {
    const dealershipEmail = await dealershipEmailForGm(req);
    const projection = await getLeadDetailProjection(req.params.id).catch(() => null);
    const projectionAllowed = projection && (projection.dealershipId === dealershipEmail || belongsToDealership(projection, dealershipEmail));
    if (projectionAllowed && Array.isArray(projection.documents) && Array.isArray(projection.bankDocuments)) {
      logProjectionRead("PROJECTION-HIT", req, { collection: "leadDetailsProjection", leadId: req.params.id });
      return res.json(leadDetailResponseFromProjection(projection, { documents: projection.documents || [], bankDocuments: projection.bankDocuments || [] }));
    }
    logProjectionRead("PROJECTION-MISS", req, {
      collection: "leadDetailsProjection",
      leadId: req.params.id,
      reason: projection ? "invalid_or_unauthorized_projection" : "missing_projection",
    });
    logProjectionRead("CANONICAL-FALLBACK", req, { collection: "leads", leadId: req.params.id });
    const lead = await getRecord("leads", req.params.id);
    const allowed = lead && (lead.dealershipId === dealershipEmail || belongsToDealership(lead, dealershipEmail));
    if (!allowed) return res.status(404).json({ message: "Lead not found" });
    const [documentsPage, bankDocumentsPage] = await Promise.all([
      queryRecords("documents", {
        where: [{ field: "leadId", value: lead.id }],
        orderBy: "createdAt",
        direction: "desc",
        limit: 50,
        maxLimit: 50,
      }).catch(() => ({ data: [] })),
      queryRecords("bankDocuments", {
        where: [{ field: "leadId", value: lead.id }],
        orderBy: "createdAt",
        direction: "desc",
        limit: 50,
        maxLimit: 50,
      }).catch(() => ({ data: [] })),
    ]);
    res.json({ ...lead, documents: documentsPage.data || [], bankDocuments: bankDocumentsPage.data || [] });
  } catch (error) {
    next(error);
  }
}

export async function getGmNotifications(req, res, next) {
  try {
    const dealershipEmail = await dealershipEmailForGm(req);
    if (!dealershipEmail) return res.json([]);
    const projected = await queryNotificationProjectionForUser({
      user: { ...req.user, role: "gm", dealershipId: dealershipEmail },
      query: { ...req.query, limit: req.query.limit || 30 },
    }).catch(() => null);
    if (projected) return res.json(projected.data || []);
    const leads = await cached(`gm:notifications:${dealershipEmail}`, 15000, async () => {
      const page = await queryLeadProjectionForUser({
        user: { ...req.user, role: "gm", dealershipId: dealershipEmail },
        query: { limit: 30 },
      }).catch(() => null);
      return page?.data || [];
    });
    const rows = leads
      .filter((lead) => ["Approved", "Rejected", "Disbursed", "Pending Documents"].includes(financeStatus(lead.status)))
      .slice(0, 30)
      .map((lead) => ({
        id: lead.id,
        caseId: lead.caseId,
        title: `${financeStatus(lead.status)} update`,
        message: `${lead.fullName || lead.customerName || "Customer"} is ${financeStatus(lead.status).toLowerCase()}`,
        status: financeStatus(lead.status),
        createdAt: lead.updatedAt || lead.createdAt,
      }));
    res.json(rows);
  } catch (error) {
    next(error);
  }
}
