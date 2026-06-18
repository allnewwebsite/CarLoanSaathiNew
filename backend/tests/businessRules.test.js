import assert from "node:assert/strict";
import test from "node:test";
import {
  assertValidDocumentStatusTransition,
  assertValidStatusTransition,
  DOCUMENT_STATUSES,
  LEAD_STATUSES,
  normalizeStatus,
} from "../utils/status.constants.js";
import { assertLeadMutable } from "../utils/deadCase.js";
import {
  isProfessionalPlan,
  normalizeOnboardingPlan,
  ONBOARDING_PLANS,
} from "../utils/onboardingPlan.js";
import { errorResponse, successResponse } from "../utils/apiResponse.js";
import { hashTemporaryPassword, verifyTemporaryPassword } from "../services/temporaryPassword.service.js";

function mockResponse() {
  return {
    locals: {
      requestId: "req-test",
      startedAt: Date.now(),
    },
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("normalizes legacy lead statuses used by existing records", () => {
  assert.equal(normalizeStatus("Pending Documents"), LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS);
  assert.equal(normalizeStatus("Bank Processing"), LEAD_STATUSES.UNDER_BANK_PROCESS);
  assert.equal(normalizeStatus("Disbursed"), LEAD_STATUSES.DISBURSED);
  assert.equal(normalizeStatus(""), LEAD_STATUSES.NEW);
});

test("allows only configured lead workflow transitions", () => {
  assert.equal(assertValidStatusTransition("New", "Pending Documents"), LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS);
  assert.equal(assertValidStatusTransition(LEAD_STATUSES.APPROVED, LEAD_STATUSES.DISBURSED), LEAD_STATUSES.DISBURSED);
  assert.throws(
    () => assertValidStatusTransition(LEAD_STATUSES.CLOSED, LEAD_STATUSES.NEW),
    /Invalid status transition/,
  );
  assert.throws(
    () => assertValidStatusTransition(LEAD_STATUSES.NEW, "NOT_A_STATUS"),
    /Invalid lead status/,
  );
});

test("allows only configured document workflow transitions", () => {
  assert.equal(
    assertValidDocumentStatusTransition(DOCUMENT_STATUSES.UPLOADED, DOCUMENT_STATUSES.APPROVED),
    DOCUMENT_STATUSES.APPROVED,
  );
  assert.throws(
    () => assertValidDocumentStatusTransition(DOCUMENT_STATUSES.APPROVED, "Missing"),
    /Invalid document status/,
  );
});

test("blocks mutation of dead cases outside Finance Desk", () => {
  assert.doesNotThrow(() => assertLeadMutable({ isDeadCase: false }));
  assert.doesNotThrow(() => assertLeadMutable({ isDeadCase: true }, { role: "finance-desk" }));
  assert.throws(() => assertLeadMutable({ isDeadCase: true }), (error) => {
    assert.equal(error.code, "DEAD_CASE_IMMUTABLE");
    assert.equal(error.status, 409);
    return true;
  });
});

test("normalizes onboarding plans defensively", () => {
  assert.equal(normalizeOnboardingPlan("professional"), ONBOARDING_PLANS.PROFESSIONAL);
  assert.equal(normalizeOnboardingPlan("unknown"), ONBOARDING_PLANS.TRIAL);
  assert.equal(isProfessionalPlan("PROFESSIONAL"), true);
  assert.equal(isProfessionalPlan("TRIAL"), false);
});

test("standard API response helpers include request metadata", () => {
  const ok = mockResponse();
  successResponse(ok, { message: "Created", data: { id: "1" }, status: 201 });
  assert.equal(ok.statusCode, 201);
  assert.equal(ok.body.success, true);
  assert.equal(ok.body.message, "Created");
  assert.equal(ok.body.data.id, "1");
  assert.equal(ok.body.meta.requestId, "req-test");

  const failed = mockResponse();
  errorResponse(failed, { status: 403, errorCode: "NOPE", message: "Denied" });
  assert.equal(failed.statusCode, 403);
  assert.equal(failed.body.success, false);
  assert.equal(failed.body.errorCode, "NOPE");
  assert.equal(failed.body.requestId, "req-test");
});

test("temporary staff passwords are stored as verifiable non-plaintext hashes", () => {
  const password = "CLS@1234x";
  const hash = hashTemporaryPassword(password);
  assert.notEqual(hash, password);
  assert.equal(verifyTemporaryPassword(password, hash), true);
  assert.equal(verifyTemporaryPassword("CLS@9999x", hash), false);
});
