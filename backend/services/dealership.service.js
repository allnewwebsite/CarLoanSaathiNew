import { createRecord, getRecord, queryRecords, updateRecord, upsertRecord } from "./firestore.service.js";
import { createNotification } from "./notification.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "./timeline.service.js";
import { AUDIT_ACTIONS, writeAuditLog } from "./audit.service.js";
import { getActiveBankBranches, getBankByIFSC } from "./bank.service.js";
import { logInfo } from "./logger.service.js";

/**
 * Get all available bank branches for a dealership to tie up with
 * Automatically loads all approved and active bank branches
 * No static lists - fully dynamic
 */
export async function getAvailableBankBranches() {
  const branches = await getActiveBankBranches();
  return branches.map((branch) => ({
    bankId: branch.bankId,
    ifscCode: branch.ifscCode,
    bankName: branch.bankName,
    branchName: branch.branchName,
    address: branch.address,
    city: branch.city,
    state: branch.state,
    contactPerson: branch.contactPerson,
    phone: branch.phone,
    email: branch.email,
  }));
}

/**
 * Get dealership's current bank tie-ups
 */
export async function getDealershipBankTieUps(dealershipId) {
  const dealership = await getRecord("dealerships", dealershipId);
  if (!dealership) {
    const error = new Error("Dealership not found");
    error.status = 404;
    throw error;
  }

  const tieUpIFSCs = Array.isArray(dealership.bankTieUps) ? dealership.bankTieUps : [];
  
  // If empty, no tie-ups yet
  if (tieUpIFSCs.length === 0) {
    return [];
  }

  // Resolve IFSC codes to full bank details
  const tieUps = [];
  for (const ifscCode of tieUpIFSCs) {
    try {
      const bank = await getBankByIFSC(ifscCode);
      tieUps.push({
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
        addedAt: dealership.bankTieUpDates?.[ifscCode] || dealership.updatedAt,
      });
    } catch (error) {
      // Bank may have been deleted - skip it
      logInfo("Bank tie-up reference not found", { ifscCode, dealershipId });
    }
  }

  return tieUps;
}

/**
 * Add a bank branch tie-up to dealership
 */
export async function addBankTieUp(dealershipId, ifscCode, req = null) {
  const ifsc = String(ifscCode || "").trim().toUpperCase();

  // Verify bank exists and is approved/active
  const bank = await getBankByIFSC(ifsc);
  if (!bank.approved || !bank.active) {
    const error = new Error("Selected bank branch is not available");
    error.status = 400;
    throw error;
  }

  // Get dealership
  const dealership = await getRecord("dealerships", dealershipId);
  if (!dealership) {
    const error = new Error("Dealership not found");
    error.status = 404;
    throw error;
  }

  const currentTieUps = Array.isArray(dealership.bankTieUps) ? dealership.bankTieUps : [];

  // Check if already tied up
  if (currentTieUps.includes(ifsc)) {
    const error = new Error("Bank branch is already tied up with this dealership");
    error.status = 409;
    throw error;
  }

  // Add tie-up
  const updatedTieUps = [...currentTieUps, ifsc];
  const now = new Date().toISOString();
  const updateDate = dealership.bankTieUpDates || {};
  updateDate[ifsc] = now;

  const updated = await updateRecord("dealerships", dealershipId, {
    bankTieUps: updatedTieUps,
    bankTieUpDates: updateDate,
    updatedAt: now,
  });

  // Audit log
  if (req) {
    await writeAuditLog({
      req,
      actionType: "BANK_TIEUP_ADDED",
      newValue: { ifscCode: ifsc, bankName: bank.bankName },
      targetEntity: "dealership",
      targetId: dealershipId,
      dealershipId,
      meta: { ifscCode: ifsc, bankName: bank.bankName },
    });
  }

  // Timeline event
  await addTimelineEvent(
    TIMELINE_EVENTS.BANK_TIEUP_ADDED || "BANK_TIEUP_ADDED",
    `Bank tie-up added: ${bank.bankName} - ${bank.branchName}`,
    {
      dealershipId,
      ifscCode: ifsc,
      bankName: bank.bankName,
      branchName: bank.branchName,
    },
    req
  );

  logInfo("Bank tie-up added", {
    dealershipId,
    ifscCode: ifsc,
    bankName: bank.bankName,
  });

  return {
    dealershipId,
    ifscCode: ifsc,
    bankName: bank.bankName,
    branchName: bank.branchName,
    addedAt: now,
  };
}

/**
 * Remove a bank branch tie-up from dealership
 */
