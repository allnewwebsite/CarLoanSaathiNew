import { getRecord, queryRecords } from "../services/firestore.service.js";
import { queryArchivedLeads } from "../services/leadQuery.service.js";
import { getAuditLogs } from "../services/audit.service.js";

function dealershipIdFromUser(user = {}) {
  return String(user.dealershipId || user.email || user.uid || "").trim().toLowerCase();
}

function sameDealership(lead = {}, dealershipId = "") {
  const expected = String(dealershipId || "").trim().toLowerCase();
  return [
    lead.dealershipId,
    lead.dealershipEmail,
    lead.dealerEmail,
    lead.createdBy,
  ].some((value) => String(value || "").trim().toLowerCase() === expected);
}

async function archivedLeadDetail(id) {
  let lead = await getRecord("leads", id);
  if (!lead) {
    const page = await queryRecords("leads", {
      where: [{ field: "caseId", value: id }],
      limit: 1,
      maxLimit: 1,
      allowGlobal: true,
    });
    lead = page.data[0] || null;
  }
  if (!lead?.isArchived) return null;
  const audit = await getAuditLogs({ leadId: lead.id, limit: 50 }).catch(() => []);
  return { ...lead, audit };
}

export async function getFinanceArchivedLeads(req, res, next) {
  try {
    res.json(await queryArchivedLeads({
      dealershipId: dealershipIdFromUser(req.user),
      query: req.query,
    }));
  } catch (error) {
    next(error);
  }
}

export async function getFinanceArchivedLead(req, res, next) {
  try {
    const lead = await archivedLeadDetail(req.params.id);
    if (!lead || !sameDealership(lead, dealershipIdFromUser(req.user))) {
      return res.status(404).json({ message: "Archived case not found" });
    }
    return res.json(lead);
  } catch (error) {
    return next(error);
  }
}

export async function getAdminArchivedLeads(req, res, next) {
  try {
    res.json(await queryArchivedLeads({ query: req.query }));
  } catch (error) {
    next(error);
  }
}

export async function getAdminArchivedLead(req, res, next) {
  try {
    const lead = await archivedLeadDetail(req.params.id);
    if (!lead) return res.status(404).json({ message: "Archived case not found" });
    return res.json(lead);
  } catch (error) {
    return next(error);
  }
}
