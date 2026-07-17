import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const src = path.join(process.cwd(), "src");

test("every portal account menu uses the shared change password dialog", async () => {
  const menu = await readFile(path.join(src, "components", "PortalUserMenu.jsx"), "utf8");
  const dialog = await readFile(path.join(src, "components", "ChangePasswordDialog.jsx"), "utf8");
  assert.match(menu, /Change Password/);
  assert.match(menu, /<ChangePasswordDialog/);
  assert.match(dialog, /Current Password/);
  assert.match(dialog, /New Password/);
  assert.match(dialog, /Confirm New Password/);
  assert.match(dialog, /PASSWORD_PATTERN/);
  assert.match(dialog, /Passwords do not match/);
  assert.match(dialog, /Change Password/);
  assert.match(dialog, /EyeOff/);
});

test("successful standard password change is backend controlled and clears the web session", async () => {
  const context = await readFile(path.join(src, "context", "AuthContextCore.jsx"), "utf8");
  assert.match(context, /api\.post\("\/auth\/password\/change"/);
  assert.match(context, /clearLocalSession\(\{ signOutFirebase: true, reason: "password-changed" \}\)/);
  assert.match(context, /SESSION_REVOKED/);
});
