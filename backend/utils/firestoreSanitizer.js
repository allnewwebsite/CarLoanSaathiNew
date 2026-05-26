function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export function sanitizeFirestoreData(data) {
  if (data === undefined || data === null) return undefined;

  if (typeof data === "string") {
    const trimmed = data.trim();
    return trimmed === "" ? undefined : trimmed;
  }

  if (Array.isArray(data)) {
    const items = data
      .map((item) => sanitizeFirestoreData(item))
      .filter((item) => item !== undefined);
    return items.length ? items : undefined;
  }

  if (isPlainObject(data)) {
    const entries = Object.entries(data)
      .map(([key, value]) => [key, sanitizeFirestoreData(value)])
      .filter(([, value]) => value !== undefined);
    if (!entries.length) return undefined;
    return Object.fromEntries(entries);
  }

  return data;
}

export function assertNonEmptyFirestoreData(data) {
  const sanitized = sanitizeFirestoreData(data);
  if (!sanitized || !Object.keys(sanitized).length) {
    const error = new Error("No valid data provided");
    error.status = 400;
    throw error;
  }
  return sanitized;
}
