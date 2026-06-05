const cache = new Map();
const pending = new Map();

function now() {
  return Date.now();
}

export function getCachedValue(key) {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function setCachedValue(key, value, ttlMs) {
  if (!key || ttlMs <= 0) return value;
  cache.set(key, { value, expiresAt: now() + ttlMs });
  return value;
}

export function clearCachedValue(prefix = "") {
  for (const key of cache.keys()) {
    if (!prefix || key.startsWith(prefix)) cache.delete(key);
  }
}

export async function cached(key, ttlMs, loader) {
  const hit = getCachedValue(key);
  if (hit !== null) return hit;
  if (pending.has(key)) return pending.get(key);
  const promise = Promise.resolve()
    .then(loader)
    .then((value) => setCachedValue(key, value, ttlMs))
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}
