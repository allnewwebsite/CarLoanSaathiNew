import {
  activateApprovedBankUsers,
  activateDealerAccessFromRequest,
  addTimelineEvent,
  ADMIN_SHARED_SENTINEL,
  approvalLog,
  approvalStatusOf,
  approveBankBackrefs,
  approveBankBranchAdmin,
  approveDealershipBackrefs,
  assertNoActiveIdentityCollision,
  assertValidStatusTransition,
  boundedList,
  cached,
  candidateRecordsByQueries,
  clearAdminApprovalCaches,
  clearCachedValue,
  clearLeadMutationCaches,
  computeLeadMetrics,
  countRecords,
  createNotification,
  createRecord,
  deactivateBankBranchAdmin,
  dealerEventPayload,
  dealerIdentityProfile,
  deleteFirebaseAuthByEmail,
  deleteMatchingRecords,
  deleteRecord,
  deleteRecordsByQuery,
  ecosystemLimit,
  ensureCommissionForLead,
  enrichAdminLeadRows,
  filterLeads,
  finalApprovalStatus,
  findRecordsByField,
  firebaseAdmin,
  firebaseUidForEmail,
  firestoreNotFound,
  freezePartner,
  getAdminBankBranches,
  getAuditLogs,
  getBankBranchDetailsAdmin,
  getLeadDetailProjection,
  getRecord,
  getWorkflowSettings,
  incrementPlatformCounters,
  incrementRecord,
  initializeDealershipTrial,
  initializeProfessionalSubscriptionPending,
  isProfessionalPlan,
  leadDetailResponseFromProjection,
  LEAD_STATUSES,
  listRecords,
  listRecentRecords,
  logError,
  logInfo,
  materializeApprovedBank,
  materializeApprovedDealership,
  normalizeEmail,
  normalizeIfsc,
  normalizeOnboardingPlan,
  normalizeStatus,
  pendingApprovalStatus,
  publishDealerEvent,
  publishRealtimeEvent,
  queryAllLeads,
  queryLeadProjectionForUser,
  queryRecords,
  queueDocumentsRequiredWhatsApp,
  queueStatusUpdatedWhatsApp,
  REALTIME_EVENTS,
  recordDealerSignal,
  recordMonitoringSignal,
  registerBankBranchAdmin,
  rejectBankBranchAdmin,
  requestLoginEmail,
  resolveDealershipApprovalRequest,
  revokeUserSessions,
  runAdminSideEffects,
  safeAdminUser,
  safeDealershipApprovalRecord,
  safeDocument,
  safeLoginActivity,
  STATUS_LABELS,
  syncLeadProjectionSoon,
  TIMELINE_EVENTS,
  today,
  updateBankBranchAdmin,
  updateRecord,
  updateRecordIfExists,
  updateWorkflowSettings,
  upsertCanonicalUser,
  upsertRecord,
  validateBankLocation,
  writeAuditLog,
} from './adminShared.controller.js';

void ADMIN_SHARED_SENTINEL;
export async function getAdminPartners(_req, res, next) {
  try {
    res.json(await cached("admin:partners:v2", 30000, () => listRecentRecords("bankPartners", {
      limit: 100,
      fields: ["id", "bankId", "bankPartnerId", "bankName", "companyName", "email", "ifsc", "ifscCode", "status", "active", "frozen", "createdAt", "updatedAt"],
    })));
  } catch (error) {
    next(error);
  }
}

export async function getAdminAnalytics(_req, res, next) {
  try {
    const metrics = await cached("admin:analytics", 15000, () => computeLeadMetrics());
    res.json({
      totalLeads: metrics.totalLeads,
      approvedLeads: metrics.approved,
      rejectedLeads: metrics.rejected,
      monthlyLeads: metrics.totalLeads,
      metrics,
    });
  } catch (error) {
    next(error);
  }
}

