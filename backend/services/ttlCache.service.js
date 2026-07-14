import IORedis from "ioredis";
import { logWarn } from "./logger.service.js";
import { recordCacheEvent } from "./requestScope.service.js";

const cache = new Map();
const pending = new Map();
const tagIndex = new Map();
const keyTags = new Map();
let invalidationVersion = 0;
let redisClient = null;
let redisSubscriber = null;
let redisReady = false;
let redisWarningLogged = false;
let cacheEvictions = 0;
const REDIS_INVALIDATION_CHANNEL = "cls:cache:invalidation:v1";
const CACHE_KEY_PREFIX = process.env.REDIS_CACHE_KEY_PREFIX || "cls:cache:v1";

function now() {
  return Date.now();
}

function redisCacheEnabled() {
  return process.env.ENABLE_REDIS_CACHE === "true" && Boolean(process.env.REDIS_URL);
}

function redisKey(key = "") {
  return `${CACHE_KEY_PREFIX}:value:${String(key)}`;
}

function redisTagKey(tag = "") {
  return `${CACHE_KEY_PREFIX}:tag:${String(tag)}`;
}

function redisPatternForPrefix(prefix = "") {
  return `${CACHE_KEY_PREFIX}:value:${String(prefix)}*`;
}

function warnRedisOnce(message, error) {
  if (redisWarningLogged) return;
  redisWarningLogged = true;
  logWarn(message, { error: error?.message || String(error || "") });
}

function initRedisCache() {
  if (!redisCacheEnabled() || redisReady) return;
  redisReady = true;
  try {
    redisClient = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    redisSubscriber = new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    redisClient.on("error", (error) => warnRedisOnce("Redis cache unavailable; in-memory cache remains active", error));
    redisSubscriber.on("error", (error) => warnRedisOnce("Redis cache invalidation subscriber unavailable; local cache remains active", error));
    redisSubscriber.subscribe(REDIS_INVALIDATION_CHANNEL).catch((error) => {
      warnRedisOnce("Redis cache invalidation subscribe failed; local cache remains active", error);
    });
    redisSubscriber.on("message", (_channel, raw) => {
      try {
        const message = JSON.parse(raw);
        if (message?.type === "tags") clearLocalTags(message.tags || []);
        else if (message?.type === "prefix") clearLocalPrefix(message.prefix || "");
      } catch {
        // Ignore malformed invalidation messages.
      }
    });
  } catch (error) {
    redisClient = null;
    redisSubscriber = null;
    warnRedisOnce("Redis cache unavailable; in-memory cache remains active", error);
  }
}

function tagsForKey(key = "") {
  const text = String(key || "");
  const [scope, subScope, entityId] = text.split(":");
  const tags = new Set();
  if (scope) tags.add(scope);
  if (scope && subScope) tags.add(`${scope}:${subScope}`);
  if (scope === "lead-detail" && subScope) tags.add(`lead:${subScope}`);
  if (scope === "timeline" && subScope === "lead" && entityId) tags.add(`lead:${entityId}`);
  if (scope === "lead-query") tags.add("lead:list");
  if (["admin", "bank", "dealer", "finance", "gm"].includes(scope)) tags.add("lead:list");
  if (scope === "bank") tags.add("bank:summary");
  if (scope === "admin") tags.add("admin:summary");
  return tags;
}

function normalizeTags(tags = []) {
  return Array.isArray(tags) ? tags.filter(Boolean).map(String) : [String(tags)].filter(Boolean);
}

function removeKey(key) {
  cache.delete(key);
  pending.delete(key);
  const tags = keyTags.get(key);
  if (!tags) return;
  for (const tag of tags) {
    const keys = tagIndex.get(tag);
    if (!keys) continue;
    keys.delete(key);
    if (!keys.size) tagIndex.delete(tag);
  }
  keyTags.delete(key);
}

export function pruneCache(maxEntries = Number(process.env.MEMORY_CACHE_MAX_ENTRIES || 5000)) {
  const timestamp = now();
  for (const [key, entry] of cache.entries()) {
    if (!entry || entry.expiresAt <= timestamp) removeKey(key);
  }
  const safeMax = Math.max(100, Number(maxEntries) || 5000);
  while (cache.size > safeMax) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    removeKey(oldestKey);
    cacheEvictions += 1;
  }
  return cache.size;
}

function rememberTags(key, tags = []) {
  const normalized = new Set([...tagsForKey(key), ...normalizeTags(tags)]);
  keyTags.set(key, normalized);
  for (const tag of normalized) {
    const keys = tagIndex.get(tag) || new Set();
    keys.add(key);
    tagIndex.set(tag, keys);
  }
}

function clearLocalPrefix(prefix = "") {
  const keys = new Set([...cache.keys(), ...pending.keys()]);
  for (const key of keys) {
    if (!prefix || key.startsWith(prefix)) removeKey(key);
  }
}

function clearLocalTags(tags = []) {
  const keys = new Set();
  for (const tag of normalizeTags(tags)) {
    for (const key of tagIndex.get(tag) || []) keys.add(key);
  }
  for (const key of keys) removeKey(key);
}

