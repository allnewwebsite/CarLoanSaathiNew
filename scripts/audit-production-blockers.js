import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assertCheck(name, condition) {
  if (!condition) {
    throw new Error(`FAIL: ${name}`);
  }
  return { check: name, status: "PASS" };
}

const checks = [];
const catalogRoutes = read("backend/routes/catalog.routes.js");
const catalogService = read("backend/services/catalog.service.js");
const adminController = read("backend/controllers/admin.controller.js");
const bankController = read("backend/controllers/bank.controller.js");
const rootPackage = JSON.parse(read("package.json"));
const backendPackage = JSON.parse(read("backend/package.json"));

checks.push(assertCheck(
  "public catalog routes are rate limited",
  catalogRoutes.includes("publicCatalogRateLimit") && catalogRoutes.includes("router.use(publicCatalogRateLimit)"),
));

checks.push(assertCheck(
  "public banks are projected through a sanitizer",
  catalogService.includes("function sanitizePublicBank") && catalogService.includes(".map(sanitizePublicBank)"),
));

checks.push(assertCheck(
  "public banks do not merge raw Firestore bank records",
  !catalogService.includes("mergeCatalog(fallbackBanks, normalizeFirestoreList(records), \"name\")"),
));

checks.push(assertCheck(
  "public branch list requires approved active records",
  catalogService.includes("function activeApproved") && catalogService.includes(".filter(activeApproved)") && catalogService.includes(".map(sanitizePublicBranch)"),
));

checks.push(assertCheck(
  "new approved bank branches carry public approval state",
  adminController.includes("status: \"approved\"") && adminController.includes("approved: true") && adminController.includes("publicStatus: \"approved\""),
));

checks.push(assertCheck(
  "bank executive deletion uses batched cleanup",
  bankController.includes("async function clearExecutiveLeadAssignments") && bankController.includes("for (;;)") && bankController.includes("batchSize = 250"),
));

checks.push(assertCheck(
  "bank executive deletion no longer relies on a single 100-row affected lead page",
  !bankController.includes("const affectedPages = await Promise.all") && !bankController.includes("affectedLeads.length"),
));

checks.push(assertCheck(
  "backup and restore npm scripts are available at root",
  rootPackage.scripts["backup:firestore"] && rootPackage.scripts["restore:firestore"] && rootPackage.scripts["verify:backup"],
));

checks.push(assertCheck(
  "backup and restore npm scripts are available in backend",
  backendPackage.scripts["backup:firestore"] && backendPackage.scripts["restore:firestore"] && backendPackage.scripts["verify:backup"],
));

for (const file of [
  "backend/scripts/backupFirestore.js",
  "backend/scripts/restoreFirestore.js",
  "backend/scripts/verifyBackup.js",
]) {
  checks.push(assertCheck(`${file} exists`, fs.existsSync(path.join(root, file))));
}

console.table(checks);
console.log("Production blocker regression audit passed.");
