/**
 * Migration: Dynamic Bank Tie-Up System
 * Migrates dealership data from old static system to new dynamic IFSC-based system
 * 
 * Run: node scripts/migrateBankTieUps.js
 */

import { firebaseAdmin } from "../config/firebaseAdmin.js";
import { logInfo } from "../services/logger.service.js";

const db = firebaseAdmin.firestore();

const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/**
 * Get all banks from the new banks collection
 */
async function getAllBanksMap() {
  const snapshot = await db.collection("banks")
    .where("approved", "==", true)
    .where("active", "==", true)
    .get();

  const banksByIfsc = {};
  snapshot.forEach((doc) => {
    const bank = doc.data();
    banksByIfsc[bank.ifscCode] = {
      id: doc.id,
      ifscCode: bank.ifscCode,
      bankName: bank.bankName,
      branchName: bank.branchName,
    };
  });

  return banksByIfsc;
}

/**
 * Convert old bank references to IFSC codes
 */
function extractIFSCCodes(oldData, bankMap) {
  const ifscCodes = [];

  // Try multiple old field names
  const oldBankIds = oldData.dealershipBankPartners || 
                     oldData.bankPartnerIds || 
                     oldData.bankIds || 
                     oldData.bankBranchIds ||
                     [];

  if (Array.isArray(oldBankIds)) {
    for (const oldId of oldBankIds) {
      // Check if it's already an IFSC code
      if (typeof oldId === "string" && IFSC_PATTERN.test(oldId)) {
        ifscCodes.push(oldId);
        continue;
      }

      // Try to find corresponding IFSC in bank map (if oldId maps to a known bank)
      // For now, we skip unknown mappings
      logInfo("Could not map old bank ID to IFSC", { oldId });
    }
  }

  return [...new Set(ifscCodes)]; // Remove duplicates
}

/**
 * Migrate a single dealership
 */
async function migrateDealership(dealershipId, oldData, bankMap) {
  try {
    const ifscCodes = extractIFSCCodes(oldData, bankMap);

    // If no IFSC codes found, skip
    if (ifscCodes.length === 0) {
      return {
        dealershipId,
        status: "skipped",
        reason: "No IFSC codes found",
        oldBankPartnersCount: Array.isArray(oldData.dealershipBankPartners) ? oldData.dealershipBankPartners.length : 0,
      };
    }

    // Validate all IFSC codes exist in new banks collection
    const validIFSCs = [];
    for (const ifsc of ifscCodes) {
      if (bankMap[ifsc]) {
        validIFSCs.push(ifsc);
      } else {
        logInfo("IFSC code not found in banks collection", { ifsc, dealershipId });
      }
    }

    if (validIFSCs.length === 0) {
      return {
        dealershipId,
        status: "failed",
        reason: "No valid IFSC codes after validation",
        originalCount: ifscCodes.length,
      };
    }

    // Update dealership with new structure
    const now = new Date().toISOString();
    const bankTieUpDates = {};
    for (const ifsc of validIFSCs) {
      bankTieUpDates[ifsc] = now;
    }

    await db.collection("dealerships").doc(dealershipId).update({
      bankTieUps: validIFSCs,
      bankTieUpDates: bankTieUpDates,
      migratedAt: now,
      migrationVersion: "1.0",
    });

    return {
      dealershipId,
      status: "success",
      migratedIFSCs: validIFSCs.length,
      migratedBanks: validIFSCs.map((ifsc) => bankMap[ifsc].bankName),
    };
  } catch (error) {
    logInfo("Error migrating dealership", { dealershipId, error: error.message });
    return {
      dealershipId,
      status: "error",
      error: error.message,
    };
  }
}

/**
 * Main migration function
 */
async function runMigration() {
  console.log("🚀 Starting Bank Tie-Up System Migration...\n");

  try {
    // Get all approved and active banks
    console.log("📊 Loading bank reference map...");
    const bankMap = await getAllBanksMap();
    console.log(`✅ Loaded ${Object.keys(bankMap).length} approved bank branches\n`);

    if (Object.keys(bankMap).length === 0) {
      console.error("❌ No approved bank branches found. Cannot migrate without bank references.");
      process.exit(1);
    }

    // Get all dealerships
    console.log("📋 Loading dealerships...");
    const dealershipsSnapshot = await db.collection("dealerships").get();
    console.log(`✅ Found ${dealershipsSnapshot.size} dealerships\n`);

    // Migrate each dealership
    console.log("🔄 Migrating dealerships...\n");
    const results = [];
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    for (const dealershipDoc of dealershipsSnapshot.docs) {
      const dealershipId = dealershipDoc.id;
      const oldData = dealershipDoc.data();

      // Skip if already migrated
      if (oldData.migratedAt) {
        console.log(`⏭️  Skipped ${dealershipId} (already migrated)`);
        skipCount++;
        continue;
      }

      const result = await migrateDealership(dealershipId, oldData, bankMap);
      results.push(result);

      if (result.status === "success") {
        console.log(`✅ ${dealershipId}: Migrated ${result.migratedIFSCs} tie-ups`);
        successCount++;
      } else if (result.status === "skipped") {
        console.log(`⏭️  ${dealershipId}: ${result.reason}`);
        skipCount++;
      } else {
        console.log(`❌ ${dealershipId}: ${result.reason || result.error}`);
        failCount++;
      }
    }

    // Print summary
    console.log("\n" + "=".repeat(60));
    console.log("📊 MIGRATION SUMMARY");
    console.log("=".repeat(60));
    console.log(`✅ Successful:  ${successCount}`);
    console.log(`⏭️  Skipped:     ${skipCount}`);
    console.log(`❌ Failed:      ${failCount}`);
    console.log(`📊 Total:       ${dealershipsSnapshot.size}`);
    console.log("=".repeat(60) + "\n");

    // Save migration report
    const reportPath = "./migration-report.json";
    const report = {
      timestamp: new Date().toISOString(),
      totalDealerships: dealershipsSnapshot.size,
      successful: successCount,
      skipped: skipCount,
      failed: failCount,
      bankBranchesAvailable: Object.keys(bankMap).length,
      details: results,
    };

    const fs = await import("fs");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`📄 Migration report saved to ${reportPath}\n`);

    if (failCount > 0) {
      console.warn("⚠️  Some dealerships failed to migrate. Review migration-report.json for details.");
      process.exit(1);
    } else {
      console.log("✅ Migration completed successfully!");
      process.exit(0);
    }
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run migration
runMigration();
