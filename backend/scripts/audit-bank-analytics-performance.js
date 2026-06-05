import "dotenv/config";
import { queryRecords } from "../services/firestore.service.js";

const limit = Math.min(Math.max(Number(process.env.AUDIT_LIMIT || 25), 1), 100);
const [metrics, catalog] = await Promise.all([
  queryRecords("bankMetrics", {
    limit,
    maxLimit: limit,
    orderBy: "updatedAt",
    direction: "desc",
    fields: ["id", "bankId", "ifscCode", "totalLeads", "updatedAt"],
  }).catch((error) => ({ data: [], error: error.message })),
  queryRecords("bankBranchCatalog", {
    limit,
    maxLimit: limit,
    orderBy: "bankName",
    direction: "asc",
    fields: ["id", "ifscCode", "bankName", "branchName", "approved", "active"],
  }).catch((error) => ({ data: [], error: error.message })),
]);

console.log(JSON.stringify({
  area: "bank analytics/catalog",
  bankMetricsRowsSeen: (metrics.data || []).length,
  bankCatalogRowsSeen: (catalog.data || []).length,
  estimatedReads: Math.min((metrics.data || []).length + 1, limit + 1) + Math.min((catalog.data || []).length + 1, limit + 1),
  metricsError: metrics.error || null,
  catalogError: catalog.error || null,
  note: "Read-only audit. Phase 1 optimizes bank source loading through bankBranchCatalog.",
}, null, 2));
