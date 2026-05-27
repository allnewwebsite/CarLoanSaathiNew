import { getRecord } from "../services/firestore.service.js";
import { getTimelineEvents } from "../services/timeline.service.js";

async function canReadLeadTimeline(req, leadId) {
  if (req.user?.role === "super-admin") return true;
  const lead = await getRecord("leads", leadId);
  if (!lead) return false;
  const email = req.user?.email || req.user?.uid;

  if (["finance-desk", "gm-sm"].includes(req.user?.role)) {
    return lead.dealerEmail === email || lead.dealershipEmail === email || lead.createdBy === email;
  }

  if (req.user?.role === "loan-executive") {
    return lead.assignedExecutiveId === email || lead.assignedExecutiveEmail === email;
  }

  if (req.user?.role === "bank-manager") {
    const manager = await getRecord("branchManagers", email);
    if (manager) {
      const managerCity = manager.branchCity || manager.city || manager.operatingCity;
      const leadCity = lead.bankBranchCity || lead.branchCity || lead.routingCity || lead.dealershipCity;
      return !managerCity || managerCity === leadCity;
    }
    return lead.assignedPartnerId === email || lead.bankPartner === email;
  }

  return false;
}

export async function getLeadTimeline(req, res, next) {
  try {
    const allowed = await canReadLeadTimeline(req, req.params.leadId);
    if (!allowed) return res.status(403).json({ message: "Timeline access denied" });
    res.json(await getTimelineEvents({ leadId: req.params.leadId, query: req.query, actor: req.user }));
  } catch (error) {
    next(error);
  }
}

export async function searchTimeline(req, res, next) {
  try {
    res.json(await getTimelineEvents({ query: req.query, actor: req.user }));
  } catch (error) {
    next(error);
  }
}
