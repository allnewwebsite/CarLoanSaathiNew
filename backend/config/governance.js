export const GOVERNANCE_LIMITS = Object.freeze({
  api: {
    jsonBodyLimit: process.env.API_JSON_LIMIT || "2mb",
    defaultPageLimit: Number(process.env.DEFAULT_PAGE_LIMIT || 20),
    maxPageLimit: Number(process.env.MAX_PAGE_LIMIT || 100),
    requestTimeoutMs: Number(process.env.API_REQUEST_TIMEOUT_MS || 25_000),
    slowRequestMs: Number(process.env.SLOW_REQUEST_MS || 2_000),
  },
  notifications: {
    maxRetryCount: Number(process.env.NOTIFICATION_MAX_RETRIES || 5),
    retryBaseDelayMs: Number(process.env.NOTIFICATION_RETRY_BASE_MS || 60_000),
    ttlDays: Number(process.env.NOTIFICATION_TTL_DAYS || 90),
    deliveryChannels: ["in-app", "email", "whatsapp", "sms", "push", "websocket"],
    priorities: ["critical", "high", "medium", "low"],
  },
  uploads: {
    maxFileSizeBytes: Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024),
    allowedMimeTypes: ["application/pdf", "image/jpeg", "image/png"],
  },
  audit: {
    onlineRetentionDays: Number(process.env.AUDIT_ONLINE_RETENTION_DAYS || 365),
    longTermRetentionDays: Number(process.env.AUDIT_LONG_TERM_RETENTION_DAYS || 2555),
  },
});

export const ROLE_PERMISSIONS = Object.freeze({
  "super-admin": ["*"],
  "finance-desk": [
    "lead:create",
    "lead:read:dealership",
    "document:upload:dealership",
    "salesperson:manage:dealership",
    "notification:read:tenant",
  ],
  "gm": [
    "lead:read:dealership",
    "salesperson:read:dealership",
    "notification:read:tenant",
  ],
  "bank-manager": [
    "lead:read:bank",
    "executive:manage:bank",
    "notification:read:tenant",
  ],
  "loan-executive": [
    "lead:read:assigned",
    "lead:update-status:assigned",
    "document:read:assigned",
    "notification:read:assigned",
  ],
});

export function hasPermission(role, permission) {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes("*") || permissions.includes(permission);
}
