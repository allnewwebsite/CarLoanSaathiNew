import { scopedAnalytics } from "../services/analytics.service.js";

export async function getOverview(req, res, next) {
  try {
    const metrics = await scopedAnalytics({
      dealershipId: ["finance-desk", "gm-sm"].includes(req.user?.role) ? req.user.dealershipId : null,
      bankId: req.user?.role === "bank-manager" ? req.user.bankId : null,
      assignedExecutiveId: req.user?.role === "loan-executive" ? req.user.uid : null,
    });
    res.json({
      cases: metrics.totalLeads || 0,
      activeDealerships: metrics.activeDealerships || 0,
      bankPartners: metrics.bankPartners || 0,
      monthlyPayouts: metrics.commissionPayouts || 0,
      approvalsThisMonth: metrics.approvedLeads || metrics.disbursedLeads || 0,
      metrics,
    });
  } catch (error) {
    next(error);
  }
}
