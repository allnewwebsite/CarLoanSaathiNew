import "dotenv/config";
import { firebaseAdmin, firestore } from "../firebase/admin.js";

const DEFAULT_ADMIN_EMAIL = "hydarkdevil@gmail.com";

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function sendVerificationEmail(email, password) {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const continueUrl = process.env.FIREBASE_ACTION_CONTINUE_URL || process.env.CLIENT_ORIGIN || "http://localhost:5173/super-admin";
  if (!apiKey) {
    const link = await firebaseAdmin.auth().generateEmailVerificationLink(email, {
      url: continueUrl,
      handleCodeInApp: false,
    });
    console.log("FIREBASE_WEB_API_KEY is not set. Verification email was not sent.");
    console.log(`Email verification link: ${link}`);
    return;
  }

  const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const signInBody = await signIn.json();
  if (!signIn.ok) fail(signInBody.error?.message || "Unable to sign in seeded super admin for verification email.");

  const verify = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestType: "VERIFY_EMAIL", idToken: signInBody.idToken, continueUrl }),
  });
  const verifyBody = await verify.json();
  if (!verify.ok) fail(verifyBody.error?.message || "Unable to send verification email.");
  console.log(`Verification email sent to ${email}.`);
}

async function main() {
  if (!firebaseAdmin || !firestore) fail("Firebase Admin is not configured. Check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.");

  const email = String(process.env.SUPER_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
  const password = String(process.env.SUPER_ADMIN_PASSWORD || "");
  if (email !== DEFAULT_ADMIN_EMAIL) fail(`Super admin email must be ${DEFAULT_ADMIN_EMAIL}.`);
  if (password.length < 8) fail("SUPER_ADMIN_PASSWORD must be at least 8 characters.");

  try {
    await firebaseAdmin.auth().getUserByEmail(email);
    fail(`Super admin already exists in Firebase Authentication: ${email}`);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
  }

  const authUser = await firebaseAdmin.auth().createUser({
    email,
    password,
    emailVerified: false,
    disabled: false,
  });

  const record = {
    uid: authUser.uid,
    email,
    role: "super-admin",
    approved: true,
    active: true,
    accountStatus: "active",
    accountApproved: true,
    accountActive: true,
    emailVerified: false,
    dealershipId: null,
    bankId: null,
    createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
  };
  await firestore.collection("users").doc(email).set(record, { merge: true });
  await firebaseAdmin.auth().setCustomUserClaims(authUser.uid, {
    role: "super-admin",
    approved: true,
    active: true,
    email,
  });
  await sendVerificationEmail(email, password);
  console.log(`Super admin seeded safely: ${email}`);
}

main().catch((error) => fail(error.message || "Unable to seed super admin."));
