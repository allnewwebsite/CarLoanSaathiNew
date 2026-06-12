import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { firebaseAdmin, firestore } from "../firebase/admin.js";

const APPLY = process.env.APPLY_SM_TO_GM_MIGRATION === "true";
const LEGACY_ROLE_VALUES = [
  "gm-sm",
  "GM-SM",
  "sm",
  "SM",
  "sales-manager",
  "sales_manager",
  "sales manager",
  "Sales Manager",
];
const LEGACY_LABEL_VALUES = ["SM", "Sales Manager", "GM / SM", "GM/SM"];
const ROLE_COLLECTIONS = [
  "users",
  "dealerStaff",
  "financeDesks",
  "financeDesk",
  "staffViewProjection",
  "gmViews",
  "workflowLogViews",
  "workflowLogArchives",
];
const NOTIFICATION_COLLECTIONS = ["notifications", "notificationEvents", "notificationLogs"];
const REPORT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migration-reports");

function timestamp() {
  return new Date().toISOString();
}

function migrationPatch(collection, field) {
  if (collection === "dealershipManagers") {
    return { role: "General Manager", roleLabel: "GM" };
  }
  if (collection === "userSessions") {
    return {
      role: "gm",
      revoked: true,
      revokedAt: timestamp(),
      revokeReason: "sm-role-removed",
    };
  }
  if (field === "roleLabel") return { roleLabel: "GM" };
  return {
    [field]: "gm",
    ...(field === "role" ? { roleLabel: "GM" } : {}),
  };
}

function queryKey(collection, field, value) {
  return `${collection}:${field}:${value}`;
}

async function findMatches(collection, field, values) {
  const matches = [];
  for (const value of values) {
    const snapshot = await firestore.collection(collection).where(field, "==", value).get();
    snapshot.docs.forEach((doc) => matches.push({
      ref: doc.ref,
      collection,
      id: doc.id,
      field,
      value,
      data: doc.data(),
    }));
  }
  return matches;
}

async function collectMatches() {
  const searches = [];
  ROLE_COLLECTIONS.forEach((collection) => {
    searches.push(findMatches(collection, "role", LEGACY_ROLE_VALUES));
    searches.push(findMatches(collection, "roleLabel", LEGACY_LABEL_VALUES));
  });
  searches.push(findMatches("dealershipManagers", "role", LEGACY_ROLE_VALUES));
  searches.push(findMatches("userSessions", "role", LEGACY_ROLE_VALUES));
  NOTIFICATION_COLLECTIONS.forEach((collection) => {
    searches.push(findMatches(collection, "recipientRole", LEGACY_ROLE_VALUES));
    searches.push(findMatches(collection, "actorRole", LEGACY_ROLE_VALUES));
    searches.push(findMatches(collection, "role", LEGACY_ROLE_VALUES));
  });

  const unique = new Map();
  (await Promise.all(searches)).flat().forEach((match) => {
    const key = match.ref.path;
    const current = unique.get(key);
    if (!current) {
      unique.set(key, { ...match, patches: [migrationPatch(match.collection, match.field)] });
      return;
    }
    current.patches.push(migrationPatch(match.collection, match.field));
  });
  return [...unique.values()];
}

async function applyFirestoreUpdates(matches) {
  if (!APPLY) return 0;
  let writes = 0;
  for (let offset = 0; offset < matches.length; offset += 400) {
    const batch = firestore.batch();
    matches.slice(offset, offset + 400).forEach((match) => {
      const patch = Object.assign({}, ...match.patches, {
        legacyRoleMigratedAt: timestamp(),
        legacyRoleMigrationVersion: 1,
      });
      batch.set(match.ref, patch, { merge: true });
      writes += 1;
    });
    await batch.commit();
  }
  return writes;
}

function identityFromMatch(match) {
  if (!["users", "dealerStaff", "financeDesks", "financeDesk"].includes(match.collection)) return null;
  const uid = String(match.data.uid || match.data.authUid || "").trim();
  const email = String(match.data.email || match.data.officialEmail || match.id || "").trim().toLowerCase();
  return uid || email ? { uid, email } : null;
}

async function resolveAuthUser(identity) {
  if (identity.uid) {
    try {
      return await firebaseAdmin.auth().getUser(identity.uid);
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
    }
  }
  if (identity.email) {
    try {
      return await firebaseAdmin.auth().getUserByEmail(identity.email);
    } catch (error) {
      if (error?.code !== "auth/user-not-found") throw error;
    }
  }
  return null;
}

async function migrateAuthUsers(matches) {
  const identities = new Map();
  matches.map(identityFromMatch).filter(Boolean).forEach((identity) => {
    identities.set(identity.uid || identity.email, identity);
  });

  const result = { discovered: identities.size, eligible: 0, updated: 0, missing: [], errors: [] };
  for (const identity of identities.values()) {
    try {
      const authUser = await resolveAuthUser(identity);
      if (!authUser) {
        result.missing.push(identity.email || identity.uid);
        continue;
      }
      result.eligible += 1;
      if (APPLY) {
        await firebaseAdmin.auth().setCustomUserClaims(authUser.uid, {
          ...(authUser.customClaims || {}),
          role: "gm",
          portalType: "finance",
          accountType: "dealership-management",
        });
        await firebaseAdmin.auth().revokeRefreshTokens(authUser.uid);
        result.updated += 1;
      }
    } catch (error) {
      result.errors.push({
        identity: identity.email || identity.uid,
        message: error.message,
      });
    }
  }
  return result;
}

async function writeReport(report) {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const suffix = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(REPORT_DIR, `sm-to-gm-${APPLY ? "applied" : "dry-run"}-${suffix}.json`);
  await fs.writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return file;
}

async function main() {
  if (!firestore || !firebaseAdmin) throw new Error("Firebase Admin is not configured");
  const matches = await collectMatches();
  const writes = await applyFirestoreUpdates(matches);
  const auth = await migrateAuthUsers(matches);
  const report = {
    mode: APPLY ? "apply" : "dry-run",
    generatedAt: timestamp(),
    legacyRoleValues: LEGACY_ROLE_VALUES,
    matchedDocuments: matches.length,
    firestoreWrites: writes,
    byCollection: matches.reduce((summary, match) => {
      summary[match.collection] = (summary[match.collection] || 0) + 1;
      return summary;
    }, {}),
    auth,
    documents: matches.map((match) => ({
      path: match.ref.path,
      matches: match.patches.length,
      source: queryKey(match.collection, match.field, match.value),
    })),
    note: APPLY
      ? "Legacy SM identities were converted to GM and prior sessions were revoked."
      : "Dry run only. Set APPLY_SM_TO_GM_MIGRATION=true to apply changes.",
  };
  report.reportFile = await writeReport(report);
  console.log(JSON.stringify(report, null, 2));
  if (auth.errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
