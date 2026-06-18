import { findRecordsByField, getRecord, queryRecords, upsertRecord } from "./firestore.service.js";
import { cached } from "./ttlCache.service.js";
import { normalizeIfsc } from "./bankLocationMaster.service.js";

export async function boundedBankSourceRecords(collection) {
  const fields = ["id", "bankId", "ifscCode", "ifsc", "bankIfsc", "bankName", "name", "companyName", "branchName", "branchLocation", "bankBranchLocation", "city", "branchCity", "state", "contactPerson", "managerName", "phone", "mobile", "email", "officialEmail", "approved", "active", "status", "approvalStatus", "approvedAt", "createdAt", "updatedAt"];
  for (const where of [
    [{ field: "approvalStatus", value: "approved" }],
    [{ field: "approved", value: true }],
    [{ field: "status", value: "active" }],
  ]) {
    const page = await queryRecords(collection, { where, limit: 50, maxLimit: 50, fields }).catch(() => ({ data: [] }));
    if (page.data?.length) return page.data;
  }
  return [];
}

export async function validateIFSCCode(ifscCode, excludeBankId = null) {
  const normalized = normalizeIfsc(ifscCode);

  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalized)) {
    return { valid: false, error: "IFSC code format invalid. Must be 11 characters: 4 letters + 0 + 6 alphanumeric characters (e.g., HDFC0001234)" };
  }

  const allowedExistingIds = new Set([String(excludeBankId || "").trim()].filter(Boolean));
  const directMatches = await Promise.all([
    getRecord("banks", normalized).catch(() => null),
    getRecord("branches", normalized).catch(() => null),
    getRecord("bankPartners", normalized).catch(() => null),
    getRecord("pendingBankApprovals", normalized).catch(() => null),
  ]);
  const fieldMatches = await Promise.all([
    findRecordsByField("banks", "ifscCode", normalized, 3).catch(() => []),
    findRecordsByField("branches", "ifscCode", normalized, 3).catch(() => []),
    findRecordsByField("bankPartners", "ifscCode", normalized, 3).catch(() => []),
    findRecordsByField("pendingBankApprovals", "ifsc", normalized, 3).catch(() => []),
  ]);
  const existingRows = [...directMatches.filter(Boolean), ...fieldMatches.flat()];
  for (const existing of existingRows) {
    const status = String(existing.status || existing.approvalStatus || "").toLowerCase();
    if (["rejected", "deleted", "removed"].includes(status)) continue;
    const ids = [existing.id, existing.bankId, existing.branchId, existing.bankPartnerId, existing.ifscCode, existing.ifsc, existing.branchIfsc]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    if (!ids.some((id) => allowedExistingIds.has(id))) {
      return { valid: false, error: `IFSC code ${normalized} is already registered` };
    }
  }

  return { valid: true };
}

