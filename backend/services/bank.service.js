import { findRecordsByField, getRecord, queryRecords, updateRecord, upsertRecord, deleteRecord } from "./firestore.service.js";
import { createNotification } from "./notification.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "./timeline.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "./audit.service.js";
import { logInfo, logWarn, logError } from "./logger.service.js";
import { cached, clearCachedValue } from "./ttlCache.service.js";
import { normalizeIfsc, validateBankLocation } from "./bankLocationMaster.service.js";

async function boundedBankSourceRecords(collection) {
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

/**
 * Validate IFSC code format and uniqueness
 * @param {string} ifscCode - IFSC code to validate
 * @param {string} excludeBankId - Bank ID to exclude from uniqueness check (for updates)
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
export async function validateIFSCCode(ifscCode, excludeBankId = null) {
  const normalized = normalizeIfsc(ifscCode);
  
  // IFSC format: 4 letters + 0 + 6 digits = 11 characters total
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

/**
 * Create or register a new bank branch
 */
export async function registerBankBranch(payload, req = null) {
  const ifscCode = normalizeIfsc(payload.ifscCode);
  const bankName = String(payload.bankName || "").trim();
  const location = validateBankLocation({ state: payload.state || "Haryana", location: payload.city || payload.branchName });
  const branchName = location.location || String(payload.branchName || "").trim();

  // Validate required fields
  if (!ifscCode) throw new Error("IFSC code is required");
  if (!bankName) throw new Error("Bank name is required");
  if (!branchName) throw new Error("Branch name is required");
  if (!location.valid) {
    const error = new Error("Supported state and bank branch location are required");
    error.status = 400;
    error.code = "INVALID_BRANCH_LOCATION";
    throw error;
  }

  // Validate IFSC format and uniqueness
  const ifscValidation = await validateIFSCCode(ifscCode);
  if (!ifscValidation.valid) {
    const error = new Error(ifscValidation.error);
    error.status = 400;
    error.code = "IFSC_VALIDATION_FAILED";
    throw error;
  }

  const now = new Date().toISOString();
  const bankId = ifscCode;

  const bankData = {
    id: bankId,
    bankId,
    branchId: bankId,
    bankBranchId: bankId,
    ifscCode,
    ifsc: ifscCode,
    bankIfsc: ifscCode,
    branchIfsc: ifscCode,
    bankName,
    branchName,
    branchLocation: branchName,
    bankBranchLocation: branchName,
    address: String(payload.address || "").trim(),
    contactPerson: String(payload.contactPerson || "").trim(),
    phone: String(payload.phone || "").trim(),
    email: String(payload.email || "").trim(),
    city: branchName,
    branchCity: branchName,
    state: location.state,
    serviceArea: branchName,
    active: payload.active !== false,
    approved: payload.approved === true ? true : false, // Requires admin approval
    status: payload.approved === true ? "active" : "pending",
    approvalStatus: payload.approved === true ? "approved" : "pending",
    registeredAt: now,
    approvedAt: payload.approved === true ? now : null,
    updatedAt: now,
  };

  const bank = await upsertRecord("banks", bankId, bankData);
  await upsertRecord("branches", bankId, {
    ...bankData,
    sourceCollection: "banks",
    sourceId: bankId,
    publicStatus: bankData.approvalStatus,
  });

  // Audit log
  if (req) {
    await writeAuditLog({
      req,
      actionType: AUDIT_ACTIONS.BANK_REGISTERED || "BANK_REGISTERED",
      newValue: { ifscCode, bankName, branchName },
      targetEntity: "bank",
      targetId: bank.id,
      meta: { bankId: bank.id, ifscCode },
    });
  }

  logInfo("Bank branch registered", {
    bankId: bank.id,
    ifscCode,
    bankName,
    branchName,
    approved: bank.approved,
  });
  clearCachedValue("bank:active-branches");
  clearCachedValue("bank:active-branches:v2");
  clearCachedValue("bank-branch-catalog:available:");

  return bank;
}

/**
 * Approve a bank branch (admin action)
 */
export async function approveBankBranch(bankId, req = null) {
  const bank = await getRecord("banks", bankId);
  if (!bank) {
    const error = new Error("Bank not found");
    error.status = 404;
    throw error;
  }

  const now = new Date().toISOString();
  const updated = await updateRecord("banks", bankId, {
    approved: true,
    active: true,
    status: "active",
    approvalStatus: "approved",
    approvedAt: now,
    updatedAt: now,
  });
  await upsertRecord("branches", bankId, {
    id: bankId,
    bankId,
    branchId: bankId,
    bankBranchId: bankId,
    ifscCode: bank.ifscCode || bankId,
    ifsc: bank.ifscCode || bankId,
    bankIfsc: bank.ifscCode || bankId,
    branchIfsc: bank.ifscCode || bankId,
    bankName: bank.bankName,
    branchName: bank.branchName,
    branchLocation: bank.branchLocation || bank.branchName || bank.city || "",
    bankBranchLocation: bank.bankBranchLocation || bank.branchName || bank.city || "",
    city: bank.city || bank.branchName || "",
    branchCity: bank.branchCity || bank.branchName || bank.city || "",
    state: bank.state || "Haryana",
    serviceArea: bank.serviceArea || bank.branchName || bank.city || "",
    approved: true,
    active: true,
    status: "approved",
    approvalStatus: "approved",
    publicStatus: "approved",
    approvedAt: now,
  });
  await upsertRecord("bankPartners", bankId, {
    id: bankId,
    bankId,
    bankPartnerId: bankId,
    branchId: bankId,
    ifscCode: bank.ifscCode || bankId,
    ifsc: bank.ifscCode || bankId,
    bankIfsc: bank.ifscCode || bankId,
    branchIfsc: bank.ifscCode || bankId,
    bankName: bank.bankName,
    branchName: bank.branchName,
    branchLocation: bank.branchLocation || bank.branchName || bank.city || "",
    bankBranchLocation: bank.bankBranchLocation || bank.branchName || bank.city || "",
    city: bank.city || bank.branchName || "",
    state: bank.state || "Haryana",
    email: bank.email || "",
    officialEmail: bank.email || "",
    approved: true,
    active: true,
    status: "active",
    approvalStatus: "approved",
    approvedAt: now,
  });

  // Audit log
  if (req) {
    await writeAuditLog({
      req,
      actionType: "BANK_APPROVED",
      oldValue: { approved: bank.approved },
      newValue: { approved: true },
      targetEntity: "bank",
      targetId: bankId,
      meta: { bankId, ifscCode: bank.ifscCode },
    });
  }

  // Notify dealerships - they will see this bank in their available tie-ups
  logInfo("Bank branch approved", {
    bankId,
    ifscCode: bank.ifscCode,
    bankName: bank.bankName,
  });
  clearCachedValue("bank:active-branches");
  clearCachedValue("bank:active-branches:v2");
  clearCachedValue("bank-branch-catalog:available:");

  return updated;
}

/**
 * Deactivate a bank branch
 */
export async function deactivateBankBranch(bankId, reason = "", req = null) {
  const bank = await getRecord("banks", bankId);
  if (!bank) {
    const error = new Error("Bank not found");
    error.status = 404;
    throw error;
  }

  const now = new Date().toISOString();
  const updated = await updateRecord("banks", bankId, {
    active: false,
    status: "disabled",
    approvalStatus: "disabled",
    updatedAt: now,
    deactivationReason: reason,
    deactivatedAt: now,
  });
  await upsertRecord("branches", bankId, {
    active: false,
    status: "disabled",
    approvalStatus: "disabled",
    publicStatus: "disabled",
    deactivationReason: reason,
    deactivatedAt: now,
  });
  await upsertRecord("bankPartners", bankId, {
    active: false,
    status: "disabled",
    approvalStatus: "disabled",
    deactivationReason: reason,
    deactivatedAt: now,
  });

  // Audit log
  if (req) {
    await writeAuditLog({
      req,
      actionType: "BANK_DEACTIVATED",
      oldValue: { active: true },
      newValue: { active: false },
      targetEntity: "bank",
      targetId: bankId,
      meta: { bankId, ifscCode: bank.ifscCode, reason },
    });
  }

  logInfo("Bank branch deactivated", {
    bankId,
    ifscCode: bank.ifscCode,
    reason,
  });
  clearCachedValue("bank:active-branches");
  clearCachedValue("bank:active-branches:v2");
  clearCachedValue("bank-branch-catalog:available:");

  return updated;
}

/**
 * Get all approved and active banks
 */
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

/**
 * Get bank details by IFSC code
 */
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

/**
 * Get all banks (for admin)
 */
export async function getAllBanks(filters = {}) {
  let where = [];

  if (filters.approved !== undefined) {
    where.push({ field: "approved", value: filters.approved });
  }

  if (filters.active !== undefined) {
    where.push({ field: "active", value: filters.active });
  }

  const banks = await queryRecords("banks", {
    where,
    orderBy: filters.orderBy || "bankName",
    direction: filters.direction || "asc",
    limit: filters.limit || 50,
    cursor: filters.cursor || null,
    page: filters.page || null,
    maxLimit: 100,
  });

  return banks;
}

/**
 * Update bank branch information
 */
export async function updateBankBranch(bankId, payload, req = null) {
  const bank = await getRecord("banks", bankId);
  if (!bank) {
    const error = new Error("Bank not found");
    error.status = 404;
    throw error;
  }

  // If IFSC code is being changed, validate the new one
  if (payload.ifscCode && String(payload.ifscCode || "").trim().toUpperCase() !== bank.ifscCode) {
    const ifscValidation = await validateIFSCCode(payload.ifscCode, bankId);
    if (!ifscValidation.valid) {
      const error = new Error(ifscValidation.error);
      error.status = 400;
      throw error;
    }
  }

  const now = new Date().toISOString();
  const updateData = {
    bankName: payload.bankName !== undefined ? String(payload.bankName).trim() : bank.bankName,
    branchName: payload.branchName !== undefined ? String(payload.branchName).trim() : bank.branchName,
    address: payload.address !== undefined ? String(payload.address).trim() : bank.address,
    city: payload.city !== undefined ? String(payload.city).trim() : bank.city,
    state: payload.state !== undefined ? String(payload.state).trim() : bank.state,
    contactPerson: payload.contactPerson !== undefined ? String(payload.contactPerson).trim() : bank.contactPerson,
    phone: payload.phone !== undefined ? String(payload.phone).trim() : bank.phone,
    email: payload.email !== undefined ? String(payload.email).trim() : bank.email,
    updatedAt: now,
  };

  const updated = await updateRecord("banks", bankId, updateData);
  await upsertRecord("branches", bankId, {
    ...updateData,
    branchLocation: updateData.branchName || bank.branchLocation || bank.branchName || "",
    bankBranchLocation: updateData.branchName || bank.bankBranchLocation || bank.branchName || "",
    branchCity: updateData.city || updateData.branchName || bank.branchCity || bank.city || "",
    serviceArea: updateData.city || updateData.branchName || bank.serviceArea || bank.city || "",
  });
  await upsertRecord("bankPartners", bankId, {
    ...updateData,
    branchLocation: updateData.branchName || bank.branchLocation || bank.branchName || "",
    bankBranchLocation: updateData.branchName || bank.bankBranchLocation || bank.branchName || "",
    serviceArea: updateData.city || updateData.branchName || bank.serviceArea || bank.city || "",
  });

  // Audit log
  if (req) {
    await writeAuditLog({
      req,
      actionType: "BANK_UPDATED",
      oldValue: { bankName: bank.bankName, branchName: bank.branchName },
      newValue: { bankName: updateData.bankName, branchName: updateData.branchName },
      targetEntity: "bank",
      targetId: bankId,
      meta: { bankId, ifscCode: bank.ifscCode },
    });
  }
  clearCachedValue("bank:active-branches");
  clearCachedValue("bank:active-branches:v2");
  clearCachedValue("bank-branch-catalog:available:");

  return updated;
}
