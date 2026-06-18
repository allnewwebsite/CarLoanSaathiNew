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
export async function getAdminOnboardingRequests(req, res, next) {
  try {
    const requests = await listRecentRecords("onboardingRequests", { limit: req.query.limit || 100 });
    const status = String(req.query.status || "").trim();
    const search = String(req.query.search || "").trim().toLowerCase();
    const filtered = requests.filter((request) => {
      const matchesStatus = !status || request.status === status;
      const haystack = [
        request.id,
        request.dealershipName,
        request.dealershipBrand,
        request.loginEmail,
        request.city,
        request.status,
      ].filter(Boolean).join(" ").toLowerCase();
      return matchesStatus && (!search || haystack.includes(search));
    });
    res.json(filtered);
  } catch (error) {
    next(error);
  }
}

export async function updateAdminOnboardingRequest(req, res, next) {
  try {
    const request = await getRecord("onboardingRequests", req.params.id);
    if (!request) return res.status(404).json({ message: "Onboarding request not found" });

    const status = String(req.body.status || "").trim();
    if (!["Approved", "Rejected", "Pending Approval", "Additional Documents Requested"].includes(status)) {
      return res.status(400).json({ message: "Invalid onboarding status" });
    }

    const now = new Date().toISOString();
    const updated = await updateRecord("onboardingRequests", request.id, {
      status,
      reviewedAt: now,
      reviewedBy: req.user?.email || "super-admin",
      adminRemarks: String(req.body.adminRemarks || "").trim(),
    });

    const loginEmail = requestLoginEmail(request);
    const active = status === "Approved";
    if (loginEmail) {
      const dealerWrites = [
        upsertRecord("dealerships", loginEmail, {
        ...stripRemovedDealershipFields(request.dealership || {}),
        onboardingRequestId: request.id,
        loginEmail,
        status,
        active,
        approvedAt: active ? now : null,
        approvedBy: active ? req.user?.email || "super-admin" : null,
        }),
        upsertRecord("dealers", loginEmail, {
        ...stripRemovedDealershipFields(request.dealership || {}),
        onboardingRequestId: request.id,
        loginEmail,
        role: "finance-desk",
        status,
        active,
        approvedAt: active ? now : null,
        approvedBy: active ? req.user?.email || "super-admin" : null,
        }),
      ];
      if (request.city) {
        dealerWrites.push(upsertRecord("cityMappings", `dealer:${request.city}:${loginEmail}`, {
          type: "dealer",
          city: request.city,
          dealershipEmail: loginEmail,
          dealershipName: request.dealershipName,
          status,
          active,
        }));
      }
      await Promise.all(dealerWrites);
    }

    if (active) {
      await activateDealerAccessFromRequest({ request, req, now });
      if (loginEmail) {
        await initializeDealershipTrial({
          dealershipId: loginEmail,
          dealership: { ...stripRemovedDealershipFields(request.dealership || {}), loginEmail, dealershipName: request.dealershipName },
          approvedAt: now,
          actor: req.user,
        });
      }
    } else if (status === "Rejected") {
      const pendingAccount = await firstAdminLookup([
        () => loginEmail ? getRecord("pendingDealerAccounts", loginEmail) : null,
        () => loginEmail ? findRecordsByField("pendingDealerAccounts", "email", loginEmail, 5) : [],
        () => findRecordsByField("pendingDealerAccounts", "onboardingRequestId", request.id, 5),
        () => request.approvalRequestId ? findRecordsByField("pendingDealerAccounts", "approvalRequestId", request.approvalRequestId, 5) : [],
      ]);
      if (pendingAccount) {
        await updateRecord("pendingDealerAccounts", pendingAccount.id, {
          approvalStatus: "rejected",
          accountApproved: false,
          accountActive: false,
          rejectionReason: String(req.body.adminRemarks || "Rejected by Super Admin").trim(),
          rejectedAt: now,
          rejectedBy: req.user?.email || "super-admin",
        });
      }
    }

    clearAdminApprovalCaches();
    res.json({ message: `Onboarding request ${status}`, request: safeDealershipApprovalRecord(updated) });
    runAdminSideEffects("dealer-onboarding-status", [
      () => createNotification({
        type: active ? "dealer-approved" : status === "Rejected" ? "dealer-rejected" : "dealer-onboarding-update",
        title: `Dealer onboarding ${status}`,
        message: `${request.dealershipName || loginEmail} onboarding marked ${status}`,
        recipientRole: "finance-desk",
        recipientId: loginEmail,
        dealerEmail: loginEmail,
        admin: true,
        meta: { onboardingRequestId: request.id, dealershipName: request.dealershipName, status },
      }),
      () => writeAuditLog({ req, actionType: "DEALER_ONBOARDING_STATUS", oldValue: request.status, newValue: status, meta: { onboardingRequestId: request.id, loginEmail } }),
    ]);
  } catch (error) {
    next(error);
  }
}

