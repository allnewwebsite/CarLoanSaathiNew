import "dotenv/config";
import { firebaseAdmin, firestore } from "../firebase/admin.js";

const DEFAULT_ADMIN_EMAIL = "";

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function sendVerificationEmail(email, password) {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const continueUrl = process.env.FIREBASE_ACTION_CONTINUE_URL || process.env.CLIENT_ORIGIN || "http://localhost:5173/admin/login";
  const printVerificationLink = async (reason = "") => {
    const link = await firebaseAdmin.auth().generateEmailVerificationLink(email, {
      url: continueUrl,
      handleCodeInApp: false,
    });
    if (reason) console.log(reason);
    console.log(`Email verification link: ${link}`);
  };

  if (!apiKey) {
    await printVerificationLink("FIREBASE_WEB_API_KEY is not set. Verification email was not sent.");
    return;
  }

  const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const signInBody = await signIn.json();
  if (!signIn.ok) {
    await printVerificationLink(signInBody.error?.message || "Unable to send verification email through Firebase Web API.");
    return;
  }

  const verify = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestType: "VERIFY_EMAIL", idToken: signInBody.idToken, continueUrl }),
  });
  const verifyBody = await verify.json();
  if (!verify.ok) {
    await printVerificationLink(verifyBody.error?.message || "Unable to send verification email through Firebase Web API.");
    return;
  }
  console.log(`Verification email sent to ${email}.`);
}

async function upsertSuperAdminRecord(authUser, email, emailVerified = false) {
  const now = firebaseAdmin.firestore.FieldValue.serverTimestamp();
  const record = {
    uid: authUser.uid,
    email,
    name: String(process.env.SUPER_ADMIN_NAME || authUser.displayName || "Super Admin").trim(),
    fullName: String(process.env.SUPER_ADMIN_NAME || authUser.displayName || "Super Admin").trim(),
    mobile: String(process.env.SUPER_ADMIN_MOBILE || "").trim(),
    role: "super-admin",
    approved: true,
    active: true,
    accountStatus: "active",
    accountApproved: true,
    accountActive: true,
    emailVerified,
    dealershipId: null,
    bankId: null,
    archivedAt: firebaseAdmin.firestore.FieldValue.delete(),
    deletedAt: firebaseAdmin.firestore.FieldValue.delete(),
    disabledAt: firebaseAdmin.firestore.FieldValue.delete(),
    removedAt: firebaseAdmin.firestore.FieldValue.delete(),
    updatedAt: now,
  };
  await firestore.collection("users").doc(authUser.uid).set({
    ...record,
    canonical: true,
    createdAt: now,
  }, { merge: true });
  if (authUser.uid !== email) {
    const legacyRef = firestore.collection("users").doc(email);
    const legacy = await legacyRef.get();
    if (legacy.exists) {
      await legacyRef.delete();
      console.log(`Removed duplicate legacy Super Admin identity: ${email}`);
    }
  }
  await firebaseAdmin.auth().setCustomUserClaims(authUser.uid, {
    role: "super-admin",
    approved: true,
    active: true,
    email,
  });
}

async function main() {
  if (!firebaseAdmin || !firestore) fail("Firebase Admin is not configured. Check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.");

  const email = String(process.env.SUPER_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
  const password = String(process.env.SUPER_ADMIN_PASSWORD || "");
  if (!email) fail("SUPER_ADMIN_EMAIL is required.");
  if (password.length < 8) fail("SUPER_ADMIN_PASSWORD must be at least 8 characters.");

  try {
    const existingUser = await firebaseAdmin.auth().getUserByEmail(email);
    const repairedUser = await firebaseAdmin.auth().updateUser(existingUser.uid, {
      disabled: false,
    });
    await upsertSuperAdminRecord(repairedUser, email, repairedUser.emailVerified === true);
    if (repairedUser.emailVerified === true) {
      console.log(`Super admin already exists and is verified: ${email}`);
      return;
    }
    await sendVerificationEmail(email, password);
    console.log(`Super admin already exists. Firestore role repaired and verification flow prepared: ${email}`);
    return;
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
  }

  const authUser = await firebaseAdmin.auth().createUser({
    email,
    password,
    emailVerified: false,
    disabled: false,
  });

  await upsertSuperAdminRecord(authUser, email, false);
  await sendVerificationEmail(email, password);
  console.log(`Super admin seeded safely: ${email}`);
}

main().catch((error) => fail(error.message || "Unable to seed super admin."));
