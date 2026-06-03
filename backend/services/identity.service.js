import { findRecordsByField, getRecord, upsertRecord } from "./firestore.service.js";

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

export async function findIdentityCandidates({ uid = "", email = "" } = {}) {
  const normalizedEmail = normalizeIdentityEmail(email);
  const normalizedUid = String(uid || "").trim();
  const candidates = [];
  if (normalizedUid) {
    const byUid = await getRecord("users", normalizedUid).catch(() => null);
    if (byUid) candidates.push(byUid);
  }
  if (normalizedEmail) {
    const byEmail = await getRecord("users", normalizedEmail).catch(() => null);
    if (byEmail) candidates.push(byEmail);

    const emailMatches = await findRecordsByField("users", "email", normalizedEmail, 5).catch(() => []);
    candidates.push(...emailMatches);
  }
  if (normalizedUid) {
    const uidMatches = await findRecordsByField("users", "uid", normalizedUid, 5).catch(() => []);
    candidates.push(...uidMatches);
  }
  return uniqueRecords(candidates.filter((record) => identityMatches(record, { uid: normalizedUid, email: normalizedEmail })));
}

export async function resolveCanonicalIdentity({ uid = "", email = "", portal = "" } = {}) {
  const candidates = await findIdentityCandidates({ uid, email });
  const activeCandidates = candidates.filter(activeIdentity);
  const activeRoles = new Set(activeCandidates.map((record) => record.role).filter(Boolean));
  if (activeRoles.size > 1) {
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
  return upsertRecord("users", canonicalUid, {
    ...payload,
    uid: canonicalUid,
    email,
    canonical: true,
  });
}
