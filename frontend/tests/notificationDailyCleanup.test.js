import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const center = fs.readFileSync(new URL("../src/components/NotificationCenter.jsx", import.meta.url), "utf8");

test("notification cleanup realtime event forces canonical list and unread reconciliation", () => {
  assert.match(center, /eventType === "NOTIFICATIONS_CLEANED"/);
  assert.match(center, /refreshNotifications\(\{ force: true \}\)/);
  assert.match(center, /skipCache: force/);
});
