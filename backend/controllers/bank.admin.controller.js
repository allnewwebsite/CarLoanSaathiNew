import {
  registerBankBranch,
  approveBankBranch,
  deactivateBankBranch,
  getAllBanks,
  getBankByIFSC,
  updateBankBranch,
  validateIFSCCode,
} from "../services/bank.service.js";
import { createNotification } from "../services/notification.service.js";
import { writeAuditLog, AUDIT_ACTIONS } from "../services/audit.service.js";
import { addTimelineEvent, TIMELINE_EVENTS } from "../services/timeline.service.js";
import { logInfo } from "../services/logger.service.js";
import { cached } from "../services/ttlCache.service.js";
import { paginationParams } from "../utils/pagination.js";
import { recordMonitoringSignal } from "../services/monitoringCenter.service.js";

function logReadMetric(event, req, meta = {}) {
  recordMonitoringSignal(event, { endpoint: meta.endpoint || req.route?.path, path: req.originalUrl, ...meta });
  logInfo(event, {
    tag: event,
    requestId: req.requestId,
    path: req.originalUrl,
    ...meta,
  });
}

/**
 * Bank Branch Management - Admin endpoints
 * Dynamic IFSC-based bank registration and approval workflow
 */

/**
 * Register a new bank branch (admin endpoint)
 * Validation at admin level before bank is visible to dealerships
 */
export async function registerBankBranchAdmin(req, res, next) {
  try {
    const payload = {
      ifscCode: String(req.body.ifscCode || "").trim().toUpperCase(),
      bankName: String(req.body.bankName || "").trim(),
      branchName: String(req.body.branchName || "").trim(),
      address: String(req.body.address || "").trim(),
      city: String(req.body.city || "").trim(),
      state: String(req.body.state || "").trim(),
      contactPerson: String(req.body.contactPerson || "").trim(),
      phone: String(req.body.phone || "").trim(),
      email: String(req.body.email || "").trim().toLowerCase(),
    };

    // Validate required fields
    if (!payload.ifscCode || !payload.bankName || !payload.branchName || !payload.email) {
      return res.status(400).json({
        message: "Missing required fields: ifscCode, bankName, branchName, email",
        code: "MISSING_FIELDS",
      });
    }

    // Register bank branch
    const bank = await registerBankBranch(payload, req);

    res.status(201).json({
      success: true,
      message: "Bank branch registered successfully (pending approval)",
      bank,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        message: error.message,
        code: error.code || "REGISTRATION_ERROR",
      });
    }
    next(error);
  }
}

/**
 * Approve a bank branch for dealership tie-ups
 */
export async function approveBankBranchAdmin(req, res, next) {
  try {
    const bankId = String(req.params.bankId || "").trim();
    if (!bankId) {
      return res.status(400).json({ message: "Bank ID required" });
    }

    const bank = await approveBankBranch(bankId, req);

    // Send notification to bank manager
    if (bank.email) {
      await createNotification({
        recipientEmail: bank.email,
        title: "Bank Branch Approved",
        message: `Your bank branch ${bank.bankName} - ${bank.branchName} (${bank.ifscCode}) has been approved and is now available for dealership tie-ups.`,
        type: "BANK_APPROVED",
        priority: "HIGH",
      }).catch(() => {});
    }

    logInfo("Bank branch approved", {
      bankId,
      ifscCode: bank.ifscCode,
      bankName: bank.bankName,
    });

    res.json({
      success: true,
      message: "Bank branch approved successfully",
      bank,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        message: error.message,
        code: error.code || "APPROVAL_ERROR",
      });
    }
    next(error);
  }
}

/**
 * Reject a bank branch registration
 */
export async function rejectBankBranchAdmin(req, res, next) {
  try {
    const bankId = String(req.params.bankId || "").trim();
    const reason = String(req.body.reason || "Rejected by admin").trim();

    if (!bankId) {
      return res.status(400).json({ message: "Bank ID required" });
    }

    // Deactivate with rejection reason
    const bank = await deactivateBankBranch(bankId, reason, req);

    // Send notification
    if (bank.email) {
      await createNotification({
        recipientEmail: bank.email,
        title: "Bank Branch Rejected",
        message: `Your bank branch registration has been rejected. Reason: ${reason}`,
        type: "BANK_REJECTED",
        priority: "MEDIUM",
      }).catch(() => {});
    }

    logInfo("Bank branch rejected", {
      bankId,
      ifscCode: bank.ifscCode,
      reason,
    });

    res.json({
      success: true,
      message: "Bank branch rejected",
      bank,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        message: error.message,
        code: error.code || "REJECTION_ERROR",
      });
    }
    next(error);
  }
}

