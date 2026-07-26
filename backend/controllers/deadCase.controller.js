import { getRecord, queryRecords } from "../services/firestore.service.js";
import { getAuditLogs } from "../services/audit.service.js";
import { moveCaseNumberToDeadCase, moveLeadToDeadCase, restoreDeadCase, updateDeadCaseMetadata } from "../services/deadCase.service.js";
import { queryDeadCases } from "../services/leadQuery.service.js";
import { executiveIdentityValues, executiveNameValues } from "../services/roleIdentity.service.js";
import { assignedLeadsForPartner, currentPartner, dealershipIdentityFromLead } from "./bankShared.controller.js";

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

async function loanExecutiveActor(user = {}) {
  if (user?.role !== "loan-executive") return user;
  const email = user.email || user.uid;
  if (!email) return user;
  const executive = await getRecord("loanExecutives", email).catch(() => null);
  return executive ? { ...user, ...executive } : user;
}

export async function getFinanceDeadCases(req, res, next) {
  try {
    return res.json(await queryDeadCases({
      dealershipId: dealershipIdFromUser(req.user),
      salespersonId: String(req.query?.salespersonId || "").trim(),
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

export async function getGmDeadCases(req, res, next) {
  try {
    return res.json(await queryDeadCases({
      dealershipId: dealershipIdFromUser(req.user),
      salespersonId: String(req.query?.salespersonId || "").trim(),
      query: req.query,
    }));
  } catch (error) {
    return next(error);
  }
}

export async function getBankDeadCases(req, res, next) {
  try {
    const bankId = String(req.user?.bankId || req.user?.organizationId || "").trim();
    const actor = await loanExecutiveActor(req.user);
    const dealershipId = String(req.query?.dealershipId || "").trim().toLowerCase();
    if (dealershipId) {
      const partner = await currentPartner(req);
      const visibleLeads = partner ? await assignedLeadsForPartner(partner, { limit: 1000, includeDeadCases: "1" }) : [];
      const authorized = visibleLeads.some((lead) => dealershipIdentityFromLead(lead)?.dealershipId?.toLowerCase() === dealershipId);
      if (!authorized) return res.status(403).json({ message: "Dealership is outside your authorized bank scope", code: "DEALERSHIP_FORBIDDEN" });
    }
    return res.json(await queryDeadCases({
      bankId,
      executiveId: "",
      executiveIdentityValues: req.user?.role === "loan-executive" ? executiveIdentityValues(actor) : [],
      executiveNames: req.user?.role === "loan-executive" ? executiveNameValues(actor) : [],
      dealershipId,
      query: req.query,
    }));
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

export async function createFinanceDeadCase(req, res, next) {
  try {
    const updated = await moveCaseNumberToDeadCase({
      req,
      caseNumber: req.body?.caseNumber || req.body?.caseId,
      reason: req.body?.reason || req.body?.deadCaseReason,
      notes: req.body?.notes || req.body?.deadCaseNotes,
    });
    return res.status(201).json(updated);
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
