const requiredInProduction = [
  "CLIENT_ORIGIN",
  "JWT_SECRET",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "FIREBASE_PRIVATE_KEY",
  "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_WEB_API_KEY",
];

const weakValues = new Set(["change-me", "changeme", "replace-with-a-secure-secret", "replace-with-64-plus-character-random-secret", "secret", "password"]);

export function validateEnv() {
  if (process.env.JWT_SECRET && (process.env.JWT_SECRET.length < 32 || weakValues.has(process.env.JWT_SECRET))) {
    throw new Error("JWT_SECRET must be a strong random value with at least 32 characters");
  }
  if (process.env.FIREBASE_PRIVATE_KEY && !String(process.env.FIREBASE_PRIVATE_KEY).includes("BEGIN PRIVATE KEY")) {
    throw new Error("FIREBASE_PRIVATE_KEY must be the escaped service account private key from a secure environment variable");
  }
  if (process.env.NODE_ENV !== "production") return;
  const missing = requiredInProduction.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }
}

export function allowedOrigins() {
  return (process.env.CLIENT_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}
