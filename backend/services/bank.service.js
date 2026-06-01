import { createRecord, getRecord, queryRecords, updateRecord, upsertRecord, deleteRecord } from "./firestore.service.js";
import { createNotification } from "./notification.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "./timeline.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "./audit.service.js";
import { logInfo, logWarn, logError } from "./logger.service.js";

/**
 * Validate IFSC code format and uniqueness
 * @param {string} ifscCode - IFSC code to validate
 * @param {string} excludeBankId - Bank ID to exclude from uniqueness check (for updates)
 * @returns {Promise<{valid: boolean, error?: string}>}
 */
export async function validateIFSCCode(ifscCode, excludeBankId = null) {
  const normalized = String(ifscCode || "").trim().toUpperCase();
  
  // IFSC format: 4 letters + 0 + 6 digits = 11 characters total
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalized)) {
    return { valid: false, error: "IFSC code format invalid. Must be 11 characters: 4 letters + 0 + 6 alphanumeric characters (e.g., HDFC0001234)" };
  }

  // Check uniqueness
  const existingBanks = await queryRecords("banks", {
    where: [{ field: "ifscCode", value: normalized }],
    maxLimit: 1,
  });

  if (existingBanks.data.length > 0) {
    const existing = existingBanks.data[0];
    if (!excludeBankId || existing.id !== excludeBankId) {
      return { valid: false, error: `IFSC code ${normalized} is already registered` };
    }
  }

  return { valid: true };
}

/**
 * Create or register a new bank branch
 */
export async function registerBankBranch(payload, req = null) {
  const ifscCode = String(payload.ifscCode || "").trim().toUpperCase();
  const bankName = String(payload.bankName || "").trim();
  const branchName = String(payload.branchName || "").trim();

  // Validate required fields
  if (!ifscCode) throw new Error("IFSC code is required");
  if (!bankName) throw new Error("Bank name is required");
  if (!branchName) throw new Error("Branch name is required");

  // Validate IFSC format and uniqueness
  const ifscValidation = await validateIFSCCode(ifscCode);
  if (!ifscValidation.valid) {
    const error = new Error(ifscValidation.error);
    error.status = 400;
    error.code = "IFSC_VALIDATION_FAILED";
    throw error;
  }

  const now = new Date().toISOString();
  const bankId = `bank-${ifscCode}-${Date.now()}`;

  const bankData = {
    bankId,
    ifscCode,
    bankName,
    branchName,
    address: String(payload.address || "").trim(),
    contactPerson: String(payload.contactPerson || "").trim(),
    phone: String(payload.phone || "").trim(),
    email: String(payload.email || "").trim(),
    city: String(payload.city || "").trim(),
    state: String(payload.state || "").trim(),
    active: payload.active !== false,
    approved: payload.approved === true ? true : false, // Requires admin approval
    registeredAt: now,
    approvedAt: payload.approved === true ? now : null,
    updatedAt: now,
  };

  const bank = await createRecord("banks", bankData);

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
    approvedAt: now,
    updatedAt: now,
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
    updatedAt: now,
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

  return updated;
}

/**
 * Get all approved and active banks
 */
export async function getActiveBankBranches() {
  const banks = await queryRecords("banks", {
    where: [
      { field: "approved", value: true },
      { field: "active", value: true },
    ],
    orderBy: "bankName",
    direction: "asc",
    maxLimit: 5000,
  });

  return banks.data.map((bank) => ({
    bankId: bank.id,
    ifscCode: bank.ifscCode,
    bankName: bank.bankName,
    branchName: bank.branchName,
    address: bank.address,
    city: bank.city,
    state: bank.state,
    contactPerson: bank.contactPerson,
    phone: bank.phone,
    email: bank.email,
    approvedAt: bank.approvedAt,
  }));
}

/**
 * Get bank details by IFSC code
 */
export async function getBankByIFSC(ifscCode) {
  const ifsc = String(ifscCode || "").trim().toUpperCase();
  const banks = await queryRecords("banks", {
    where: [{ field: "ifscCode", value: ifsc }],
    maxLimit: 1,
  });

  if (banks.data.length === 0) {
    const error = new Error(`Bank with IFSC ${ifsc} not found`);
    error.status = 404;
    throw error;
  }

  return banks.data[0];
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
    limit: filters.limit || 100,
    maxLimit: 5000,
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

  return updated;
}
