import "dotenv/config";
import admin from "firebase-admin";

const requiredKeys = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"];

function normalizePrivateKey(value) {
  return String(value || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n");
}

function hasAdminEnv() {
  return requiredKeys.every((key) => Boolean(process.env[key]));
}

function initializeFirebaseAdmin() {
  if (admin.apps.length) return admin;
  if (!hasAdminEnv()) return null;

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID.trim(),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL.trim(),
      privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });

  return admin;
}

export const firebaseAdmin = initializeFirebaseAdmin();
export const firestore = firebaseAdmin ? firebaseAdmin.firestore() : null;
export const storage = firebaseAdmin && process.env.FIREBASE_STORAGE_BUCKET ? firebaseAdmin.storage().bucket() : null;
