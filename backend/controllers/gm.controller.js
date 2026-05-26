import { getRecord, listRecords } from "../services/firestore.service.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";

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
  return (await listRecords("leads")).filter((lead) => belongsToDealership(lead, dealershipEmail));
}

export async function getGmLeads(req, res, next) {
  try {
    let leads = await gmLeads(req);
    const page = Math.max(Number(req.query.page || 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
    const search = String(req.query.search || "").trim().toLowerCase();
    const salesperson = String(req.query.salesperson || "").trim().toLowerCase();
    const salespersonId = String(req.query.salespersonId || "").trim();
    const bank = String(req.query.bank || "").trim().toLowerCase();
    const status = String(req.query.status || "").trim();
    const date = String(req.query.date || "").trim();

    leads = leads.filter((lead) => {
      const text = [lead.caseId, lead.fullName, lead.customerName, lead.mobile, lead.assignedSalesperson, lead.preferredBank, lead.bankPartner, lead.selectedBrand, lead.selectedModel].filter(Boolean).join(" ").toLowerCase();
      const statusOk = !status || financeStatus(lead.status) === status || normalizeStatus(lead.status) === normalizeStatus(status);
      const salespersonOk = (!salesperson && !salespersonId)
        || String(lead.salespersonId || "") === salespersonId
        || String(lead.assignedSalesperson || lead.salespersonName || "").toLowerCase() === salesperson;
      const bankOk = !bank || String(lead.preferredBank || lead.bankPartner || "").toLowerCase() === bank;
      const dateOk = !date || String(lead.createdAt || lead.updatedAt || "").startsWith(date);
      const searchOk = !search || text.includes(search);
      return statusOk && salespersonOk && bankOk && dateOk && searchOk;
    });

    const start = (page - 1) * limit;
    res.json({ data: leads.slice(start, start + limit), total: leads.length, page, limit });
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
