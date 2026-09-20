import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { firestore } from "../firebase/admin.js";
import { runRecordTransaction } from "./firestoreTransaction.service.js";

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COLLECTION = "documentUploadOperations";
export const UPLOAD_SIDE_EFFECTS = Object.freeze(["audit", "timeline", "notification", "whatsapp", "realtime"]);
export const UPLOAD_PROCESSING_LEASE_MS = Number(process.env.DOCUMENT_UPLOAD_PROCESSING_LEASE_MS || 10 * 60 * 1000);
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const nowIso = () => new Date().toISOString();
const leaseUntil = () => new Date(Date.now() + UPLOAD_PROCESSING_LEASE_MS).toISOString();
const isLeaseActive = (value) => Boolean(value) && new Date(value).getTime() > Date.now();
const operationError = (message, status, code) => Object.assign(new Error(message), { status, code });

export function uploadSideEffectIdentities(documentId) {
  const id = String(documentId || "").trim();
  return {
    audit: `document-upload-audit:${id}`,
    timeline: `document-upload-timeline:${id}`,
    notification: `document-upload-notification:${id}`,
    whatsapp: `document-upload-whatsapp:${id}`,
    realtime: `document-upload-realtime:${id}`,
  };
}

function emptySideEffects(existing = {}) {
  return Object.fromEntries(UPLOAD_SIDE_EFFECTS.map((name) => [name, existing[name] || { status: "pending" }]));
}

function atomicityRequired() {
  if (firestore) return;
  throw operationError("Idempotent uploads are temporarily unavailable because durable Firestore atomicity is unavailable.", 503, "UPLOAD_IDEMPOTENCY_UNAVAILABLE");
}

export function idempotencyKeyFromRequest(req) {
  const raw = req.get("Idempotency-Key");
  if (raw === undefined) return null;
  const key = String(raw).trim();
  if (!KEY_PATTERN.test(key)) throw operationError("Idempotency-Key must contain 1-128 letters, numbers, dots, colons, underscores, or hyphens.", 400, "INVALID_IDEMPOTENCY_KEY");
  return key;
}

export async function uploadOperationIdentity({ key, user, lead, documentType, file }) {
  const uploaderId = String(user?.uid || user?.email || "").trim();
  const dealershipId = String(lead?.dealershipId || user?.dealershipId || "").trim();
  const contentHash = hash(await fs.readFile(file.path));
  const fingerprint = hash(JSON.stringify({ uploaderId, dealershipId, leadId: lead.id, caseId: lead.caseId || lead.id, documentType, mimeType: file.mimetype, size: file.size, contentHash }));
  const operationId = `document-upload-${hash(`${uploaderId}:${dealershipId}:${key}`).slice(0, 48)}`;
  return { operationId, fingerprint, uploaderId, dealershipId, contentHash };
}

const conflict = (message) => operationError(message, 409, "IDEMPOTENCY_KEY_CONFLICT");

export async function claimDocumentUpload(identity) {
  atomicityRequired();
  return runRecordTransaction(async (transaction) => {
    const existing = await transaction.get(COLLECTION, identity.operationId);
    if (existing) {
      if (existing.uploaderId !== identity.uploaderId || existing.dealershipId !== identity.dealershipId || existing.fingerprint !== identity.fingerprint) throw conflict("Idempotency key is already associated with a different upload operation.");
      if (existing.status === "completed") return { state: "replay", documentId: existing.documentId, operation: existing };
      if (existing.status === "processing" && isLeaseActive(existing.leaseUntil)) return { state: "in-progress", documentId: existing.documentId, operation: existing };
    }
    const now = nowIso();
    const ownerToken = crypto.randomUUID();
    const documentId = existing?.documentId || `document-${identity.operationId}`;
    const operation = {
      ...identity,
      id: identity.operationId,
      documentId,
      status: "processing",
      processingStartedAt: existing?.processingStartedAt || now,
      updatedAt: now,
      leaseUntil: leaseUntil(),
      ownerToken,
      sideEffects: emptySideEffects(existing?.sideEffects),
    };
    transaction.set(COLLECTION, identity.operationId, operation, { merge: false });
    return { state: existing ? "recovered" : "claimed", documentId, ownerToken, operation };
  });
}

