import assert from "node:assert/strict";
import test from "node:test";
import { cached, cacheStats, clearCachedTags, clearCachedValue, getCachedValue, pruneCache, setCachedValue } from "../services/ttlCache.service.js";

test("cache tags clear related entries without clearing unrelated entries", () => {
  clearCachedValue();
  setCachedValue("lead-detail:lead-1:bank-response", { id: "lead-1" }, 10000);
  setCachedValue("timeline:lead:lead-1:v1", [{ id: "event-1" }], 10000);
  setCachedValue("timeline:lead:lead-2:v1", [{ id: "event-2" }], 10000);

  clearCachedTags("lead:lead-1");

  assert.equal(getCachedValue("lead-detail:lead-1:bank-response"), null);
  assert.equal(getCachedValue("timeline:lead:lead-1:v1"), null);
  assert.deepEqual(getCachedValue("timeline:lead:lead-2:v1"), [{ id: "event-2" }]);
});

test("lead list tag clears portal list caches", () => {
  clearCachedValue();
  setCachedValue("dealer:leads:dealer-1", ["dealer"], 10000);
  setCachedValue("bank:leads:bank-1", ["bank"], 10000);
  setCachedValue("lead-query:projection:abc", ["projection"], 10000);
  setCachedValue("auth:session:user-1", { uid: "user-1" }, 10000);

  clearCachedTags("lead:list");

  assert.equal(getCachedValue("dealer:leads:dealer-1"), null);
  assert.equal(getCachedValue("bank:leads:bank-1"), null);
  assert.equal(getCachedValue("lead-query:projection:abc"), null);
  assert.deepEqual(getCachedValue("auth:session:user-1"), { uid: "user-1" });
});

test("pending cache loads do not repopulate after invalidation", async () => {
  clearCachedValue();
  let resolveLoader;
  const pending = cached("admin:analytics", 10000, () => new Promise((resolve) => {
    resolveLoader = resolve;
  }));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(cacheStats().pending, 1);
  clearCachedTags("admin:summary");
  resolveLoader({ total: 1 });
  assert.deepEqual(await pending, { total: 1 });
  assert.equal(getCachedValue("admin:analytics"), null);
});

test("cache pruning removes expired and least-recently-used entries without stale tags", async () => {
  clearCachedValue();
  setCachedValue("cache:old", 1, 1, { tags: ["old-tag"] });
  await new Promise((resolve) => setTimeout(resolve, 5));
  setCachedValue("cache:one", 1, 10000, { tags: ["one-tag"] });
  setCachedValue("cache:two", 2, 10000, { tags: ["two-tag"] });
  getCachedValue("cache:one");
  pruneCache(100);
  assert.equal(getCachedValue("cache:old"), null);

  setCachedValue("cache:one", 3, 10000, { tags: ["replacement-tag"] });
  clearCachedTags("one-tag");
  assert.equal(getCachedValue("cache:one"), 3);
  clearCachedTags("replacement-tag");
  assert.equal(getCachedValue("cache:one"), null);

  for (let index = 0; index < 101; index += 1) {
    setCachedValue(`bounded:${index}`, index, 10000);
  }
  getCachedValue("bounded:0");
  pruneCache(100);
  assert.equal(cacheStats().entries, 100);
  assert.equal(getCachedValue("bounded:1"), null);
  assert.equal(getCachedValue("bounded:0"), 0);
});