export async function getActiveBankBranches() {
  return cached("bank:active-branches:v2", 60000, async () => {
  const catalog = await queryRecords("bankBranchCatalog", {
    where: [{ field: "approved", value: true }],
    orderBy: "bankName",
    direction: "asc",
    limit: 100,
    maxLimit: 100,
    fields: ["id", "bankId", "branchId", "bankBranchId", "ifscCode", "bankName", "branchName", "address", "city", "state", "contactPerson", "phone", "email", "approved", "active", "approvalStatus", "approvedAt"],
  }).catch(() => ({ data: [] }));
  const catalogRows = (catalog.data || [])
    .filter((bank) => bank.active !== false && bank.ifscCode && bank.bankName && bank.branchName)
    .map((bank) => ({
      bankId: bank.bankId || bank.id || bank.ifscCode,
      id: bank.id || bank.ifscCode,
      ifscCode: bank.ifscCode,
      bankName: bank.bankName,
      branchName: bank.branchName,
      address: bank.address || "",
      city: bank.city || "",
      state: bank.state || "Haryana",
      contactPerson: bank.contactPerson || "",
      phone: bank.phone || "",
      email: bank.email || "",
      approvedAt: bank.approvedAt || null,
      approvalStatus: bank.approvalStatus || "approved",
      approved: true,
      active: true,
    }));
  if (catalogRows.length) {
    return catalogRows.sort((left, right) => `${left.bankName} ${left.ifscCode}`.localeCompare(`${right.bankName} ${right.ifscCode}`));
  }
  const [banks, bankPartners, branches, branchManagers, pendingBankApprovals] = await Promise.all([
    boundedBankSourceRecords("banks"),
    boundedBankSourceRecords("bankPartners"),
    boundedBankSourceRecords("branches"),
    boundedBankSourceRecords("branchManagers"),
    Promise.all([
      queryRecords("pendingBankApprovals", { where: [{ field: "approvalStatus", value: "approved" }], limit: 50, maxLimit: 50 }).catch(() => ({ data: [] })),
      queryRecords("pendingBankApprovals", { where: [{ field: "status", value: "approved" }], limit: 50, maxLimit: 50 }).catch(() => ({ data: [] })),
      queryRecords("pendingBankApprovals", { where: [{ field: "status", value: "active" }], limit: 50, maxLimit: 50 }).catch(() => ({ data: [] })),
    ]).then((pages) => [...new Map(pages.flatMap((page) => page.data || []).map((item) => [item.id, item])).values()]),
  ]);

  const normalizeBank = (bank) => {
      const ifscCode = String(bank.ifscCode || bank.ifsc || bank.bankIfsc || "").trim().toUpperCase();
      const bankName = String(bank.bankName || bank.name || bank.companyName || "").trim();
      const branchName = String(bank.branchName || bank.branchLocation || bank.bankBranchLocation || bank.city || "").trim();
      return {
        bankId: bank.bankId || bank.id || ifscCode,
        id: bank.id || ifscCode,
        ifscCode,
        bankName,
        branchName,
        address: bank.address || "",
        city: String(bank.city || bank.branchCity || bank.branchLocation || bank.bankBranchLocation || "").trim(),
        state: String(bank.state || "Haryana").trim(),
        contactPerson: bank.contactPerson || bank.managerName || "",
        phone: bank.phone || bank.mobile || "",
        email: bank.email || bank.officialEmail || "",
        approvedAt: bank.approvedAt || null,
        approvalStatus: bank.approvalStatus || bank.status || (bank.approved ? "approved" : "pending"),
        approved: bank.approved === true || String(bank.status || "").toLowerCase() === "active",
        active: bank.active !== false && String(bank.status || "active").toLowerCase() !== "suspended",
      };
  };

  const approvedApprovals = pendingBankApprovals
    .filter((item) => ["approved", "active"].includes(String(item.status || item.approvalStatus || "").toLowerCase()))
    .map((item) => ({ ...item, approved: true, active: true }));

  const records = [
    ...banks,
    ...bankPartners,
    ...branches,
    ...branchManagers,
    ...approvedApprovals,
  ];

  const byIfsc = new Map();
  for (const row of catalogRows) {
    const bank = normalizeBank(row);
    if (!bank.approved || !bank.active || !bank.ifscCode || !bank.bankName || !bank.branchName) continue;
    byIfsc.set(bank.ifscCode, {
      ...bank,
      bankId: bank.bankId || bank.id || bank.ifscCode,
      id: bank.id || bank.ifscCode,
      approved: true,
      active: true,
      approvalStatus: "approved",
    });
  }
  for (const record of records) {
    const bank = normalizeBank(record);
    if (!bank.approved || !bank.active || !bank.ifscCode || !bank.bankName || !bank.branchName) continue;
    const existing = byIfsc.get(bank.ifscCode);
    byIfsc.set(bank.ifscCode, {
      ...bank,
      ...existing,
      bankId: existing?.bankId || bank.bankId,
      id: existing?.id || bank.id,
      bankName: existing?.bankName || bank.bankName,
      branchName: existing?.branchName || bank.branchName,
      city: existing?.city || bank.city,
      state: existing?.state || bank.state,
      email: existing?.email || bank.email,
      phone: existing?.phone || bank.phone,
      contactPerson: existing?.contactPerson || bank.contactPerson,
      approvedAt: existing?.approvedAt || bank.approvedAt,
      approved: true,
      active: true,
      approvalStatus: "approved",
    });
  }

  const rows = [...byIfsc.values()]
    .sort((left, right) => `${left.bankName} ${left.ifscCode}`.localeCompare(`${right.bankName} ${right.ifscCode}`));
  await Promise.all(rows.map((bank) => upsertRecord("bankBranchCatalog", bank.ifscCode, {
    id: bank.ifscCode,
    sourceCollection: "bank-catalog-recovery",
    sourceId: bank.id || bank.bankId || bank.ifscCode,
    bankId: bank.bankId || bank.id || bank.ifscCode,
    branchId: bank.branchId || bank.bankBranchId || bank.id || bank.ifscCode,
    bankBranchId: bank.bankBranchId || bank.branchId || bank.id || bank.ifscCode,
    ifscCode: bank.ifscCode,
    bankName: bank.bankName,
    branchName: bank.branchName,
    address: bank.address || "",
    city: bank.city || "",
    state: bank.state || "Haryana",
    contactPerson: bank.contactPerson || "",
    phone: bank.phone || "",
    email: bank.email || "",
    approvalStatus: "approved",
    approved: true,
    active: true,
    approvedAt: bank.approvedAt || null,
    createdAt: bank.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }).catch(() => null)));
  return rows;
  });
}

export async function getBankByIFSC(ifscCode) {
  const ifsc = String(ifscCode || "").trim().toUpperCase();
  const bank = (await getActiveBankBranches()).find((item) => item.ifscCode === ifsc);

  if (!bank) {
    const error = new Error(`Bank with IFSC ${ifsc} not found`);
    error.status = 404;
    throw error;
  }

  return bank;
}
