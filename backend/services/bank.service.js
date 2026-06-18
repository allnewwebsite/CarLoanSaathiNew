import { getRecord, queryRecords, updateRecord, upsertRecord } from "./firestore.service.js";
import { createNotification } from "./notification.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "./timeline.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "./audit.service.js";
import { logInfo, logWarn, logError } from "./logger.service.js";
import { clearCachedValue } from "./ttlCache.service.js";
import { normalizeIfsc, validateBankLocation } from "./bankLocationMaster.service.js";
import { getActiveBankBranches, getBankByIFSC, validateIFSCCode } from "./bankCatalog.service.js";

export { getActiveBankBranches, getBankByIFSC, validateIFSCCode };

/**
 * Validate IFSC code format and uniqueness
 * @param {string} ifscCode - IFSC code to validate
 * @param {string} excludeBankId - Bank ID to exclude from uniqueness check (for updates)
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
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
