const sensitivePattern = /password|token|secret|key|authorization|private|credential|cookie|session|otp|captcha|appcheck/i;
const piiPattern = /name|fullName|customer|mobile|phone|email|aadhaar|aadhar|pan|address|loanAmount|amount|price|vehicle|model|brand|gstin|ifsc/i;

function maskString(value) {
  const text = String(value);
  if (/^[6-9]\d{9}$/.test(text)) return `${text.slice(0, 2)}******${text.slice(-2)}`;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    const [local, domain] = text.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  if (/^[A-Z]{5}\d{4}[A-Z]$/i.test(text)) return "[redacted-pan]";
  if (/^\d{12}$/.test(text)) return "[redacted-aadhaar]";
  return text.length > 4 ? "[redacted]" : "***";
}

function redact(value, key = "") {
  if (typeof value === "string") {
    if (/Bearer\s+[A-Za-z0-9._-]+/i.test(value)) return value.replace(/Bearer\s+[A-Za-z0-9._-]+/i, "Bearer [redacted]");
    if (/-----BEGIN [A-Z ]+KEY-----/.test(value)) return "[redacted-private-key]";
    if (piiPattern.test(key)) return maskString(value);
    return value;
  }
  if (typeof value === "number" && piiPattern.test(key)) return "[redacted-number]";
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, key));
  return Object.fromEntries(Object.entries(value).map(([key, val]) => {
    if (sensitivePattern.test(key)) return [key, "[redacted]"];
    if (piiPattern.test(key)) return [key, redact(val, key)];
    if (val && typeof val === "object") return [key, redact(val, key)];
    return [key, redact(val, key)];
  }));
}

function baseLog(level, message, meta = {}) {
  const payload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    service: "carloansaathi-api",
    environment: process.env.NODE_ENV || "development",
    release: process.env.RENDER_GIT_COMMIT || process.env.npm_package_version || "local",
    ...redact(meta),
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn" || level === "security") console.warn(line);
  else console.info(line);
}

export function cleanLogMeta(meta = {}) {
  return redact(meta);
}

export function logInfo(message, meta = {}) {
  baseLog("info", message, meta);
}

export function logWarn(message, meta = {}) {
  baseLog("warn", message, meta);
}

export function logError(message, meta = {}) {
  baseLog("error", message, meta);
}

export function logSecurity(message, meta = {}) {
  baseLog("security", message, meta);
}