/**
 * Deactivate a bank branch
 */
export async function deactivateBankBranchAdmin(req, res, next) {
  try {
    const bankId = String(req.params.bankId || "").trim();
    const reason = String(req.body.reason || "Deactivated by admin").trim();

    if (!bankId) {
      return res.status(400).json({ message: "Bank ID required" });
    }

    const bank = await deactivateBankBranch(bankId, reason, req);

    logInfo("Bank branch deactivated", {
      bankId,
      ifscCode: bank.ifscCode,
      reason,
    });

    res.json({
      success: true,
      message: "Bank branch deactivated",
      bank,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        message: error.message,
        code: error.code || "DEACTIVATION_ERROR",
      });
    }
    next(error);
  }
}

/**
 * Get all bank branches with filtering
 */
export async function getAdminBankBranches(req, res, next) {
  try {
    const beforeReads = Number(req.query.limit || 100);
    logReadMetric("READS-BEFORE", req, { endpoint: "GET /api/admin/bank-branches", estimatedReads: Math.min(Math.max(beforeReads, 1), 5000), previousMaxReads: 5000 });
    const filters = {};
    if (req.query.approved !== undefined) {
      filters.approved = req.query.approved === "true";
    }
    if (req.query.active !== undefined) {
      filters.active = req.query.active === "true";
    }
    if (req.query.city) {
      filters.city = String(req.query.city).trim();
    }
    if (req.query.state) {
      filters.state = String(req.query.state).trim();
    }
    if (req.query.bankName) {
      filters.bankName = String(req.query.bankName).trim();
    }
    const { limit, cursor, page } = paginationParams(req.query, { defaultLimit: 50, maxLimit: 100 });
    filters.limit = limit;
    filters.cursor = cursor;
    filters.page = page;

    const cacheKey = `admin:bank-branches:${JSON.stringify(filters)}`;
    let cacheHit = true;
    const pageResult = await cached(cacheKey, 30000, async () => {
      cacheHit = false;
      return getAllBanks(filters);
    });
    if (cacheHit) logReadMetric("CACHE-HIT", req, { endpoint: "GET /api/admin/bank-branches", cacheKey });
    logReadMetric("READS-AFTER", req, { endpoint: "GET /api/admin/bank-branches", estimatedReads: cacheHit ? 0 : limit, limit });
    const banks = Array.isArray(pageResult?.data) ? pageResult.data : Array.isArray(pageResult) ? pageResult : [];

    res.json({
      success: true,
      totalBranches: banks.length,
      banks,
      filters,
      limit,
      nextCursor: pageResult?.nextCursor || null,
      hasMore: Boolean(pageResult?.nextCursor),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get single bank branch details
 */
export async function getBankBranchDetailsAdmin(req, res, next) {
  try {
    const bankId = String(req.params.bankId || "").trim();
    if (!bankId) {
      return res.status(400).json({ message: "Bank ID required" });
    }

    const bank = await getBankByIFSC(bankId);

    res.json({
      success: true,
      bank,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        message: error.message,
        code: error.code || "NOT_FOUND",
      });
    }
    next(error);
  }
}

/**
 * Update bank branch details
 */
export async function updateBankBranchAdmin(req, res, next) {
  try {
    const bankId = String(req.params.bankId || "").trim();
    if (!bankId) {
      return res.status(400).json({ message: "Bank ID required" });
    }

    const payload = {};
    if (req.body.branchName) payload.branchName = String(req.body.branchName).trim();
    if (req.body.address) payload.address = String(req.body.address).trim();
    if (req.body.city) payload.city = String(req.body.city).trim();
    if (req.body.state) payload.state = String(req.body.state).trim();
    if (req.body.contactPerson) payload.contactPerson = String(req.body.contactPerson).trim();
    if (req.body.phone) payload.phone = String(req.body.phone).trim();
    if (req.body.email) payload.email = String(req.body.email).trim().toLowerCase();

    if (req.body.ifscCode) {
      // If updating IFSC, validate it doesn't already exist
      const newIfsc = String(req.body.ifscCode).trim().toUpperCase();
      await validateIFSCCode(newIfsc, bankId);
      payload.ifscCode = newIfsc;
    }

    const bank = await updateBankBranch(bankId, payload, req);

    logInfo("Bank branch updated", {
      bankId,
      ifscCode: bank.ifscCode,
      fields: Object.keys(payload),
    });

    res.json({
      success: true,
      message: "Bank branch updated",
      bank,
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        message: error.message,
        code: error.code || "UPDATE_ERROR",
      });
    }
    next(error);
  }
}
