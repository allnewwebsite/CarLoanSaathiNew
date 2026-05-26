import { createRecord, listRecords, updateRecord } from "./firestore.service.js";
import { getWorkflowSettings } from "./settings.service.js";
import { LEAD_STATUSES, normalizeStatus } from "../utils/status.constants.js";

export async function ensureCommissionForLead(lead, status) {
  const normalized = normalizeStatus(status);
  if (![LEAD_STATUSES.APPROVED, LEAD_STATUSES.DISBURSED].includes(normalized)) return null;
  if (!lead.dealerEmail && !lead.createdBy) return null;

  const commissions = await listRecords("commissions");
  const existing = commissions.find((item) => item.leadId === lead.id);
  const settings = await getWorkflowSettings();
  const amount = Math.round(Number(lead.loanAmount || 0) * (Number(settings.defaultCommissionPercent) / 100));
  const commissionStatus = normalized === LEAD_STATUSES.DISBURSED ? "released" : "pending";
  const payoutStatus = normalized === LEAD_STATUSES.DISBURSED ? "released" : "pending";

  if (existing) {
    const payouts = await listRecords("payouts");
    const payout = payouts.find((item) => item.leadId === lead.id || item.commissionId === existing.id);
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
