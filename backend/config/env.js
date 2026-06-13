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
const defaultDevelopmentSecrets = new Set(["development-secret", "dev-secret", "local-secret"]);

export function validateEnv() {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is required");
  }
  if (process.env.JWT_SECRET.length < 32 || weakValues.has(process.env.JWT_SECRET) || defaultDevelopmentSecrets.has(process.env.JWT_SECRET)) {
    throw new Error("JWT_SECRET must be a strong random value with at least 32 characters");
  }
  if (process.env.FIREBASE_PRIVATE_KEY && !String(process.env.FIREBASE_PRIVATE_KEY).includes("BEGIN PRIVATE KEY")) {
    throw new Error("FIREBASE_PRIVATE_KEY must be the escaped service account private key from a secure environment variable");
  }
  if (!superAdminEmail()) {
    throw new Error("SUPER_ADMIN_EMAIL must be configured");
  }
  if (process.env.NODE_ENV !== "production") return;
  const missing = requiredInProduction.filter((key) => !process.env[key]);
  if (process.env.ENABLE_SUBSCRIPTION_BILLING === "true") {
    ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"].forEach((key) => {
      if (!process.env[key]) missing.push(key);
    });
  }
  if (missing.length) {
    throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  }
}

export function allowedOrigins() {
  const configuredOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  const safeDefaults = [
    "https://carloansaathi.com",
    "https://www.carloansaathi.com",
    "https://carloansaathi-apkaapnasaathi.onrender.com",
  ];

  return Array.from(new Set([...configuredOrigins, ...safeDefaults]));
}

export function superAdminEmail() {
  return String(process.env.SUPER_ADMIN_EMAIL || "").trim().toLowerCase();
}

export function jwtSecret() {
  return process.env.JWT_SECRET;
}
