import { findRecordsByField, getRecord, queryRecords } from "../services/firestore.service.js";
import { logInfo } from "../services/logger.service.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";
import { queryDealershipLeads } from "../services/leadQuery.service.js";
import { cached } from "../services/ttlCache.service.js";
import { queryLeadProjectionForUser, queryNotificationProjectionForUser, querySalespersonSummaryProjection, syncSalespersonSummaryProjectionSoon } from "../services/projection.service.js";

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

function financeStatus(status) {
  const normalized = normalizeStatus(status);
  const map = {
    [LEAD_STATUSES.CONTACTED]: "Bank Processing",
    [LEAD_STATUSES.REQUEST_DOCUMENT]: "Pending Documents",
    [LEAD_STATUSES.DOCUMENT_RECEIVED]: "Pending Documents",
    [LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS]: "Pending Documents",
    [LEAD_STATUSES.ALL_DOCUMENTS_RECEIVED]: "Bank Processing",
    [LEAD_STATUSES.UNDER_BANK_PROCESS]: "Bank Processing",
    [LEAD_STATUSES.ASSIGNED]: "New",
    [LEAD_STATUSES.ACCEPTED]: "Bank Processing",
    [LEAD_STATUSES.UNDER_REVIEW]: "Bank Processing",
    [LEAD_STATUSES.DOCS_PENDING]: "Pending Documents",
    [LEAD_STATUSES.APPROVED]: "Bank Processing",
    [LEAD_STATUSES.REJECTED]: "Rejected With Reason",
    [LEAD_STATUSES.DISBURSED]: "Disbursed",
    [LEAD_STATUSES.CLOSED]: "Disbursed",
  };
  return map[normalized] || "New";
}

function salespersonIdentitySet(person = {}, fallback = "") {
  return new Set([
    fallback,
    person.id,
    person.jobId,
    person.email,
    person.name,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
}

function leadMatchesSalesperson(lead = {}, identitySet = new Set()) {
  if (!identitySet.size) return true;
  return [
    lead.salespersonId,
    lead.salespersonName,
    lead.salespersonJobId,
    lead.salespersonEmail,
    lead.assignedSalesperson,
  ].some((value) => identitySet.has(String(value || "").trim().toLowerCase()));
}

async function salespersonForDealership(dealershipEmail, salespersonId) {
  const id = String(salespersonId || "").trim();
  if (!id) return null;
  const direct = await getRecord("salespersons", id).catch(() => null);
  if (direct?.dealershipId === dealershipEmail) return direct;
  const people = await cached(`gm:salespersons:staff:${dealershipEmail}`, 30000, () => findRecordsByField("salespersons", "dealershipId", dealershipEmail, 100));
  return people.find((person) => salespersonIdentitySet(person, id).has(id.toLowerCase())) || null;
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
      const fullPage = await queryLeadProjectionForUser({
        user: { ...req.user, role: "gm-sm", dealershipId: dealershipEmail },
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
    } else {
      page = await queryDealershipLeads({ dealershipId: dealershipEmail, query: req.query });
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
        user: { ...req.user, role: "gm-sm", dealershipId: dealershipEmail },
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
          rejectedCases: cases.filter((lead) => financeStatus(lead.status) === "Rejected With Reason").length,
          pendingCases: cases.filter((lead) => !["Disbursed", "Rejected With Reason"].includes(financeStatus(lead.status))).length,
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
    const lead = await getRecord("leads", req.params.id);
    const dealershipEmail = await dealershipEmailForGm(req);
    const allowed = lead && (lead.dealershipId === dealershipEmail || belongsToDealership(lead, dealershipEmail));
    if (!allowed) return res.status(404).json({ message: "Lead not found" });
    const { documents, bankDocuments } = await cached(`lead-detail:${lead.id}:gm-docs:v1`, 10000, async () => {
      const documentsPage = await queryRecords("documents", {
        where: [{ field: "leadId", value: lead.id }],
        orderBy: "createdAt",
        direction: "desc",
        limit: 50,
        maxLimit: 50,
      });
      const bankDocumentsPage = await queryRecords("bankDocuments", {
        where: [{ field: "leadId", value: lead.id }],
        orderBy: "createdAt",
        direction: "desc",
        limit: 50,
        maxLimit: 50,
      }).catch(() => ({ data: [] }));
      return { documents: documentsPage.data, bankDocuments: bankDocumentsPage.data || [] };
    });
    res.json({ ...lead, documents, bankDocuments });
  } catch (error) {
    next(error);
  }
}

export async function getGmNotifications(req, res, next) {
  try {
    const dealershipEmail = await dealershipEmailForGm(req);
    if (!dealershipEmail) return res.json([]);
    const projected = await queryNotificationProjectionForUser({
      user: { ...req.user, role: "gm-sm", dealershipId: dealershipEmail },
      query: { ...req.query, limit: req.query.limit || 30 },
    }).catch(() => null);
    if (projected?.data?.length) return res.json(projected.data);
    const leads = await cached(`gm:notifications:${dealershipEmail}`, 15000, () => gmLeads(req));
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