export async function adminEcosystemPayload(req) {
    const limit = ecosystemLimit(req.query.ecosystemLimit);
    const leadLimit = Math.min(Math.max(Number(req.query.limit || 10), 1), 20);

    const overviewMetricsPromise = cached("admin:ecosystem:overview:v2", 30000, async () => {
      const metrics = await computeLeadMetrics();
      const [dealershipsCount, banksCount, pendingDealerships, pendingBanks] = await Promise.all([
        countRecords("dealerships").catch(() => 0),
        countRecords("bankPartners").catch(() => 0),
        countRecords("pendingDealershipApprovals", { where: [{ field: "status", value: "pending" }] }).catch(() => 0),
        countRecords("pendingBankApprovals", { where: [{ field: "status", value: "pending" }] }).catch(() => 0),
      ]);
      return { metrics, dealershipsCount, banksCount, pendingDealerships, pendingBanks };
    });

    const leadSummaryPromise = cached(`admin:ecosystem:leads:${leadLimit}:${req.query.cursor || ""}:v2`, 15000, async () => {
      const projected = await queryLeadProjectionForUser({ user: req.user, query: { limit: leadLimit, cursor: req.query.cursor } }).catch(() => null);
      if (projected) return projected;
      return queryAllLeads({ query: { limit: leadLimit, cursor: req.query.cursor } });
    });

    const recentActivityPromise = cached("admin:ecosystem:activity:v2", 30000, async () => (
      listRecentRecords("workflowLogViews", {
        limit: 5,
        orderBy: "timestamp",
        fields: ["id", "logType", "timestamp", "actorEmail", "status", "action", "title", "summary", "leadId", "caseId"],
      }).catch(() => [])
    ));

    const approvalsSummaryPromise = cached("admin:ecosystem:approvals:v2", 30000, async () => {
      const [onboardingRequests, pendingDealershipApprovals, pendingBankApprovals, pendingGoogleAccounts] = await Promise.all([
        boundedList("onboardingRequests", 5, (item) => item, ["id", "status", "dealershipName", "loginEmail", "city", "createdAt", "updatedAt"]),
        boundedList("pendingDealershipApprovals", 5, (item) => item, APPROVAL_LIST_FIELDS),
        boundedList("pendingBankApprovals", 5, (item) => item, APPROVAL_LIST_FIELDS),
        boundedList("pendingGoogleAccounts", 5, (item) => item, ["id", "email", "portal", "status", "reason", "createdAt", "updatedAt"]),
      ]);
      return { onboardingRequests, pendingDealershipApprovals, pendingBankApprovals, pendingGoogleAccounts };
    });

    const bankSummaryPromise = cached("admin:ecosystem:banks:v2", 30000, async () => {
      const [bankPartners, branches, branchManagers, loanExecutives] = await Promise.all([
        boundedList("bankPartners", 5, (item) => item, ["id", "bankId", "bankName", "companyName", "email", "ifsc", "ifscCode", "status", "active", "createdAt", "updatedAt"]),
        boundedList("bankBranchCatalog", 10, (item) => item, ["id", "bankId", "bankName", "branchName", "ifscCode", "city", "approvalStatus", "active", "updatedAt"]),
        boundedList("branchManagers", 5, (item) => item, ["id", "email", "bankId", "bankName", "branchId", "branchCity", "status", "active", "createdAt", "updatedAt"]),
        boundedList("loanExecutives", 5, (item) => item, ["id", "email", "bankId", "bankName", "branchId", "branchCity", "status", "active", "createdAt", "updatedAt"]),
      ]);
      return { bankPartners, banks: bankPartners, branches, branchManagers, loanExecutives };
    });

    const dealershipSummaryPromise = cached("admin:ecosystem:dealerships:v2", 30000, async () => {
      const [dealerships, financeDesks, dealershipManagers] = await Promise.all([
        boundedList("dealerships", 5, (item) => item, ["id", "dealershipName", "name", "city", "status", "active", "createdAt", "updatedAt"]),
        boundedList("financeDesks", 5, (item) => item, ["id", "email", "officialEmail", "dealershipEmail", "city", "status", "active", "createdAt", "updatedAt"]),
        boundedList("dealershipManagers", 5, (item) => item, ["id", "email", "fullName", "role", "dealershipEmail", "status", "active", "createdAt", "updatedAt"]),
      ]);
      return { dealerships, financeDesks, dealershipManagers };
    });

    const [overviewMetrics, leadPage, recentActivity, approvalsSummary, bankSummary, dealershipSummary] = await Promise.all([
      overviewMetricsPromise,
      leadSummaryPromise,
      recentActivityPromise,
      approvalsSummaryPromise,
      bankSummaryPromise,
      dealershipSummaryPromise,
    ]);

    const payload = {
      leads: leadPage.data || [],
      leadPagination: { nextCursor: leadPage.nextCursor, hasMore: leadPage.hasMore, limit: leadPage.limit || leadLimit },
      onboardingRequests: approvalsSummary.onboardingRequests,
      dealerships: dealershipSummary.dealerships,
      financeDesks: dealershipSummary.financeDesks,
      dealershipManagers: dealershipSummary.dealershipManagers,
      bankPartners: bankSummary.bankPartners,
      banks: bankSummary.banks,
      branches: bankSummary.branches,
      branchManagers: bankSummary.branchManagers,
      loanExecutives: bankSummary.loanExecutives,
      assignments: [],
      reassignmentLogs: [],
      documents: [],
      bankDocuments: [],
      pendingDealershipApprovals: approvalsSummary.pendingDealershipApprovals,
      pendingBankApprovals: approvalsSummary.pendingBankApprovals,
      approvalLogs: [],
      pendingGoogleAccounts: approvalsSummary.pendingGoogleAccounts,
      loginActivity: [],
      users: [],
      sections: {
        overviewMetrics,
        recentActivity,
        approvalsSummary,
        bankSummary,
        dealershipSummary,
        leadSummary: {
          totalLeads: overviewMetrics.metrics?.totalLeads || 0,
          preview: leadPage.data || [],
          pagination: { nextCursor: leadPage.nextCursor, hasMore: leadPage.hasMore, limit: leadPage.limit || leadLimit },
        },
      },
    };
    return payload;
}

export async function getAdminEcosystem(req, res, next) {
  try {
    res.json(await adminEcosystemPayload(req));
  } catch (error) {
    next(error);
  }
}
