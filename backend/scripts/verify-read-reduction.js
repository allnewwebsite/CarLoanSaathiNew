import "dotenv/config";
import { queryRecords } from "../services/firestore.service.js";

const workflowLimit = 25;
const bankLimit = 100;

const [workflow, bankCatalog] = await Promise.all([
  queryRecords("workflowLogViews", {
    limit: workflowLimit,
    maxLimit: workflowLimit,
    orderBy: "timestamp",
    direction: "desc",
    fields: ["id", "logType", "timestamp"],
  }).catch((error) => ({ data: [], error: error.message })),
  queryRecords("bankBranchCatalog", {
    where: [{ field: "approved", value: true }],
    limit: bankLimit,
    maxLimit: bankLimit,
    orderBy: "bankName",
    direction: "asc",
    fields: ["id", "ifscCode", "bankName", "branchName", "active"],
  }).catch((error) => ({ data: [], error: error.message })),
]);

const workflowBefore = 650;
const workflowAfter = Math.min((workflow.data || []).length + 1, workflowLimit + 1);
const bankBefore = 1500;
const bankAfter = Math.min((bankCatalog.data || []).length + 1, bankLimit + 1);

console.log(JSON.stringify({
  workflowLogs: {
    beforeEstimatedReads: workflowBefore,
    afterEstimatedReads: workflowAfter,
    reductionPercent: Math.round(((workflowBefore - workflowAfter) / workflowBefore) * 100),
    error: workflow.error || null,
  },
  bankSourceLoading: {
    beforeEstimatedReads: bankBefore,
    afterEstimatedReads: bankAfter,
    reductionPercent: Math.round(((bankBefore - bankAfter) / bankBefore) * 100),
    error: bankCatalog.error || null,
  },
  note: "Run backfill:phase1-projections -- --apply before judging live production rows.",
}, null, 2));
