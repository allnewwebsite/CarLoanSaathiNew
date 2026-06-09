import { findRecordsByField, getRecord, upsertRecord } from "./firestore.service.js";
import { cached, clearCachedValue } from "./ttlCache.service.js";
import { getRequestCachedValue, setRequestCachedValue } from "./requestScope.service.js";

const ACTIVE_DENY_STATUSES = new Set(["pending", "rejected", "suspended", "deleted", "inactive", "disabled", "removed"]);

export function normalizeIdentityEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

export function activeIdentity(record = {}) {
  const status = String(record.accountStatus || record.status || "").trim().toLowerCase();
  return Boolean(
    record.role
    && record.approved === true
    && record.active !== false
    && record.accountApproved !== false
    && record.accountActive !== false
    && !ACTIVE_DENY_STATUSES.has(status)
  );
}

function identityMatches(record = {}, { uid = "", email = "" } = {}) {
  const normalizedEmail = normalizeIdentityEmail(email);
  const normalizedUid = String(uid || "").trim();
  return Boolean(
    (normalizedUid && String(record.id || "") === normalizedUid)
    || (normalizedUid && String(record.uid || record.authUid || "").trim() === normalizedUid)
    || (normalizedEmail && normalizeIdentityEmail(record.email) === normalizedEmail)
    || (normalizedEmail && String(record.id || "").toLowerCase() === normalizedEmail)
  );
}

