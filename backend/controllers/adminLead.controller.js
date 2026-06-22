import {
  ADMIN_SHARED_SENTINEL,
  enrichAdminLeadRows,
  getLeadDetailProjection,
  getRecord,
  leadDetailResponseFromProjection,
  logInfo,
  queryAllLeads,
  queryLeadProjectionForUser,
  queryRecords,
  recordMonitoringSignal,
} from './adminShared.controller.js';

void ADMIN_SHARED_SENTINEL;
export async function getAdminLeads(req, res, next) {
  const startedAt = Date.now();
  let queryStarted, queryEnded, enrichStarted, enrichEnded;
  try {
    queryStarted = Date.now();
    const projectedPage = await queryLeadProjectionForUser({ user: req.user, query: req.query }).catch(() => null);
    const page = projectedPage || await queryAllLeads({ query: req.query });
    queryEnded = Date.now();
    enrichStarted = Date.now();
    const response = { ...page, data: await enrichAdminLeadRows(page.data) };
    enrichEnded = Date.now();
    logInfo("Admin lead query completed", {
      requestId: req.requestId,
      path: req.originalUrl,
      role: req.user?.role,
      totalMs: Date.now() - startedAt,
      queryMs: queryEnded - queryStarted,
      enrichMs: enrichEnded - enrichStarted,
      serializeMs: 0,
      warmup: String(req.headers["x-cls-warmup"] || "").toLowerCase() === "true",
      dataCount: Array.isArray(response?.data) ? response.data.length : undefined,
    });
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function getAdminLead(req, res, next) {
  try {
    const projection = await getLeadDetailProjection(req.params.id).catch(() => null);
    if (projection && Array.isArray(projection.documents) && Array.isArray(projection.bankDocuments)) {
      recordMonitoringSignal("PROJECTION-HIT", {
        endpoint: req.route?.path,
        path: req.originalUrl,
        collection: "leadDetailsProjection",
        leadId: req.params.id,
      });
      logInfo("PROJECTION-HIT", {
        tag: "PROJECTION-HIT",
        requestId: req.requestId,
        path: req.originalUrl,
        endpoint: req.route?.path,
        collection: "leadDetailsProjection",
        leadId: req.params.id,
      });
      return res.json(leadDetailResponseFromProjection(projection, {
        documents: projection.documents || [],
        bankDocuments: projection.bankDocuments || [],
      }));
    }
    recordMonitoringSignal("PROJECTION-MISS", {
      endpoint: req.route?.path,
      path: req.originalUrl,
      collection: "leadDetailsProjection",
      leadId: req.params.id,
      reason: projection ? "invalid_projection" : "missing_projection",
    });
    logInfo("PROJECTION-MISS", {
      tag: "PROJECTION-MISS",
      requestId: req.requestId,
      path: req.originalUrl,
      endpoint: req.route?.path,
      collection: "leadDetailsProjection",
      leadId: req.params.id,
      reason: projection ? "invalid_projection" : "missing_projection",
    });
    recordMonitoringSignal("CANONICAL-FALLBACK", {
      endpoint: req.route?.path,
      path: req.originalUrl,
      collection: "leads",
      leadId: req.params.id,
    });
    logInfo("CANONICAL-FALLBACK", {
      tag: "CANONICAL-FALLBACK",
      requestId: req.requestId,
      path: req.originalUrl,
      endpoint: req.route?.path,
      collection: "leads",
      leadId: req.params.id,
    });
    let lead = await getRecord("leads", req.params.id);
    if (!lead) {
      const page = await queryRecords("leads", {
        where: [{ field: "caseId", value: req.params.id }],
        limit: 1,
        maxLimit: 1,
      });
      lead = page.data?.[0] || null;
    }
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    const [documentsPage, bankDocumentsPage] = await Promise.all([
      queryRecords("documents", {
        where: [{ field: "leadId", value: lead.id }],
        orderBy: "createdAt",
        direction: "desc",
        limit: 50,
        maxLimit: 50,
      }).catch(() => ({ data: [] })),
      queryRecords("bankDocuments", {
        where: [{ field: "leadId", value: lead.id }],
        orderBy: "createdAt",
        direction: "desc",
        limit: 50,
        maxLimit: 50,
      }).catch(() => ({ data: [] })),
    ]);

    res.json({
      ...lead,
      documents: documentsPage.data || [],
      bankDocuments: bankDocumentsPage.data || [],
    });
  } catch (error) {
    next(error);
  }
}
