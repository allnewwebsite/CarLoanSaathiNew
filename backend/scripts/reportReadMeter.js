import fs from "node:fs";
import readline from "node:readline";

const input = process.argv[2];
const rows = new Map();

function routeKey(item = {}) {
  const method = item.method || "GET";
  const route = String(item.route || item.endpoint || "").replace(/\?.*$/, "");
  return `${method} ${route || "unknown"}`;
}

function endpointRow(key) {
  if (!rows.has(key)) {
    rows.set(key, {
      route: key,
      calls: 0,
      totalReads: 0,
      totalBytes: 0,
      totalMs: 0,
      cacheHits: 0,
      cacheMisses: 0,
      collections: new Map(),
      projectionCalls: 0,
    });
  }
  return rows.get(key);
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    const start = line.indexOf("{");
    if (start < 0) return null;
    try {
      return JSON.parse(line.slice(start));
    } catch {
      return null;
    }
  }
}

function addCollections(row, byCollection = {}) {
  for (const [collection, reads] of Object.entries(byCollection || {})) {
    row.collections.set(collection, (row.collections.get(collection) || 0) + Number(reads || 0));
    if (/Views|Projection|Metrics|Catalog/i.test(collection)) row.projectionCalls += 1;
  }
}

function summarize() {
  const ranked = [...rows.values()]
    .map((row) => {
      const cacheEvents = row.cacheHits + row.cacheMisses;
      const collections = [...row.collections.entries()].sort((a, b) => b[1] - a[1]);
      return {
        route: row.route,
        calls: row.calls,
        totalReads: row.totalReads,
        readsPerRequest: row.calls ? Number((row.totalReads / row.calls).toFixed(2)) : 0,
        cacheHitRate: cacheEvents ? `${Math.round((row.cacheHits / cacheEvents) * 100)}%` : "n/a",
        projectionUsage: row.projectionCalls ? "yes" : "no",
        avgResponseBytes: row.calls ? Math.round(row.totalBytes / row.calls) : 0,
        avgDurationMs: row.calls ? Math.round(row.totalMs / row.calls) : 0,
        collectionsTouched: collections.map(([name]) => name).slice(0, 8).join(", ") || "none",
      };
    })
    .sort((a, b) => b.totalReads - a.totalReads)
    .slice(0, 20);

  console.log(JSON.stringify({
    source: input || "stdin",
    generatedAt: new Date().toISOString(),
    endpointsSeen: rows.size,
    top20: ranked,
  }, null, 2));
}

async function main() {
  const stream = input ? fs.createReadStream(input, "utf8") : process.stdin;
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of reader) {
    const item = parseLine(line);
    if (!item || item.tag !== "READ-METER") continue;
    const row = endpointRow(routeKey(item));
    row.calls += 1;
    row.totalReads += Number(item.totalEstimatedReads || 0);
    row.totalBytes += Number(item.responseBytes || 0);
    row.totalMs += Number(item.durationMs || 0);
    row.cacheHits += Number(item.cacheHit || 0);
    row.cacheMisses += Number(item.cacheMiss || 0);
    addCollections(row, item.byCollection);
  }
  summarize();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
