import { scopedAnalytics } from "../services/analytics.service.js";
import { queryAllLeads, queryBankLeads, queryDealershipLeads, queryExecutiveLeads } from "../services/leadQuery.service.js";
import { getNotifications } from "../services/notification.service.js";
import { queryLeadProjectionForUser } from "../services/projection.service.js";
import { ROLES } from "../utils/constants.js";

function analyticsScopeForUser(user = {}) {
  if (user.role === ROLES.SUPER_ADMIN) return {};
  if ([ROLES.FINANCE_DESK, ROLES.GM].includes(user.role)) return { dealershipId: user.dealershipId };
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

const RECENT_LEAD_FIELDS = [
  "id",
  "caseId",
  "fullName",
  "customerName",
  "mobile",
  "city",
  "status",
  "createdAt",
  "updatedAt",
  "statusUpdatedAt",
  "dealershipId",
  "dealershipName",
  "bankId",
  "bankName",
  "assignedBankName",
  "assignedExecutiveId",
  "assignedExecutiveName",
  "salespersonId",
  "salespersonName",
];

async function recentLeadsForUser(user = {}) {
  const query = { page: 1, limit: 8 };
  const projected = await queryLeadProjectionForUser({ user, query, fields: RECENT_LEAD_FIELDS }).catch(() => null);
  if (projected?.data?.length) return { ...projected, source: "projection" };
  if (user.role === ROLES.SUPER_ADMIN) return queryAllLeads({ query, fields: RECENT_LEAD_FIELDS });
  if ([ROLES.FINANCE_DESK, ROLES.GM].includes(user.role)) {
    return queryDealershipLeads({ dealershipId: user.dealershipId, query, fields: RECENT_LEAD_FIELDS });
  }
  if (user.role === ROLES.BANK_MANAGER) {
    return queryBankLeads({ bankId: user.bankId, query, fields: RECENT_LEAD_FIELDS });
  }
  if (user.role === ROLES.LOAN_EXECUTIVE) {
    return queryExecutiveLeads({
      executiveId: user.uid,
      executiveEmail: user.email,
      query,
      fields: RECENT_LEAD_FIELDS,
    });
  }
  const error = new Error("Dashboard role is not allowed");
  error.status = 403;
  throw error;
}

function permissionSnapshot(user = {}) {
  return {
    role: user.role,
    portal: user.portal,
    dealershipId: user.dealershipId || null,
    bankId: user.bankId || null,
    uid: user.uid,
  };
}

export async function getFastDashboard(req, res, next) {
  try {
    const [metrics, recent, notifications] = await Promise.all([
      scopedAnalytics(analyticsScopeForUser(req.user)).catch(() => ({})),
      recentLeadsForUser(req.user).catch(() => ({ data: [], nextCursor: null, limit: 8 })),
      getNotifications({ query: { limit: 20 }, actor: req.user }).catch(() => ({ data: [], unread: 0 })),
    ]);
    const recentRecords = Array.isArray(recent?.data) ? recent.data : [];
    const notificationRows = Array.isArray(notifications?.data) ? notifications.data : [];
    res.set("Cache-Control", "private, max-age=30, stale-while-revalidate=300").json({
      generatedAt: new Date().toISOString(),
      roleSnapshot: permissionSnapshot(req.user),
      permissionSnapshot: permissionSnapshot(req.user),
      counts: {
        totalLeads: metrics.totalLeads || recentRecords.length || 0,
        pendingLeads: metrics.pendingLeads || 0,
        approvedLeads: metrics.approvedLeads || 0,
        disbursedLeads: metrics.disbursedLeads || 0,
        rejectedLeads: metrics.rejectedLeads || 0,
        unreadNotifications: notifications?.unread ?? notificationRows.filter((item) => !item.read).length,
      },
      metrics,
      recentRecords,
      notifications: notificationRows.slice(0, 5),
      nextCursor: recent?.nextCursor || null,
    });
  } catch (error) {
    next(error);
  }
}
