import { getRecord, queryRecords } from "../services/firestore.service.js";
import { getAuditLogs } from "../services/audit.service.js";
import { moveLeadToDeadCase, restoreDeadCase, updateDeadCaseMetadata } from "../services/deadCase.service.js";
import { queryDeadCases } from "../services/leadQuery.service.js";

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

async function deadCaseDetail(id) {
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
  if (lead?.isDeadCase !== true) return null;
  const audit = await getAuditLogs({ leadId: lead.id, limit: 50 }).catch(() => []);
  return { ...lead, audit };
}

export async function getFinanceDeadCases(req, res, next) {
  try {
    return res.json(await queryDeadCases({
      dealershipId: dealershipIdFromUser(req.user),
      query: req.query,
    }));
  } catch (error) {
    return next(error);
  }
}

export async function getFinanceDeadCase(req, res, next) {
  try {
    const lead = await deadCaseDetail(req.params.id);
    if (!lead || !sameDealership(lead, dealershipIdFromUser(req.user))) {
      return res.status(404).json({ message: "Dead case not found" });
    }
    return res.json(lead);
  } catch (error) {
    return next(error);
  }
}

export async function getAdminDeadCases(req, res, next) {
  try {
    return res.json(await queryDeadCases({ query: req.query }));
  } catch (error) {
    return next(error);
  }
}

export async function getAdminDeadCase(req, res, next) {
  try {
    const lead = await deadCaseDetail(req.params.id);
    if (!lead) return res.status(404).json({ message: "Dead case not found" });
    return res.json(lead);
  } catch (error) {
    return next(error);
  }
}

export async function markFinanceLeadDead(req, res, next) {
  try {
    const updated = await moveLeadToDeadCase({
      req,
      leadId: req.params.id,
      reason: req.body?.reason || req.body?.deadCaseReason,
      notes: req.body?.notes || req.body?.deadCaseNotes,
    });
    return res.json(updated);
  } catch (error) {
    return next(error);
  }
}

export async function restoreFinanceDeadCase(req, res, next) {
  try {
    return res.json(await restoreDeadCase({ req, leadId: req.params.id }));
  } catch (error) {
    return next(error);
  }
}

export async function updateFinanceDeadCase(req, res, next) {
  try {
    return res.json(await updateDeadCaseMetadata({
      req,
      leadId: req.params.id,
      reason: req.body?.reason || req.body?.deadCaseReason,
      notes: req.body?.notes || req.body?.deadCaseNotes,
    }));
  } catch (error) {
    return next(error);
  }
}
