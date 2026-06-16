import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const distDir = path.resolve("dist", "assets");
const maxChunkKb = Number(process.env.BUNDLE_MAX_CHUNK_KB || 350);
const warnChunkKb = Number(process.env.BUNDLE_WARN_CHUNK_KB || 150);

function kb(bytes) {
  return Number((bytes / 1024).toFixed(2));
}

async function assetRows() {
  const names = await readdir(distDir).catch(() => []);
  const rows = [];
  for (const name of names) {
    if (!name.endsWith(".js") && !name.endsWith(".css")) continue;
    const filePath = path.join(distDir, name);
    const info = await stat(filePath);
    rows.push({ name, sizeKb: kb(info.size), type: path.extname(name).slice(1) });
  }
  return rows.sort((left, right) => right.sizeKb - left.sizeKb);
}

const rows = await assetRows();
if (!rows.length) {
  console.error("No build assets found. Run npm run build before bundle:report.");
  process.exit(1);
}

const largest = rows.slice(0, 12);
console.log("Largest frontend build assets:");
for (const row of largest) {
  const marker = row.sizeKb >= maxChunkKb ? "FAIL" : row.sizeKb >= warnChunkKb ? "WARN" : "OK";
  console.log(`${marker.padEnd(4)} ${String(row.sizeKb).padStart(8)} KB  ${row.name}`);
}

const failures = rows.filter((row) => row.type === "js" && row.sizeKb > maxChunkKb);
if (failures.length) {
  console.error(`Bundle budget failed: ${failures.length} JS asset(s) exceed ${maxChunkKb} KB.`);
  process.exit(1);
}