export async function updateAdminWorkflowSettings(req, res, next) {
  try {
    const settings = await updateWorkflowSettings(req.body);
    await writeAuditLog({ req, actionType: "SETTINGS_UPDATE", newValue: req.body });
    res.json({ message: "Workflow settings updated", settings });
  } catch (error) {
    next(error);
  }
}

export async function getAdminWorkflowSettings(_req, res, next) {
  try {
    res.json(await getWorkflowSettings());
  } catch (error) {
    next(error);
  }
}

export async function freezeAdminPartner(req, res, next) {
  try {
    const partner = await freezePartner(req.params.partnerId, Boolean(req.body.frozen));
    await writeAuditLog({ req, actionType: Boolean(req.body.frozen) ? "PARTNER_FREEZE" : "PARTNER_UNFREEZE", newValue: req.body, meta: { partnerId: req.params.partnerId } });
    res.json({ message: Boolean(req.body.frozen) ? "Partner frozen" : "Partner unfrozen", partner });
  } catch (error) {
    next(error);
  }
}

export async function getAdminWorkflowLogs(req, res, next) {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const logType = String(req.query.logType || "").trim();
    const search = String(req.query.search || "").trim();
    const legacyFallback = String(req.query.legacyFallback || req.query.includeLegacyFallback || "").toLowerCase() === "true"
      || String(process.env.ALLOW_WORKFLOW_LOG_FALLBACK || "").toLowerCase() === "true";
    const where = logType ? [{ field: "logType", value: logType }] : [];
    const cacheKey = `admin:workflow-logs:${JSON.stringify({
      limit,
      cursor: req.query.cursor || "",
      logType,
      search,
      legacyFallback,
    })}`;
    const payload = await cached(cacheKey, 15000, async () => {
      const page = await queryRecords("workflowLogViews", {
        where,
        orderBy: "timestamp",
        direction: "desc",
        limit,
        maxLimit: 100,
        cursor: req.query.cursor || null,
        search,
        searchFields: ["title", "summary", "actorEmail", "leadId", "caseId", "entityId", "status", "action"],
        fields: ["id", "sourceId", "sourceCollection", "logType", "timestamp", "createdAt", "updatedAt", "leadId", "caseId", "entityId", "actorEmail", "actorName", "status", "action", "title", "summary"],
      });
      let rows = page.data || [];
      if (legacyFallback && !rows.length && !logType && !search && !req.query.cursor) {
        const fallbackLimit = Math.min(limit, 25);
        const [assignments, reassignmentLogs, payouts, commissions, notifications, settings] = await Promise.all([
          listRecentRecords("leadAssignments", { limit: fallbackLimit }),
          listRecentRecords("reassignmentLogs", { limit: fallbackLimit }),
          listRecentRecords("payouts", { limit: fallbackLimit }),
          listRecentRecords("commissions", { limit: fallbackLimit }),
          listRecentRecords("notifications", { limit: fallbackLimit }),
          listRecentRecords("settings", { limit: fallbackLimit }),
        ]);
        rows = [
          ...assignments.map((item) => ({ ...item, logType: "leadAssignments" })),
          ...reassignmentLogs.map((item) => ({ ...item, logType: "reassignmentLogs" })),
          ...payouts.map((item) => ({ ...item, logType: "payouts" })),
          ...commissions.map((item) => ({ ...item, logType: "commissions" })),
          ...notifications.map((item) => ({ ...item, logType: "notifications" })),
          ...settings.map((item) => ({ ...item, logType: "settings" })),
        ]
          .sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))
          .slice(0, limit);
      }
      const grouped = {
        assignments: rows.filter((item) => item.logType === "leadAssignments"),
        reassignmentLogs: rows.filter((item) => item.logType === "reassignmentLogs"),
        payouts: rows.filter((item) => item.logType === "payouts"),
        commissions: rows.filter((item) => item.logType === "commissions"),
        notifications: rows.filter((item) => item.logType === "notifications"),
        settings: rows.filter((item) => item.logType === "settings"),
      };
      return {
        ...grouped,
        data: rows,
        pagination: {
          limit: page.limit,
          nextCursor: page.nextCursor,
          hasMore: Boolean(page.nextCursor),
        },
      };
    });
    res.json(payload);
  } catch (error) {
    next(error);
  }
}
