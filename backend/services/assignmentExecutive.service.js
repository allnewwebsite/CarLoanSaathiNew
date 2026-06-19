import { countRecords, getRecord, queryRecords, upsertRecord } from "./firestore.service.js";
import { countOpenExecutiveLeads } from "./leadQuery.service.js";
import { queryExecutiveSummaryProjection, syncExecutiveSummaryProjectionSoon } from "./projection.service.js";

export function queueIdForLead(lead) {
  return `${routingCityForLead(lead) || "all"}:${lead.selectedBrand || "all"}:${lead.preferredBank || "all"}`.toLowerCase();
}

export function routingCityForLead(lead) {
  return lead.dealershipCity || lead.routingCity || lead.dealerCity || lead.branchCity || lead.city;
}

export function sameText(left, right) {
  const a = String(left || "").trim().toLowerCase();
  const b = String(right || "").trim().toLowerCase();
  return Boolean(a && b && a === b);
}

export function normalizedBranch(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\b(branch|br|city|district)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function fuzzySameBranch(left, right) {
  const a = normalizedBranch(left);
  const b = normalizedBranch(right);
  if (!a || !b) return true;
  return a === b || a.includes(b) || b.includes(a);
}

export function executiveIdentityKeys(executive = {}) {
  return [
    executive.id,
    executive.sourceId,
    executive.executiveId,
    executive.employeeId,
    executive.employeeCode,
    executive.jobId,
    executive.email,
    executive.officialEmail,
    executive.mobile,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
}

export function normalizedStatus(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function activeExecutive(executive = {}) {
  const status = normalizedStatus(executive.status || executive.accountStatus);
  return Boolean(
    executive
    && executive.active !== false
    && executive.accountActive !== false
    && executive.accountApproved !== false
    && executive.deleted !== true
    && executive.removed !== true
    && executive.paused !== true
    && executive.suspended !== true
    && !["inactive", "deleted", "removed", "suspended", "disabled"].includes(status)
  );
}

export function branchValue(record = {}) {
  return record.bankBranchLocation || record.branchLocation || record.branchCity || record.branch || record.bankLocation || record.city || record.operatingCity || record.bankBranchCity || record.branchId || "";
}

export function sameBranchExecutive(lead = {}, executive = {}) {
  const leadIfsc = lead.assignedBankIfsc || lead.bankIfsc || lead.ifscCode || "";
  const executiveIfsc = executive.bankIfsc || executive.ifsc || executive.ifscCode || executive.branchIfsc || "";
  const executiveBranch = branchValue(executive);
  const executiveBankAliases = [executive.bankId, executive.bankPartnerId, executive.partnerId, executive.branchId].filter(Boolean);
  if (leadIfsc && executiveIfsc) return sameText(leadIfsc, executiveIfsc);
  if (leadIfsc && executiveBankAliases.some((value) => sameText(value, leadIfsc))) return true;
  if (leadIfsc && sameText(executiveBranch, leadIfsc)) return true;
  const leadBranch = lead.branchId || lead.bankBranchId || lead.bankBranchCity || lead.branchCity || lead.branchLocation || lead.bankBranchLocation || lead.routingCity || lead.city || "";
  if (executiveIfsc && sameText(leadBranch, executiveIfsc)) return true;
  return fuzzySameBranch(leadBranch, executiveBranch);
}

export function sameExecutive(left = {}, right = {}) {
  const rightKeys = new Set(executiveIdentityKeys(right));
  return executiveIdentityKeys(left).some((key) => rightKeys.has(key));
}

export async function refreshExecutiveSummary(executive = {}) {
  const executiveId = executive.id || executive.email || executive.officialEmail || "";
  if (!executiveId) return null;
  const [totalAssignedCases, currentActiveCases] = await Promise.all([
    countRecords("leads", { where: [{ field: "assignedExecutiveId", value: executiveId }] }).catch(() => Number(executive.totalAssignedCases || 0)),
    countOpenExecutiveLeads(executiveId).catch(() => Number(executive.currentActiveCases || 0)),
  ]);
  return syncExecutiveSummaryProjectionSoon(executive, { totalAssignedCases, currentActiveCases });
}

export function uniqueByIdentity(records = []) {
  const seen = new Set();
  return records.filter((record) => {
    const key = executiveIdentityKeys(record)[0] || record.id || JSON.stringify(record);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function queryBankExecutiveCandidates(lead = {}, options = {}) {
  const bankValues = [
    options.bankId,
    options.bankIfsc,
    lead.bankId,
    lead.assignedPartnerId,
    lead.assignedBankIfsc,
    lead.bankIfsc,
    lead.ifscCode,
    lead.assignedBankName,
    lead.bankName,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const values = [...new Set(bankValues)];
  const fields = ["bankId", "bankPartnerId", "partnerId", "bankIfsc", "ifsc", "ifscCode", "bankName"];
  const queries = values.flatMap((value) => fields.map((field) => queryRecords("loanExecutives", {
    where: [{ field, value }],
    orderBy: "createdAt",
    direction: "desc",
    limit: 100,
    maxLimit: 100,
  }).catch(() => ({ data: [] }))));
  if (!queries.length) {
    queries.push(queryRecords("loanExecutives", {
      orderBy: "createdAt",
      direction: "desc",
      limit: 100,
      maxLimit: 100,
    }).catch(() => ({ data: [] })));
  }
  const pages = await Promise.all(queries);
  return uniqueByIdentity(pages.flatMap((page) => page.data || []));
}

export async function resolveTargetExecutive({ lead, targetExecutiveId, bankId = "", bankIfsc = "" }) {
  const requested = String(targetExecutiveId || "").trim();
  if (!requested) return null;
  const direct = await getRecord("loanExecutives", requested).catch(() => null);
  if (direct) return direct;
  const lower = requested.toLowerCase();
  const executives = await queryBankExecutiveCandidates(lead, { bankId, bankIfsc });
  return executives.find((executive) => executiveIdentityKeys(executive).includes(lower)) || null;
}

export function bankMatchesExecutive(lead, executive, options = {}) {
  return sameText(executive.bankId, lead.bankId)
    || sameText(executive.bankId, options.bankId)
    || sameText(executive.bankId, options.bankIfsc)
    || sameText(executive.bankPartnerId, lead.bankId)
    || sameText(executive.bankPartnerId, options.bankId)
    || sameText(executive.bankPartnerId, lead.assignedPartnerId)
    || sameText(executive.bankIfsc, lead.assignedBankIfsc)
    || sameText(executive.bankIfsc, lead.bankIfsc)
    || sameText(executive.bankIfsc, options.bankIfsc)
    || sameText(executive.ifsc, lead.assignedBankIfsc)
    || sameText(executive.ifsc, lead.ifscCode)
    || sameText(executive.ifsc, options.bankIfsc)
    || sameText(executive.bankName, lead.assignedBankName)
    || sameText(executive.bankName, lead.selectedBankName)
    || sameText(executive.bankName, lead.bankName)
    || sameText(executive.bankName, lead.bankPartner)
    || sameText(executive.bankName, lead.preferredBank)
    || sameText(executive.branchId, lead.branchId);
}

export function nextPartnerIndex(queue, partners) {
  if (!queue?.lastAssignedPartner) return 0;
  const current = partners.findIndex((partner) => partner.id === queue.lastAssignedPartner || partner.name === queue.lastAssignedPartner);
  if (current < 0) return 0;
  return (current + 1) % partners.length;
}

export async function selectBranchExecutive({ lead, partner, city }) {
  const executivesPage = await queryRecords("loanExecutives", {
    where: partner.bankId || partner.id ? [{ field: "bankId", value: partner.bankId || partner.id }] : [],
    orderBy: "createdAt",
    direction: "desc",
    limit: 100,
    maxLimit: 100,
  });
  const executives = executivesPage.data;
  const eligible = executives.filter((executive) => {
    const executiveCity = executive.branchCity || executive.city || executive.operatingCity;
    const sameBranchCity = !city || !executiveCity || executiveCity === city;
    const sameBank = executive.bankPartnerId === partner.id
      || executive.bankPartnerId === partner.email
      || executive.bankName === partner.bankName
      || executive.bankName === partner.name
      || executive.branchId === partner.branchId;
    return sameBank && sameBranchCity && executive.active !== false && executive.paused !== true && executive.status !== "inactive";
  });

  if (!eligible.length) return null;

  const queueId = `executive:${partner.id || partner.email}:${city || "all"}`.toLowerCase();
  const queue = await getRecord("partnerQueues", queueId);
  const index = queue?.lastAssignedExecutive
    ? Math.max(0, (eligible.findIndex((executive) => executive.id === queue.lastAssignedExecutive) + 1) % eligible.length)
    : 0;
  const executive = eligible[index];

  await upsertRecord("partnerQueues", queueId, {
    queueKey: queueId,
    lastAssignedExecutive: executive.id,
    lastAssignedLead: lead.id,
    lastAssignedAt: new Date().toISOString(),
  });

  return executive;
}

export async function projectedExecutiveWorkload(bankId, eligible = []) {
  if (!bankId || !eligible.length) return null;
  const summaries = await queryExecutiveSummaryProjection({ bankId, query: { limit: 100 } }).catch(() => null);
  if (!summaries?.length) return null;
  const byKey = new Map();
  for (const summary of summaries) {
    const count = Number(summary.currentActiveCases || 0);
    executiveIdentityKeys(summary).forEach((key) => byKey.set(key, count));
  }
  const workload = new Map();
  for (const executive of eligible) {
    const key = executiveIdentityKeys(executive).find((value) => byKey.has(value));
    if (key) workload.set(executive.id, byKey.get(key));
  }
  return workload;
}
