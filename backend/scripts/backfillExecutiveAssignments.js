import "dotenv/config";
import { listRecords, updateRecord } from "../services/firestore.service.js";

function sameExecutive(lead, executive) {
  return lead.assignedExecutiveId === executive.id
    || lead.assignedExecutiveId === executive.email
    || lead.assignedExecutiveEmail === executive.email;
}

async function main() {
  const apply = process.env.BACKFILL_APPLY === "true";
  const leads = await listRecords("leads");
  const executives = await listRecords("loanExecutives");
  const updates = [];

  for (const lead of leads) {
    if (!lead.assignedExecutiveId && !lead.assignedExecutiveEmail) continue;
    const executive = executives.find((item) => sameExecutive(lead, item));
    if (!executive) {
      updates.push({ leadId: lead.id, caseId: lead.caseId, status: "orphaned-assignment" });
      continue;
    }
    const patch = {};
    if (!lead.assignedExecutiveId || lead.assignedExecutiveId === lead.assignedExecutiveEmail) patch.assignedExecutiveId = executive.id || executive.email;
    if (!lead.assignedExecutiveEmail) patch.assignedExecutiveEmail = executive.email || null;
    if (!Object.keys(patch).length) continue;
    updates.push({ leadId: lead.id, caseId: lead.caseId, status: "patch-ready", patch });
    if (apply) await updateRecord("leads", lead.id, patch);
  }

  console.log(JSON.stringify({ apply, checked: leads.length, updates }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
