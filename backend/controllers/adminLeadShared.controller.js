import { listRecentRecords } from "../services/firestore.service.js";
import { normalizeStatus } from "../utils/status.constants.js";

export function leadDetailResponseFromProjection(projection = {}, extras = {}) {
  const {
    sourceCollection,
    sourceId,
    viewType,
    leadId,
    searchText,
    customerSummary,
    executiveSummary,
    statusSummary,
    documentCounts,
    timelineSummary,
    documents,
    bankDocuments,
    ...lead
  } = projection;
  return { ...lead, id: sourceId || leadId || projection.id, ...extras };
}

export function sameDate(value, target) {
  if (!target) return true;
  if (!value) return false;
  return new Date(value).toISOString().slice(0, 10) === target;
}

export function leadText(lead) {
  return [
    lead.caseId,
    lead.fullName,
    lead.customerName,
    lead.mobile,
    lead.city,
    lead.selectedBrand,
    lead.selectedModel,
    lead.preferredBank,
    lead.bankPartner,
    lead.status,
  ].filter(Boolean).join(" ").toLowerCase();
}

export function sameText(left, right) {
  const cleanLeft = String(left || "").trim().toLowerCase();
  const cleanRight = String(right || "").trim().toLowerCase();
  return Boolean(cleanLeft && cleanRight && cleanLeft === cleanRight);
}

export async function enrichAdminLeadRows(leads = []) {
  if (!leads.length) return leads;
  const [bankPartners, bankApprovals] = await Promise.all([
    listRecentRecords("bankPartners", { limit: 200 }).catch(() => []),
    listRecentRecords("pendingBankApprovals", { limit: 200 }).catch(() => []),
  ]);
  const banks = [...bankPartners, ...bankApprovals];
  return leads.map((lead) => {
    const bank = banks.find((item) =>
      sameText(item.id, lead.bankId)
      || sameText(item.id, lead.assignedPartnerId)
      || sameText(item.bankId, lead.bankId)
      || sameText(item.email, lead.bankId)
      || sameText(item.email, lead.assignedPartnerId)
      || sameText(item.bankName, lead.assignedBankName)
      || sameText(item.companyName, lead.assignedBankName)
      || sameText(item.bankName, lead.bankPartner)
      || sameText(item.companyName, lead.bankPartner)
      || sameText(item.bankName, lead.preferredBank)
    );
    return {
      ...lead,
      assignedBankName: lead.assignedBankName || lead.bankPartner || bank?.bankName || bank?.companyName || null,
      assignedBankIfsc: lead.assignedBankIfsc || bank?.ifsc || bank?.bankIfsc || bank?.ifscCode || null,
    };
  });
}

export function filterLeads(leads, query) {
  const search = (query.search || "").trim().toLowerCase();
  return leads.filter((lead) => {
    const bank = lead.preferredBank || lead.bankPartner || lead.bank;
    const matchesSearch = !search || leadText(lead).includes(search);
    const matchesStatus = !query.status || normalizeStatus(lead.status) === normalizeStatus(query.status);
    const matchesBank = !query.bank || bank === query.bank;
    const matchesCity = !query.city || (lead.city || "").toLowerCase() === query.city.toLowerCase();
    const matchesDate = sameDate(lead.createdAt, query.date);
    return matchesSearch && matchesStatus && matchesBank && matchesCity && matchesDate;
  });
}
