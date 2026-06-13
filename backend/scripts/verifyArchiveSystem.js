import assert from "node:assert/strict";
import { createRecord, getRecord, updateRecord } from "../services/firestore.service.js";
import { archiveClosedLeads } from "../services/archival.service.js";
import { queryAllLeads, queryArchivedLeads, queryDealershipLeads } from "../services/leadQuery.service.js";
import { LEAD_STATUSES } from "../utils/status.constants.js";

const dealershipId = `archive-test-dealer-${Date.now()}`;
const oldRejectedDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
const oldDisbursedDate = new Date(Date.now() - 181 * 24 * 60 * 60 * 1000).toISOString();
const recentDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

const rejected = await createRecord("leads", {
  id: `${dealershipId}-rejected`,
  caseId: `CLS-ARCHIVE-R-${Date.now()}`,
  dealershipId,
  status: LEAD_STATUSES.REJECTED,
  statusUpdatedAt: oldRejectedDate,
  updatedAt: oldRejectedDate,
});
const disbursed = await createRecord("leads", {
  id: `${dealershipId}-disbursed`,
  caseId: `CLS-ARCHIVE-D-${Date.now()}`,
  dealershipId,
  status: LEAD_STATUSES.DISBURSED,
  statusUpdatedAt: oldDisbursedDate,
  updatedAt: oldDisbursedDate,
});
const recentRejected = await createRecord("leads", {
  id: `${dealershipId}-recent`,
  caseId: `CLS-ARCHIVE-ACTIVE-${Date.now()}`,
  dealershipId,
  status: LEAD_STATUSES.REJECTED,
  statusUpdatedAt: recentDate,
  updatedAt: recentDate,
});

const firstRun = await archiveClosedLeads({ limit: 50 });
assert.equal(firstRun.archived, 2);
assert.equal((await getRecord("leads", rejected.id)).archiveReason, "AUTO_REJECTED_90_DAYS");
assert.equal((await getRecord("leads", disbursed.id)).archiveReason, "AUTO_DISBURSED_180_DAYS");
assert.equal((await getRecord("leads", recentRejected.id)).isArchived, false);

const activeDealer = await queryDealershipLeads({ dealershipId, query: { limit: 20 } });
assert.deepEqual(activeDealer.data.map((lead) => lead.id), [recentRejected.id]);
const activeAdmin = await queryAllLeads({ query: { limit: 100 } });
assert.equal(activeAdmin.data.some((lead) => [rejected.id, disbursed.id].includes(lead.id)), false);

const archived = await queryArchivedLeads({ dealershipId, query: { limit: 20 } });
assert.equal(archived.data.length, 2);

await assert.rejects(
  () => updateRecord("leads", rejected.id, { status: LEAD_STATUSES.CONTACTED }),
  (error) => error.code === "ARCHIVED_LEAD_IMMUTABLE",
);

const secondRun = await archiveClosedLeads({ limit: 50 });
assert.equal(secondRun.archived, 0);

console.log(JSON.stringify({
  ok: true,
  archived: firstRun.archived,
  idempotentArchived: secondRun.archived,
  activeDealerLeads: activeDealer.data.length,
  archivedDealerLeads: archived.data.length,
}, null, 2));
