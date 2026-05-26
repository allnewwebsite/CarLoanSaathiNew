function redact(value) {
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, val]) => {
    if (/password|token|secret|key|authorization/i.test(key)) return [key, "[redacted]"];
    if (val && typeof val === "object") return [key, redact(val)];
    return [key, val];
  }));
}

export function logInfo(message, meta = {}) {
  console.info(JSON.stringify({ level: "info", message, timestamp: new Date().toISOString(), ...redact(meta) }));
}

export function logWarn(message, meta = {}) {
  console.warn(JSON.stringify({ level: "warn", message, timestamp: new Date().toISOString(), ...redact(meta) }));
}

export function logError(message, meta = {}) {
  console.error(JSON.stringify({ level: "error", message, timestamp: new Date().toISOString(), ...redact(meta) }));
}
