import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCompatibleSuperAdminProfile,
  buildSuperAdminProfilePatch,
  isActiveSuperAdminProfile,
} from "../services/superAdminProfile.service.js";

const authUser = {
  uid: "configured-admin-uid",
  email: "admin@example.com",
  displayName: "Configured Admin",
  emailVerified: true,
};

test("missing Super Admin Firestore profile receives the canonical active profile", () => {
  const patch = buildSuperAdminProfilePatch({ authUser });
  assert.equal(patch.uid, authUser.uid);
  assert.equal(patch.email, authUser.email);
  assert.equal(patch.role, "super-admin");
  assert.equal(patch.active, true);
  assert.equal(patch.approved, true);
  assert.equal(patch.accountActive, true);
  assert.equal(patch.accountApproved, true);
  assert.equal(isActiveSuperAdminProfile(patch, authUser), true);
});

test("Super Admin repair is idempotent once the canonical profile exists", () => {
  const canonical = buildSuperAdminProfilePatch({ authUser });
  assert.deepEqual(buildSuperAdminProfilePatch({ authUser, existingProfile: canonical }), {});
});

test("Super Admin repair cannot promote a different user or role", () => {
  assert.throws(
    () => assertCompatibleSuperAdminProfile({ uid: "another-uid", email: authUser.email }, authUser),
    /different Firebase UID/,
  );
  assert.throws(
    () => assertCompatibleSuperAdminProfile({ uid: authUser.uid, email: authUser.email, role: "finance-desk" }, authUser),
    /different role/,
  );
});
