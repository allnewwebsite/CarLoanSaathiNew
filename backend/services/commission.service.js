import { createRecord, queryRecords, updateRecord } from "./firestore.service.js";
import { getWorkflowSettings } from "./settings.service.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";

export async function ensureCommissionForLead(lead, status) {
  const normalized = normalizeStatus(status);
  if (![LEAD_STATUSES.APPROVED, LEAD_STATUSES.DISBURSED].includes(normalized)) return null;
  if (!lead.dealerEmail && !lead.createdBy) return null;

  const commissions = await queryRecords("commissions", {
    where: [{ field: "leadId", value: lead.id }],
    orderBy: "leadId",
    direction: "asc",
    limit: 5,
    maxLimit: 5,
  }).catch(() => ({ data: [] }));
  const existing = commissions.data[0];
  const settings = await getWorkflowSettings();
  const amount = Math.round(Number(lead.loanAmount || 0) * (Number(settings.defaultCommissionPercent) / 100));
  const commissionStatus = normalized === LEAD_STATUSES.DISBURSED ? "released" : "pending";
  const payoutStatus = normalized === LEAD_STATUSES.DISBURSED ? "released" : "pending";

  if (existing) {
    const payoutPages = await Promise.all([
      queryRecords("payouts", {
        where: [{ field: "leadId", value: lead.id }],
        orderBy: "leadId",
        direction: "asc",
        limit: 5,
        maxLimit: 5,
      }).catch(() => ({ data: [] })),
      queryRecords("payouts", {
        where: [{ field: "commissionId", value: existing.id }],
        orderBy: "commissionId",
        direction: "asc",
        limit: 5,
        maxLimit: 5,
      }).catch(() => ({ data: [] })),
    ]);
    const payout = payoutPages.flatMap((page) => page.data)[0];
    if (payout) await updateRecord("payouts", payout.id, { amount, status: payoutStatus });
    return updateRecord("commissions", existing.id, { amount, status: commissionStatus, leadStatus: normalized });
  }

  const commission = await createRecord("commissions", {
    leadId: lead.id,
    dealerEmail: lead.dealerEmail || lead.createdBy,
    amount,
    percentage: settings.defaultCommissionPercent,
    status: commissionStatus,
    leadStatus: normalized,
  });

  await createRecord("payouts", {
    leadId: lead.id,
    commissionId: commission.id,
    dealerEmail: lead.dealerEmail || lead.createdBy,
    amount,
    status: payoutStatus,
  });

  return commission;
}
