import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const center = fs.readFileSync(new URL("../src/components/NotificationCenter.jsx", import.meta.url), "utf8");

test("notification center ignores replayed realtime notification frames", () => {
  assert.match(center, /processedRealtimeEvents/);
  assert.match(center, /processedRealtimeEvents\.current\.has\(realtimeKey\)/);
  assert.match(center, /processedRealtimeEvents\.current\.add\(realtimeKey\)/);
});
