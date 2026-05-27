export const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
export const API_BASE_URL = `${BASE_URL.replace(/\/$/, "")}/api`;

export const TEST_USERS = {
  finance: {
    email: __ENV.FINANCE_EMAIL || "",
    password: __ENV.FINANCE_PASSWORD || "",
  },
  bankManager: {
    email: __ENV.BANK_MANAGER_EMAIL || "",
    password: __ENV.BANK_MANAGER_PASSWORD || "",
  },
  executive: {
    email: __ENV.EXECUTIVE_EMAIL || "",
    password: __ENV.EXECUTIVE_PASSWORD || "",
  },
  admin: {
    email: __ENV.ADMIN_EMAIL || "",
    password: __ENV.ADMIN_PASSWORD || "",
  },
};

export const PROFILES = {
  light: [
    { duration: "2m", target: 10 },
    { duration: "3m", target: 10 },
    { duration: "1m", target: 0 },
  ],
  medium: [
    { duration: "3m", target: 50 },
    { duration: "5m", target: 50 },
    { duration: "2m", target: 0 },
  ],
  heavy: [
    { duration: "5m", target: 150 },
    { duration: "10m", target: 150 },
    { duration: "3m", target: 0 },
  ],
  burst: [
    { duration: "30s", target: 100 },
    { duration: "2m", target: 100 },
    { duration: "30s", target: 0 },
  ],
  soak: [
    { duration: "10m", target: 50 },
    { duration: "2h", target: 50 },
    { duration: "5m", target: 0 },
  ],
};

export function stages() {
  return PROFILES[__ENV.PROFILE || "light"] || PROFILES.light;
}