function uniqueRecords(records = []) {
  const seen = new Set();
  return records.filter((record) => {
    const key = record.id || `${record.uid || ""}:${record.email || ""}:${record.role || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const IDENTITY_CACHE_TTL_MS = Number(process.env.AUTH_IDENTITY_CACHE_TTL_MS || 10 * 60 * 1000);

function identityCacheKey({ uid = "", email = "" } = {}) {
  return `identity:candidates:${String(uid || "").trim()}:${normalizeIdentityEmail(email)}`;
}

async function loadIdentityCandidates({ uid = "", email = "" } = {}) {
  const normalizedEmail = normalizeIdentityEmail(email);
  const normalizedUid = String(uid || "").trim();
  const lookups = [];
  if (normalizedUid) {
    lookups.push(getRecord("users", normalizedUid).catch(() => null));
    lookups.push(findRecordsByField("users", "uid", normalizedUid, 5).catch(() => []));
  }
  if (normalizedEmail) {
    lookups.push(getRecord("users", normalizedEmail).catch(() => null));
    lookups.push(findRecordsByField("users", "email", normalizedEmail, 5).catch(() => []));
  }
  const results = await Promise.all(lookups);
  const candidates = results.flat().filter(Boolean);
  return uniqueRecords(candidates.filter((record) => identityMatches(record, { uid: normalizedUid, email: normalizedEmail })));
}

export async function findIdentityCandidates({ uid = "", email = "" } = {}) {
  const normalizedEmail = normalizeIdentityEmail(email);
  const normalizedUid = String(uid || "").trim();
  if (!normalizedEmail && !normalizedUid) return [];
  const requestKey = identityCacheKey({ uid: normalizedUid, email: normalizedEmail });
  const requestCached = getRequestCachedValue(requestKey);
  if (requestCached !== undefined) return requestCached;
  const records = await cached(requestKey, IDENTITY_CACHE_TTL_MS, () => loadIdentityCandidates({ uid: normalizedUid, email: normalizedEmail }));
  return setRequestCachedValue(requestKey, records);
}

export async function resolveCanonicalIdentity({ uid = "", email = "", portal = "" } = {}) {
  const candidates = await findIdentityCandidates({ uid, email });
  const activeCandidates = candidates.filter(activeIdentity);
  if (activeCandidates.length > 1) {
    const error = new Error("Multiple active identities exist for this email. Contact support.");
    error.status = 409;
    error.code = "IDENTITY_COLLISION";
    error.details = activeCandidates.map((record) => ({
      id: record.id,
      uid: record.uid || null,
      email: record.email || null,
      role: record.role || null,
      portalType: record.portalType || null,
    }));
    throw error;
  }
  if (!activeCandidates.length) return null;
  const normalizedUid = String(uid || "").trim();
  return activeCandidates.find((record) => normalizedUid && String(record.uid || "").trim() === normalizedUid)
    || activeCandidates.find((record) => portal && record.portalType === portal)
    || activeCandidates[0];
}

function authenticatedIdentityCacheKey({ uid = "", email = "" } = {}) {
  return `auth:identity:${String(uid || "").trim()}:${normalizeIdentityEmail(email)}`;
}

async function loadAuthenticatedIdentityCandidates({ uid = "", email = "" } = {}) {
  const normalizedEmail = normalizeIdentityEmail(email);
  const normalizedUid = String(uid || "").trim();
  return loadIdentityCandidates({ uid: normalizedUid, email: normalizedEmail });
}

export async function resolveAuthenticatedIdentity({ uid = "", email = "", portal = "" } = {}) {
  const normalizedEmail = normalizeIdentityEmail(email);
  const normalizedUid = String(uid || "").trim();
  if (!normalizedEmail && !normalizedUid) return null;
  const key = authenticatedIdentityCacheKey({ uid: normalizedUid, email: normalizedEmail });
  const requestCached = getRequestCachedValue(key);
  if (requestCached !== undefined) return requestCached;
  const candidates = await cached(key, IDENTITY_CACHE_TTL_MS, () => loadAuthenticatedIdentityCandidates({ uid: normalizedUid, email: normalizedEmail }));
  setRequestCachedValue(identityCacheKey({ uid: normalizedUid, email: normalizedEmail }), candidates);
  const activeCandidates = candidates.filter(activeIdentity);
  if (activeCandidates.length > 1) {
    const error = new Error("Multiple active identities exist for this email. Contact support.");
    error.status = 409;
    error.code = "IDENTITY_COLLISION";
    error.details = activeCandidates.map((record) => ({
      id: record.id,
      uid: record.uid || null,
      email: record.email || null,
      role: record.role || null,
      portalType: record.portalType || null,
    }));
    throw error;
  }
  const account = activeCandidates.find((record) => normalizedUid && String(record.uid || "").trim() === normalizedUid)
    || activeCandidates.find((record) => portal && record.portalType === portal)
    || activeCandidates[0]
    || null;
  return setRequestCachedValue(key, account);
}

export function clearIdentityCaches({ uid = "", email = "", sessionId = "" } = {}) {
  const normalizedEmail = normalizeIdentityEmail(email);
  clearCachedValue("identity:candidates:");
  clearCachedValue("auth:identity:");
  clearCachedValue("auth:verified-identity:");
  clearCachedValue("auth:dealership:");
  if (normalizedEmail) clearCachedValue(`auth:firebase-email-verified:${normalizedEmail}`);
  if (sessionId) clearCachedValue(`auth:session:${sessionId}`);
}

export async function assertNoActiveIdentityCollision({ uid = "", email = "", role = "", excludeIds = [] } = {}) {
  const exclude = new Set(excludeIds.filter(Boolean).map(String));
  const candidates = await findIdentityCandidates({ uid, email });
  const activeCandidates = candidates.filter((record) => activeIdentity(record) && !exclude.has(String(record.id || "")));
  const conflicting = activeCandidates.find((record) => record.role !== role || normalizeIdentityEmail(record.email) === normalizeIdentityEmail(email));
  if (conflicting) {
    const error = new Error("This email already belongs to another active account.");
    error.status = 409;
    error.code = "IDENTITY_ALREADY_ACTIVE";
    error.identity = {
      id: conflicting.id,
      uid: conflicting.uid || null,
      email: conflicting.email || null,
      role: conflicting.role || null,
      portalType: conflicting.portalType || null,
    };
    throw error;
  }
}

export async function upsertCanonicalUser(uid, payload = {}) {
  const canonicalUid = String(uid || payload.uid || payload.email || "").trim();
  if (!canonicalUid) {
    const error = new Error("Canonical user UID is required.");
    error.status = 400;
    error.code = "CANONICAL_UID_REQUIRED";
    throw error;
  }
  const email = normalizeIdentityEmail(payload.email);
  clearIdentityCaches({ uid: canonicalUid, email });
  return upsertRecord("users", canonicalUid, {
    ...payload,
    uid: canonicalUid,
    email,
    canonical: true,
  });
}
