export const BASE_URL = (__ENV.BASE_URL || "http://localhost:8080").replace(/\/$/, "");
export const API_BASE_URL = (__ENV.API_BASE_URL || `${BASE_URL}/api`).replace(/\/$/, "");
export const FRONTEND_URL = (__ENV.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");

export const RUN_ID = __ENV.RUN_ID || `k6-${Date.now()}`;
export const ENVIRONMENT = (__ENV.TEST_ENV || __ENV.APP_ENV || "local").toLowerCase();
export const PROFILE = __ENV.PROFILE || "light";
export const FIREBASE_WEB_API_KEY = __ENV.FIREBASE_WEB_API_KEY || "";

export const SAFETY = {
  allowProduction: __ENV.ALLOW_PRODUCTION_LOAD === "true",
  allowWrites: __ENV.ALLOW_WRITES === "true",
  requireStaging: __ENV.REQUIRE_STAGING !== "false",
};

export const TEST_USERS = {
  finance: {
    email: __ENV.FINANCE_EMAIL || "",
    password: __ENV.FINANCE_PASSWORD || "",
    portal: "dealer",
  },
  gm: {
    email: __ENV.GM_EMAIL || "",
    password: __ENV.GM_PASSWORD || "",
    portal: "dealer",
  },
  bankManager: {
    email: __ENV.BANK_MANAGER_EMAIL || "",
    password: __ENV.BANK_MANAGER_PASSWORD || "",
    portal: "bank",
  },
  executive: {
    email: __ENV.EXECUTIVE_EMAIL || "",
    password: __ENV.EXECUTIVE_PASSWORD || "",
    portal: "bank",
  },
  admin: {
    email: __ENV.ADMIN_EMAIL || "",
    password: __ENV.ADMIN_PASSWORD || "",
    portal: "admin",
  },
};

export const PROFILES = {
  smoke: [
    { duration: "20s", target: 1 },
    { duration: "40s", target: 1 },
    { duration: "10s", target: 0 },
  ],
  light: [
    { duration: "1m", target: 10 },
    { duration: "3m", target: 10 },
    { duration: "1m", target: 0 },
  ],
  medium: [
    { duration: "3m", target: 50 },
    { duration: "7m", target: 50 },
    { duration: "2m", target: 0 },
  ],
  heavy: [
    { duration: "5m", target: 150 },
    { duration: "15m", target: 150 },
    { duration: "5m", target: 0 },
  ],
  enterprise: [
    { duration: "10m", target: 500 },
    { duration: "20m", target: 500 },
    { duration: "10m", target: 1000 },
    { duration: "20m", target: 1000 },
    { duration: "10m", target: 0 },
  ],
  burst: [
    { duration: "30s", target: 100 },
    { duration: "2m", target: 100 },
    { duration: "30s", target: 0 },
  ],
  stress: [
    { duration: "5m", target: 100 },
    { duration: "5m", target: 250 },
    { duration: "5m", target: 500 },
    { duration: "5m", target: 750 },
    { duration: "5m", target: 1000 },
    { duration: "5m", target: 0 },
  ],
  soak: [
    { duration: "10m", target: 50 },
    { duration: "2h", target: 50 },
    { duration: "5m", target: 0 },
  ],
};

export const DEFAULT_THRESHOLDS = {
  http_req_failed: ["rate<0.02"],
  http_req_duration: ["p(50)<700", "p(95)<2000", "p(99)<4000"],
  checks: ["rate>0.98"],
};

export function stages() {
  return PROFILES[PROFILE] || PROFILES.light;
}

export function sharedTags(area) {
  return {
    area,
    runId: RUN_ID,
    environment: ENVIRONMENT,
    profile: PROFILE,
  };
}

export function isProductionTarget() {
  return /carloansaathi\.com|onrender\.com|vercel\.app/i.test(BASE_URL)
    && !/staging|stage|localhost|127\.0\.0\.1/i.test(BASE_URL);
}
