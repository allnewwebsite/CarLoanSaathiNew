import { listRecords } from "./firestore.service.js";
import { normalizeStatus } from "../utils/status.constants.js";

function monthKey(date) {
  return (date || new Date().toISOString()).slice(0, 7);
}

function groupCount(items, keyFn) {
  return Object.entries(items.reduce((acc, item) => {
    const key = keyFn(item) || "Unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).map(([label, count]) => ({ label, count }));
}

export async function overviewAnalytics() {
  const [leads, commissions, slaLogs] = await Promise.all([listRecords("leads"), listRecords("commissions"), listRecords("slaLogs")]);
  const approved = leads.filter((lead) => ["APPROVED", "DISBURSED"].includes(normalizeStatus(lead.status))).length;
  const rejected = leads.filter((lead) => normalizeStatus(lead.status) === "REJECTED").length;
  return {
    totalLeads: leads.length,
    approvedLeads: approved,
    rejectedLeads: rejected,
    approvalRatio: leads.length ? Math.round((approved / leads.length) * 100) : 0,
    rejectionRatio: leads.length ? Math.round((rejected / leads.length) * 100) : 0,
    slaBreaches: slaLogs.filter((log) => log.status === "expired").length,
    commissionPayouts: commissions.reduce((sum, item) => sum + Number(item.amount || 0), 0),
  };
}

export async function monthlyLeadAnalytics() {
  return groupCount(await listRecords("leads"), (lead) => monthKey(lead.createdAt)).sort((a, b) => a.label.localeCompare(b.label));
}

export async function cityAnalytics() {
  return groupCount(await listRecords("leads"), (lead) => lead.city);
}

export async function dealerAnalytics() {
  const leads = await listRecords("leads");
  const commissions = await listRecords("commissions");
  return groupCount(leads, (lead) => lead.dealerEmail || lead.createdBy)
    .map((dealer) => ({
      ...dealer,
      amount: commissions
        .filter((commission) => (commission.dealerEmail || "Unknown") === dealer.label)
        .reduce((sum, commission) => sum + Number(commission.amount || 0), 0),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

export async function bankAnalytics() {
  return groupCount(await listRecords("leads"), (lead) => lead.bankPartner || lead.preferredBank).sort((a, b) => b.count - a.count).slice(0, 10);
}

export async function slaAnalytics() {
  const logs = await listRecords("slaLogs");
  return groupCount(logs, (log) => log.status).concat([
    { label: "Average SLA Score", count: Math.round(logs.reduce((sum, log) => sum + Number(log.slaScore || 0), 0) / Math.max(logs.length, 1)) },
  ]);
}

export async function disbursalAnalytics() {
  return groupCount((await listRecords("leads")).filter((lead) => normalizeStatus(lead.status) === "DISBURSED"), (lead) => monthKey(lead.updatedAt || lead.createdAt));
}
