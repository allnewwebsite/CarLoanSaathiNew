import { scopedAnalytics } from "../services/analytics.service.js";
import { ROLES } from "../utils/constants.js";

function analyticsScopeForUser(user = {}) {
  if (user.role === ROLES.SUPER_ADMIN) return {};
  if ([ROLES.FINANCE_DESK, ROLES.GM_SM].includes(user.role)) return { dealershipId: user.dealershipId };
  if (user.role === ROLES.BANK_MANAGER) return { bankId: user.bankId };
  if (user.role === ROLES.LOAN_EXECUTIVE) return { assignedExecutiveId: user.uid };
  const error = new Error("Dashboard role is not allowed");
  error.status = 403;
  throw error;
}

export async function getOverview(req, res, next) {
  try {
    const metrics = await scopedAnalytics(analyticsScopeForUser(req.user));
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
