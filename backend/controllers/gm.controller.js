import { findRecordsByField, getRecord, queryRecords } from "../services/firestore.service.js";
import { logInfo } from "../services/logger.service.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";
import { queryDealershipLeads } from "../services/leadQuery.service.js";
import { cached } from "../services/ttlCache.service.js";

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
    const page = await queryDealershipLeads({ dealershipId: dealershipEmail, query: req.query });
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
    const leadsPage = await queryDealershipLeads({ dealershipId: dealershipEmail, query: { limit: 100 } });
    const leads = leadsPage.data;
    const inactiveStatuses = new Set(["inactive", "removed", "deleted"]);
    const salespersons = (await findRecordsByField("salespersons", "dealershipId", dealershipEmail, 100))
      .filter((person) => (
        person.active !== false
        && !inactiveStatuses.has(String(person.status || "").toLowerCase())
      ))
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .map((person) => {
        const cases = leads.filter((lead) => lead.salespersonId === person.id || String(lead.assignedSalesperson || lead.salespersonName || "").toLowerCase() === String(person.name || "").toLowerCase());
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
    const documents = documentsPage.data;
    res.json({ ...lead, documents, bankDocuments: bankDocumentsPage.data || [] });
  } catch (error) {
    next(error);
  }
}

export async function getGmNotifications(req, res, next) {
  try {
    const leads = await gmLeads(req);
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
