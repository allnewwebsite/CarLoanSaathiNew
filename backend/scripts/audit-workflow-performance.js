import "dotenv/config";
import { queryRecords } from "../services/firestore.service.js";

const limit = Math.min(Math.max(Number(process.env.AUDIT_LIMIT || 25), 1), 100);
const legacySources = ["leadAssignments", "reassignmentLogs", "payouts", "commissions", "notifications", "settings"];

const projectionPage = await queryRecords("workflowLogViews", {
  limit,
  maxLimit: limit,
  orderBy: "timestamp",
  direction: "desc",
  fields: ["id", "logType", "timestamp", "title"],
}).catch((error) => ({ data: [], error: error.message }));

console.log(JSON.stringify({
  endpoint: "/api/admin/workflow/logs",
  legacyEstimatedReads: (legacySources.length - 1) * 100 + 50,
  optimizedEstimatedReads: Math.min((projectionPage.data || []).length + 1, limit + 1),
  projectionRowsSeen: (projectionPage.data || []).length,
  projectionError: projectionPage.error || null,
  target: "<= 101 reads worst-case, <= 26 reads default page",
}, null, 2));
