import "dotenv/config";
import { queryRecords } from "../services/firestore.service.js";

const limit = Math.min(Math.max(Number(process.env.AUDIT_LIMIT || 25), 1), 100);
const page = await queryRecords("leadTimeline", {
  limit,
  maxLimit: limit,
  orderBy: "createdAt",
  direction: "desc",
  fields: ["id", "leadId", "caseId", "title", "eventType", "createdAt"],
}).catch((error) => ({ data: [], error: error.message }));

console.log(JSON.stringify({
  area: "timeline",
  rowsSeen: (page.data || []).length,
  estimatedReads: Math.min((page.data || []).length + 1, limit + 1),
  error: page.error || null,
  note: "Read-only audit. Phase 1 does not change timeline endpoints.",
}, null, 2));