export async function completeDocumentUpload({ identity, ownerToken, document }) {
  atomicityRequired();
  return runRecordTransaction(async (transaction) => {
    const operation = await transaction.get(COLLECTION, identity.operationId);
    if (!operation || operation.fingerprint !== identity.fingerprint) throw conflict("Upload operation could not be finalized safely.");
    if (operation.ownerToken !== ownerToken) throw operationError("Upload recovery lease was superseded. Retry the upload.", 409, "UPLOAD_LEASE_LOST");
    const existingDocument = await transaction.get("documents", operation.documentId);
    const canonical = existingDocument || { ...document, id: operation.documentId };
    if (!existingDocument) transaction.set("documents", operation.documentId, canonical, { merge: false });
    transaction.set(COLLECTION, identity.operationId, {
      documentId: operation.documentId,
      status: "processing",
      documentCreatedAt: operation.documentCreatedAt || nowIso(),
      updatedAt: nowIso(),
      leaseUntil: leaseUntil(),
      sideEffects: emptySideEffects(operation.sideEffects),
    }, { merge: true });
    return { state: existingDocument ? "existing" : "created", documentId: operation.documentId, document: canonical };
  });
}

export async function claimUploadSideEffect({ operationId, ownerToken, effect }) {
  atomicityRequired();
  if (!UPLOAD_SIDE_EFFECTS.includes(effect)) throw new Error(`Unknown upload side effect: ${effect}`);
  return runRecordTransaction(async (transaction) => {
    const operation = await transaction.get(COLLECTION, operationId);
    if (!operation) throw operationError("Upload operation was not found.", 409, "UPLOAD_OPERATION_NOT_FOUND");
    if (operation.status === "completed") return { state: "completed" };
    if (operation.ownerToken !== ownerToken) throw operationError("Upload recovery lease was superseded. Retry the upload.", 409, "UPLOAD_LEASE_LOST");
    const current = operation.sideEffects?.[effect] || { status: "pending" };
    if (current.status === "completed") return { state: "completed" };
    if (current.status === "processing" && isLeaseActive(current.leaseUntil)) return { state: "in-progress" };
    const updatedSideEffects = { ...emptySideEffects(operation.sideEffects), [effect]: { status: "processing", startedAt: nowIso(), updatedAt: nowIso(), leaseUntil: leaseUntil(), ownerToken } };
    transaction.set(COLLECTION, operationId, { status: "processing", updatedAt: nowIso(), leaseUntil: leaseUntil(), sideEffects: updatedSideEffects }, { merge: true });
    return { state: "claimed" };
  });
}

export async function completeUploadSideEffect({ operationId, ownerToken, effect, identity = null }) {
  atomicityRequired();
  return runRecordTransaction(async (transaction) => {
    const operation = await transaction.get(COLLECTION, operationId);
    if (!operation || operation.ownerToken !== ownerToken) return { state: "lease-lost" };
    const current = operation.sideEffects?.[effect] || {};
    const updatedSideEffects = { ...emptySideEffects(operation.sideEffects), [effect]: { ...current, status: "completed", completedAt: nowIso(), identity: identity || current.identity || null } };
    transaction.set(COLLECTION, operationId, { sideEffects: updatedSideEffects, updatedAt: nowIso() }, { merge: true });
    return { state: "completed" };
  });
}

export async function failUploadSideEffect({ operationId, ownerToken, effect, error }) {
  if (!firestore) return;
  await runRecordTransaction(async (transaction) => {
    const operation = await transaction.get(COLLECTION, operationId);
    if (!operation || operation.ownerToken !== ownerToken) return;
    const updatedSideEffects = { ...emptySideEffects(operation.sideEffects), [effect]: { status: "recoverable", failedAt: nowIso(), error: String(error?.message || error || "side effect failed").slice(0, 300) } };
    transaction.set(COLLECTION, operationId, { status: "recoverable", leaseUntil: nowIso(), updatedAt: nowIso(), sideEffects: updatedSideEffects }, { merge: true });
  }).catch(() => {});
}

export async function completeDocumentUploadOperation({ operationId, ownerToken }) {
  atomicityRequired();
  return runRecordTransaction(async (transaction) => {
    const operation = await transaction.get(COLLECTION, operationId);
    if (!operation || operation.ownerToken !== ownerToken) return false;
    const complete = UPLOAD_SIDE_EFFECTS.every((effect) => operation.sideEffects?.[effect]?.status === "completed");
    if (!complete) return false;
    transaction.set(COLLECTION, operationId, { status: "completed", completedAt: nowIso(), updatedAt: nowIso(), leaseUntil: null }, { merge: true });
    return true;
  });
}

export const idempotentStorageObjectName = (identity, file) => `${identity.operationId}${path.extname(file.originalname || "").toLowerCase()}`;
