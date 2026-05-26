import { listRecords, updateRecord } from "./firestore.service.js";
import { getBanks } from "./catalog.service.js";
import { getWorkflowSettings } from "./settings.service.js";

function normalizeList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function partnerName(bank) {
  return bank.name || bank.bankName || bank.partnerName;
}

function routingCityForLead(lead) {
  return lead.dealershipCity || lead.routingCity || lead.dealerCity || lead.branchCity || lead.city;
}

export async function getBankPartners() {
  const partners = await listRecords("bankPartners");
  if (partners.length) return partners;

  const banks = await getBanks();
  return banks.map((bank, index) => ({
    id: bank.slug || `bank-partner-${index + 1}`,
    name: partnerName(bank),
    bankName: partnerName(bank),
    active: true,
    approved: true,
    frozen: false,
    supportedCities: ["All"],
    activeCities: ["All"],
    supportedBrands: ["All"],
    supportedBanks: [partnerName(bank)],
    approvalLimit: null,
    status: "active",
    assignedManagers: [],
    slaScore: 100,
    activeLeadCount: 0,
    maxActiveLeads: null,
  }));
}

export async function getEligiblePartners(lead) {
  const settings = await getWorkflowSettings();
  const partners = await getBankPartners();
  const assignments = await listRecords("leadAssignments");

  return partners.filter((partner) => {
    const branchLocation = partner.bankBranchLocation || partner.branchLocation || partner.operatingCity || partner.city || partner.branchCity;
    const cities = normalizeList([...(Array.isArray(partner.supportedCities) ? partner.supportedCities : []), branchLocation].filter(Boolean));
    const activeCities = normalizeList([...(Array.isArray(partner.activeCities) ? partner.activeCities : []), branchLocation].filter(Boolean));
    const brands = normalizeList(partner.supportedBrands);
    const banks = normalizeList(partner.supportedBanks);
    const maxActive = Number(partner.maxActiveLeads || settings.maxActiveLeadsPerPartner);
    const score = Number(partner.slaScore ?? 100);
    const bank = lead.preferredBank || lead.selectedBank;
    const routingCity = routingCityForLead(lead);

    const cityOk = !settings.assignmentRules.requireCityCoverage
      || cities.includes("All")
      || activeCities.includes("All")
      || cities.includes(routingCity)
      || activeCities.includes(routingCity);
    const brandOk = !settings.assignmentRules.requireBrandSupport || brands.includes("All") || brands.includes(lead.selectedBrand);
    const bankOk = !settings.assignmentRules.requireBankSupport || banks.includes("All") || banks.includes(bank);
    const activeLeadCount = assignments.filter((assignment) => {
      const samePartner = assignment.partnerId === partner.id || assignment.partnerName === partner.name || assignment.partnerName === partner.bankName;
      return samePartner && ["pending", "accepted", "in-progress"].includes(assignment.status);
    }).length;
    const limitOk = activeLeadCount < maxActive;

    return partner.active !== false
      && partner.approved !== false
      && partner.frozen !== true
      && partner.status !== "inactive"
      && cityOk
      && brandOk
      && bankOk
      && score >= Number(settings.minSlaScore)
      && limitOk;
  });
}

export async function freezePartner(partnerId, frozen) {
  return updateRecord("bankPartners", partnerId, { frozen, active: !frozen });
}
