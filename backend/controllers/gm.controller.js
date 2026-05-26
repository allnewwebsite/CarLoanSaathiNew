import { getRecord, listRecords } from "../services/firestore.service.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";
import { queryDealershipLeads } from "../services/leadQuery.service.js";

function userEmail(req) {
  return req.user?.email || req.user?.uid;
}

async function dealershipEmailForGm(req) {
  const email = userEmail(req);
  if (!email) return null;
  const managers = await listRecords("dealershipManagers");
  const manager = managers.find((item) => item.email === email || item.id === email);
  if (manager?.dealershipEmail) return manager.dealershipEmail;
  const dealership = await getRecord("dealerships", email) || await getRecord("dealers", email);
  return dealership ? email : null;
}

function belongsToDealership(lead, dealershipEmail) {
  return lead.dealerEmail === dealershipEmail || lead.dealershipEmail === dealershipEmail || lead.createdBy === dealershipEmail;
}

function financeStatus(status) {
  const normalized = normalizeStatus(status);
  const map = {
    [LEAD_STATUSES.ASSIGNED]: "Bank Processing",
    [LEAD_STATUSES.ACCEPTED]: "Bank Processing",
    [LEAD_STATUSES.UNDER_REVIEW]: "Bank Processing",
    [LEAD_STATUSES.DOCS_PENDING]: "Pending Documents",
    [LEAD_STATUSES.APPROVED]: "Bank Processing",
    [LEAD_STATUSES.REJECTED]: "Rejected With Reason",
    [LEAD_STATUSES.DISBURSED]: "Disbursed",
    [LEAD_STATUSES.CLOSED]: "Disbursed",
  };
  return map[normalized] || "Bank Processing";
}

async function gmLeads(req) {
  const dealershipEmail = await dealershipEmailForGm(req);
  if (!dealershipEmail) return [];
  const result = await queryDealershipLeads({ dealershipId: dealershipEmail, query: { limit: 100 } });
  return result.data;
}

export async function getGmLeads(req, res, next) {
  try {
    const dealershipEmail = await dealershipEmailForGm(req);
    if (!dealershipEmail) return res.json({ data: [], limit: 20, nextCursor: null, hasMore: false });
    res.json(await queryDealershipLeads({ dealershipId: dealershipEmail, query: req.query }));
  } catch (error) {
    next(error);
  }
}

export async function getGmSalespersons(req, res, next) {
  try {
    const dealershipEmail = await dealershipEmailForGm(req);
    if (!dealershipEmail) return res.json([]);
    const leads = await gmLeads(req);
    const salespersons = (await listRecords("salespersons"))
      .filter((person) => person.dealershipId === dealershipEmail && person.active !== false)
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
    const lead = (await gmLeads(req)).find((item) => item.id === req.params.id);
    if (!lead) return res.status(404).json({ message: "Lead not found" });
    const documents = (await listRecords("documents")).filter((document) => document.leadId === lead.id);
    res.json({ ...lead, documents });
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
