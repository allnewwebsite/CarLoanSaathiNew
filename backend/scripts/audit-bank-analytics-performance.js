import "dotenv/config";
import { getRecord, queryRecords } from "../services/firestore.service.js";

const limit = Math.min(Math.max(Number(process.env.AUDIT_LIMIT || 25), 1), 100);
const summaryId = String(process.env.BANK_ANALYTICS_SUMMARY_ID || "").trim();
const summary = summaryId
  ? await getRecord("bankAnalyticsSummaries", summaryId).catch((error) => ({ error: error.message }))
  : null;
const executives = summary?.scopeId
  ? await queryRecords("bankExecutiveAnalytics", {
    where: [
      { field: "scopeId", value: summary.scopeId },
      { field: "assignedLeads", op: ">", value: 0 },
    ],
    orderBy: "assignedLeads",
    direction: "desc",
    limit,
    maxLimit: limit,
  }).catch((error) => ({ data: [], error: error.message }))
  : { data: [] };
const recent = summary?.scopeId
  ? await queryRecords("bankRecentCases", {
    where: [{ field: "scopeId", value: summary.scopeId }],
    orderBy: "activityAt",
    direction: "desc",
    limit: 10,
    maxLimit: 10,
  }).catch((error) => ({ data: [], error: error.message }))
  : { data: [] };

console.log(JSON.stringify({
  area: "bank analytics aggregates",
  summaryFound: Boolean(summary?.scopeId),
  executiveRowsSeen: (executives.data || []).length,
  recentRowsSeen: (recent.data || []).length,
  estimatedReads: summaryId
    ? 1 + Math.max((executives.data || []).length, 1) + Math.max((recent.data || []).length, 1)
    : 0,
  executiveError: executives.error || null,
  recentError: recent.error || null,
  note: summaryId
    ? "Read-only aggregate audit. Lead collection reads: 0."
    : "Set BANK_ANALYTICS_SUMMARY_ID to audit one deployed branch summary.",
}, null, 2));