async function scanRedisKeys(pattern) {
  initRedisCache();
  if (!redisClient) return [];
  const keys = [];
  let cursor = "0";
  do {
    const [nextCursor, batch] = await redisClient.scan(cursor, "MATCH", pattern, "COUNT", 250);
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}

async function clearRedisPrefix(prefix = "") {
  if (!redisCacheEnabled()) return;
  try {
    const keys = await scanRedisKeys(redisPatternForPrefix(prefix));
    if (keys.length) await redisClient.del(...keys);
    await redisClient?.publish(REDIS_INVALIDATION_CHANNEL, JSON.stringify({ type: "prefix", prefix }));
  } catch (error) {
    warnRedisOnce("Redis cache prefix invalidation failed; local cache was still cleared", error);
  }
}

async function clearRedisTags(tags = []) {
  if (!redisCacheEnabled()) return;
  try {
    initRedisCache();
    if (!redisClient) return;
    const normalized = normalizeTags(tags);
    const valueKeys = new Set();
    const tagKeys = normalized.map(redisTagKey);
    for (const tagKey of tagKeys) {
      const keys = await redisClient.smembers(tagKey);
      keys.forEach((key) => valueKeys.add(key));
    }
    const deleteKeys = [...valueKeys, ...tagKeys];
    if (deleteKeys.length) await redisClient.del(...deleteKeys);
    await redisClient.publish(REDIS_INVALIDATION_CHANNEL, JSON.stringify({ type: "tags", tags: normalized }));
  } catch (error) {
    warnRedisOnce("Redis cache tag invalidation failed; local cache was still cleared", error);
  }
}

async function getRedisCachedValue(key) {
  if (!redisCacheEnabled()) return null;
  try {
    initRedisCache();
    if (!redisClient) return null;
    const [raw, ttlMs] = await Promise.all([
      redisClient.get(redisKey(key)),
      redisClient.pttl(redisKey(key)),
    ]);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    const value = payload?.value;
    const localTtlMs = Number(ttlMs) > 0 ? Number(ttlMs) : 1000;
    setCachedValue(key, value, localTtlMs, { tags: payload?.tags || [] });
    return value;
  } catch (error) {
    warnRedisOnce("Redis cache read failed; falling back to loader", error);
    return null;
  }
}

async function setRedisCachedValue(key, value, ttlMs, tags = []) {
  if (!redisCacheEnabled() || !key || ttlMs <= 0) return;
  try {
    initRedisCache();
    if (!redisClient) return;
    const normalizedTags = [...new Set([...tagsForKey(key), ...normalizeTags(tags)])];
    const payload = JSON.stringify({ value, tags: normalizedTags });
    const ttl = Math.max(1, Math.ceil(Number(ttlMs) / 1000));
    const keyName = redisKey(key);
    const pipeline = redisClient.pipeline();
    pipeline.set(keyName, payload, "EX", ttl);
    normalizedTags.forEach((tag) => {
      const tagKey = redisTagKey(tag);
      pipeline.sadd(tagKey, keyName);
      pipeline.expire(tagKey, ttl);
    });
    await pipeline.exec();
  } catch (error) {
    warnRedisOnce("Redis cache write failed; in-memory cache remains active", error);
  }
}

export function getCachedValue(key) {
  initRedisCache();
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= now()) {
    removeKey(key);
    recordCacheEvent(false);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  recordCacheEvent(true);
  return entry.value;
}

export function setCachedValue(key, value, ttlMs, { tags = [] } = {}) {
  initRedisCache();
  if (!key || ttlMs <= 0) return value;
  removeKey(key);
  cache.set(key, { value, expiresAt: now() + ttlMs });
  rememberTags(key, tags);
  pruneCache();
  setRedisCachedValue(key, value, ttlMs, tags);
  return value;
}

export function clearCachedValue(prefix = "") {
  initRedisCache();
  invalidationVersion += 1;
  clearLocalPrefix(prefix);
  clearRedisPrefix(prefix);
}

export function clearCachedTags(tags = []) {
  initRedisCache();
  invalidationVersion += 1;
  clearLocalTags(tags);
  clearRedisTags(tags);
}

export function clearCacheNamespaces(prefixes = []) {
  for (const prefix of normalizeTags(prefixes)) clearCachedValue(prefix);
}

export async function cached(key, ttlMs, loader, options = {}) {
  const hit = getCachedValue(key);
  if (hit !== null) return hit;
  const redisHit = await getRedisCachedValue(key);
  if (redisHit !== null) {
    recordCacheEvent(true);
    return redisHit;
  }
  if (pending.has(key)) return pending.get(key);
  const version = invalidationVersion;
  const promise = Promise.resolve()
    .then(loader)
    .then((value) => {
      if (version !== invalidationVersion) return value;
      return setCachedValue(key, value, ttlMs, options);
    })
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  rememberTags(key, options.tags);
  return promise;
}

export function cacheStats() {
  pruneCache();
  return {
    entries: cache.size,
    pending: pending.size,
    tags: tagIndex.size,
    evictions: cacheEvictions,
    maxEntries: Math.max(100, Number(process.env.MEMORY_CACHE_MAX_ENTRIES || 5000)),
    redisEnabled: redisCacheEnabled(),
  };
}
