const sensitivePattern = /password|token|secret|key|authorization|private|credential|cookie|session/i;

function redact(value) {
  if (typeof value === "string") {
    if (/Bearer\s+[A-Za-z0-9._-]+/i.test(value)) return value.replace(/Bearer\s+[A-Za-z0-9._-]+/i, "Bearer [redacted]");
    if (/-----BEGIN [A-Z ]+KEY-----/.test(value)) return "[redacted-private-key]";
    return value;
  }
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item));
  return Object.fromEntries(Object.entries(value).map(([key, val]) => {
    if (sensitivePattern.test(key)) return [key, "[redacted]"];
    if (val && typeof val === "object") return [key, redact(val)];
    return [key, redact(val)];
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