export async function removeBankTieUp(dealershipId, ifscCode, req = null) {
  const ifsc = String(ifscCode || "").trim().toUpperCase();

  const dealership = await getRecord("dealerships", dealershipId);
  if (!dealership) {
    const error = new Error("Dealership not found");
    error.status = 404;
    throw error;
  }

  const currentTieUps = Array.isArray(dealership.bankTieUps) ? dealership.bankTieUps : [];

  if (!currentTieUps.includes(ifsc)) {
    const error = new Error("Bank branch is not tied up with this dealership");
    error.status = 400;
    throw error;
  }

  // Check if any active leads exist with this branch
  const activeLeadsWithBranch = await queryRecords("leads", {
    where: [
      { field: "dealershipId", value: dealershipId },
      { field: "ifscCode", value: ifsc },
      { field: "status", value: "CLOSED", op: "!=" },
    ],
    maxLimit: 1,
  });

  if (activeLeadsWithBranch.data.length > 0) {
    const error = new Error("Cannot remove tie-up while active leads exist with this branch");
    error.status = 409;
    error.code = "ACTIVE_LEADS_WITH_BRANCH";
    throw error;
  }

  // Remove tie-up
  const updatedTieUps = currentTieUps.filter((item) => item !== ifsc);
  const now = new Date().toISOString();

  const updated = await updateRecord("dealerships", dealershipId, {
    bankTieUps: updatedTieUps,
    updatedAt: now,
  });

  // Get bank details for audit
  let bankName = "Unknown";
  try {
    const bank = await getBankByIFSC(ifsc);
    bankName = bank.bankName;
  } catch (error) {
    // Bank may be deleted
  }

  // Audit log
  if (req) {
    await writeAuditLog({
      req,
      actionType: "BANK_TIEUP_REMOVED",
      oldValue: { ifscCode: ifsc, bankName },
      newValue: null,
      targetEntity: "dealership",
      targetId: dealershipId,
      dealershipId,
      meta: { ifscCode: ifsc },
    });
  }

  // Timeline event
  await addTimelineEvent(
    TIMELINE_EVENTS.BANK_TIEUP_REMOVED || "BANK_TIEUP_REMOVED",
    `Bank tie-up removed: ${bankName}`,
    {
      dealershipId,
      ifscCode: ifsc,
    },
    req
  );

  logInfo("Bank tie-up removed", {
    dealershipId,
    ifscCode: ifsc,
  });

  return { dealershipId, ifscCode: ifsc, removed: true };
}

/**
 * Update dealership's bank tie-ups (bulk replace)
 */
export async function updateDealershipBankTieUps(dealershipId, ifscCodes, req = null) {
  const dealership = await getRecord("dealerships", dealershipId);
  if (!dealership) {
    const error = new Error("Dealership not found");
    error.status = 404;
    throw error;
  }

  // Validate all IFSC codes exist and are approved/active
  const validatedCodes = [];
  for (const ifsc of ifscCodes) {
    const normalized = String(ifsc).trim().toUpperCase();
    try {
      const bank = await getBankByIFSC(normalized);
      if (!bank.approved || !bank.active) {
        logInfo("Bank not approved/active, skipping", { ifsc: normalized });
        continue;
      }
      validatedCodes.push(normalized);
    } catch (error) {
      logInfo("Bank IFSC not found", { ifsc: normalized });
    }
  }

  // Remove duplicates
  const uniqueCodes = [...new Set(validatedCodes)];

  // Check for active leads with removed tie-ups
  const currentTieUps = Array.isArray(dealership.bankTieUps) ? dealership.bankTieUps : [];
  const removedIFSCs = currentTieUps.filter((ifsc) => !uniqueCodes.includes(ifsc));

  for (const removedIfsc of removedIFSCs) {
    const activeLeads = await queryRecords("leads", {
      where: [
        { field: "dealershipId", value: dealershipId },
        { field: "ifscCode", value: removedIfsc },
        { field: "status", value: "CLOSED", op: "!=" },
      ],
      maxLimit: 1,
    });

    if (activeLeads.data.length > 0) {
      const error = new Error(`Cannot remove ${removedIfsc} - active leads exist with this branch`);
      error.status = 409;
      error.code = "ACTIVE_LEADS_WITH_REMOVED_BRANCH";
      throw error;
    }
  }

  const now = new Date().toISOString();
  const updateDate = {};
  for (const ifsc of uniqueCodes) {
    updateDate[ifsc] = currentTieUps.includes(ifsc) ? dealership.bankTieUpDates?.[ifsc] : now;
  }

  const updated = await updateRecord("dealerships", dealershipId, {
    bankTieUps: uniqueCodes,
    bankTieUpDates: updateDate,
    updatedAt: now,
  });

  // Audit log
  if (req) {
    await writeAuditLog({
      req,
      actionType: "BANK_TIEUPS_UPDATED",
      oldValue: { count: currentTieUps.length },
      newValue: { count: uniqueCodes.length },
      targetEntity: "dealership",
      targetId: dealershipId,
      dealershipId,
      meta: { added: uniqueCodes.filter((c) => !currentTieUps.includes(c)), removed: removedIFSCs },
    });
  }

  // Get updated tie-ups with full details
  const updatedTieUps = await getDealershipBankTieUps(dealershipId);

  logInfo("Dealership bank tie-ups updated", {
    dealershipId,
    count: uniqueCodes.length,
  });

  return {
    dealershipId,
    bankTieUps: updatedTieUps,
    updatedAt: now,
  };
}

/**
 * Validate that a branch IFSC is in dealership's tie-ups
 */
export async function validateBranchTieUp(dealershipId, ifscCode) {
  const tieUps = await getDealershipBankTieUps(dealershipId);
  const ifsc = String(ifscCode).trim().toUpperCase();

  const match = tieUps.find((t) => t.ifscCode === ifsc);
  if (!match) {
    const error = new Error("Selected bank branch is not tied up with this dealership");
    error.status = 403;
    error.code = "BRANCH_NOT_TIEDUP";
    throw error;
  }

  return match;
}
