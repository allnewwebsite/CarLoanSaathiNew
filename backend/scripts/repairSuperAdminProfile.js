import "dotenv/config";
import { firebaseAdmin, firestore } from "../firebase/admin.js";
import {
  assertCompatibleSuperAdminProfile,
  buildSuperAdminProfilePatch,
  isActiveSuperAdminProfile,
  superAdminProfileTarget,
} from "../services/superAdminProfile.service.js";

const apply = process.argv.includes("--apply");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function configuredEmail() {
  return String(process.env.SUPER_ADMIN_EMAIL || "").trim().toLowerCase();
}

function describe(record) {
  return {
    id: record.id,
    uid: record.data().uid || null,
    email: record.data().email || null,
    role: record.data().role || null,
  };
}

async function matchingUserDocuments({ uid, email }) {
  const references = [firestore.collection("users").doc(uid)];
  if (email !== uid) references.push(firestore.collection("users").doc(email));
  const [byUid, byEmail] = await Promise.all([
    firestore.collection("users").where("uid", "==", uid).get(),
    firestore.collection("users").where("email", "==", email).get(),
  ]);
  const docs = await Promise.all(references.map((reference) => reference.get()));
  const records = [...docs.filter((record) => record.exists), ...byUid.docs, ...byEmail.docs];
  return Array.from(new Map(records.map((record) => [record.id, record])).values());
}

async function main() {
  if (!firebaseAdmin || !firestore) fail("Firebase Admin is not configured. Check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.");
  const email = configuredEmail();
  if (!email) fail("SUPER_ADMIN_EMAIL is required.");

  let authUser;
  try {
    authUser = await firebaseAdmin.auth().getUserByEmail(email);
  } catch (error) {
    if (error.code === "auth/user-not-found") fail(`No Firebase Authentication user exists for ${email}. This repair never creates authentication users.`);
    throw error;
  }
  if (authUser.disabled === true) fail(`Firebase Authentication user ${authUser.uid} is disabled. This repair only restores Firestore profiles and will not re-enable authentication.`);

  const target = superAdminProfileTarget(authUser);
  const records = await matchingUserDocuments(target);
  const foreignRecords = records.filter((record) => record.id !== target.uid);
  if (foreignRecords.length) {
    fail(`Refusing to repair because another users document matches the configured identity: ${JSON.stringify(foreignRecords.map(describe))}. No data was changed.`);
  }

  const canonical = records.find((record) => record.id === target.uid);
  const existingProfile = canonical?.data() || {};
  assertCompatibleSuperAdminProfile(existingProfile, authUser);
  const patch = buildSuperAdminProfilePatch({
    authUser,
    existingProfile,
    configuredName: process.env.SUPER_ADMIN_NAME,
    configuredMobile: process.env.SUPER_ADMIN_MOBILE,
  });
  if (!canonical?.data().createdAt) patch.createdAt = firebaseAdmin.firestore.FieldValue.serverTimestamp();

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    authUser: { uid: target.uid, email: target.email, reused: true, passwordReset: false },
    firestoreDocument: `users/${target.uid}`,
    existingProfile: canonical ? "present" : "missing",
    changedFields: Object.keys(patch),
  }, null, 2));

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to restore this exact Firestore document.");
    return;
  }

  if (Object.keys(patch).length) {
    await firestore.collection("users").doc(target.uid).set({
      ...patch,
      updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  const restored = await firestore.collection("users").doc(target.uid).get();
  if (!restored.exists || !isActiveSuperAdminProfile(restored.data(), authUser)) {
    fail("Firestore profile verification failed after repair. No other records were modified.");
  }
  console.log(`Super Admin Firestore profile is active and canonical at users/${target.uid}.`);
}

main().catch((error) => fail(error.message || "Unable to repair Super Admin Firestore profile."));
