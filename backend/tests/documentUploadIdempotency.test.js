import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import test from "node:test";
import { firestore } from "../firebase/admin.js";
import {
  UPLOAD_PROCESSING_LEASE_MS,
  claimDocumentUpload,
  idempotencyKeyFromRequest,
  uploadOperationIdentity,
  uploadSideEffectIdentities,
} from "../services/documentUploadIdempotency.service.js";

function requestWithKey(value) {
  return { get(name) { return name === "Idempotency-Key" ? value : undefined; } };
}

test("Idempotency-Key validation is behavioral and bounded", () => {
  assert.equal(idempotencyKeyFromRequest(requestWithKey(" upload-1 ")), "upload-1");
  assert.equal(idempotencyKeyFromRequest(requestWithKey(undefined)), null);
  assert.throws(() => idempotencyKeyFromRequest(requestWithKey("bad key")), (error) => error.code === "INVALID_IDEMPOTENCY_KEY");
  assert.throws(() => idempotencyKeyFromRequest(requestWithKey("")), (error) => error.code === "INVALID_IDEMPOTENCY_KEY");
});

test("upload identity fingerprints the authenticated scope and file content", async () => {
  const directory = await mkdtemp(`${os.tmpdir()}\\cls-upload-`);
  const filePath = `${directory}\\document.pdf`;
  await writeFile(filePath, "%PDF-test");
  try {
    const base = await uploadOperationIdentity({
      key: "same-key",
      user: { uid: "user-1", email: "finance@example.com", dealershipId: "dealer-1" },
      lead: { id: "lead-1", caseId: "CLS-1", dealershipId: "dealer-1" },
      documentType: "PAN",
      file: { path: filePath, mimetype: "application/pdf", size: 9 },
    });
    const otherCase = await uploadOperationIdentity({
      key: "same-key",
      user: { uid: "user-1", email: "finance@example.com", dealershipId: "dealer-1" },
      lead: { id: "lead-2", caseId: "CLS-2", dealershipId: "dealer-1" },
      documentType: "PAN",
      file: { path: filePath, mimetype: "application/pdf", size: 9 },
    });
    const otherUser = await uploadOperationIdentity({
      key: "same-key",
      user: { uid: "user-2", email: "other@example.com", dealershipId: "dealer-1" },
      lead: { id: "lead-1", caseId: "CLS-1", dealershipId: "dealer-1" },
      documentType: "PAN",
      file: { path: filePath, mimetype: "application/pdf", size: 9 },
    });
    assert.equal(base.operationId, otherCase.operationId);
    assert.notEqual(base.fingerprint, otherCase.fingerprint);
    assert.notEqual(base.operationId, otherUser.operationId);
    assert.equal(base.contentHash, crypto.createHash("sha256").update("%PDF-test").digest("hex"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("one canonical document produces stable identities for every side effect", () => {
  const first = uploadSideEffectIdentities("document-upload-1");
  const second = uploadSideEffectIdentities("document-upload-1");
  assert.deepEqual(first, second);
  assert.equal(new Set(Object.values(first)).size, 5);
  assert.ok(Object.values(first).every((value) => value.includes("document-upload-1")));
});

test("keyed uploads fail closed when durable Firestore atomicity is unavailable", async (t) => {
  if (firestore) {
    t.skip("Firestore is configured; unavailable-provider behavior requires an isolated Firestore failure test.");
    return;
  }
  await assert.rejects(
    claimDocumentUpload({ operationId: "document-upload-test", fingerprint: "fingerprint", uploaderId: "user", dealershipId: "dealer" }),
    (error) => error.code === "UPLOAD_IDEMPOTENCY_UNAVAILABLE" && error.status === 503,
  );
  assert.ok(UPLOAD_PROCESSING_LEASE_MS >= 5 * 60 * 1000);
});
