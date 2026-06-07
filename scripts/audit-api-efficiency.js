import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const backendRoot = path.join(root, "backend");
const routeDir = path.join(backendRoot, "routes");
const controllerDir = path.join(backendRoot, "controllers");
const serviceDir = path.join(backendRoot, "services");
const httpMethods = ["get", "post", "put", "patch", "delete"];
const collectionCallPattern = /\b(?:createRecord|getRecord|updateRecord|upsertRecord|deleteRecord|listRecords|queryRecords|countRecords|findRecordsByField|deleteRecordsByQuery)\(\s*["']([^"']+)["']/g;

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function listJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listJsFiles(full);
      return entry.name.endsWith(".js") ? [full] : [];
    });
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function importedLocalFiles(file, text, folders) {
  const imports = [...text.matchAll(/import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((value) => value.startsWith("."));
  return unique(imports.map((specifier) => {
    const resolved = path.resolve(path.dirname(file), specifier);
    const withJs = resolved.endsWith(".js") ? resolved : `${resolved}.js`;
    return folders.some((folder) => withJs.startsWith(folder)) && fs.existsSync(withJs) ? withJs : "";
  }));
}

function controllerFunctionNames(text) {
  return new Set([...text.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)/g)].map((match) => match[1]));
}

function functionBody(text, functionName) {
  if (!functionName) return text;
  const declaration = new RegExp(`export\\s+async\\s+function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`, "m").exec(text)
    || new RegExp(`async\\s+function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`, "m").exec(text)
    || new RegExp(`export\\s+function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`, "m").exec(text)
    || new RegExp(`function\\s+${functionName}\\s*\\([^)]*\\)\\s*\\{`, "m").exec(text);
  if (!declaration) return "";
  let index = declaration.index + declaration[0].length;
  let depth = 1;
  while (index < text.length && depth > 0) {
    const char = text[index];
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    index += 1;
  }
  return text.slice(declaration.index, index);
}

function routePrefixFromServer(routeFile) {
  const server = read(path.join(backendRoot, "server.js"));
  const basename = path.basename(routeFile);
  const importMatch = [...server.matchAll(/import\s+([A-Za-z0-9_]+)\s+from\s+["']\.\/routes\/([^"']+)["']/g)]
    .find((match) => `${match[2]}.js`.replace(/\.js\.js$/, ".js") === basename || match[2].endsWith(basename.replace(/\.js$/, "")));
  if (!importMatch) return "/api";
  const varName = importMatch[1];
  const useMatch = server.match(new RegExp(`app\\.use\\(["']([^"']+)["'],\\s*${varName}\\)`));
  return useMatch?.[1] || "/api";
}

function routeEntries(routeFile) {
  const text = read(routeFile);
  const prefix = routePrefixFromServer(routeFile);
  const controllerFiles = importedLocalFiles(routeFile, text, [controllerDir]);
  const entries = [];
  for (const method of httpMethods) {
    const pattern = new RegExp(`router\\.${method}\\(\\s*["']([^"']+)["']([\\s\\S]*?)\\);`, "g");
    for (const match of text.matchAll(pattern)) {
      const pathPart = match[1] === "/" ? "" : match[1];
      const handlersText = match[2];
      const controller = controllerFiles
        .map((file) => ({ file, names: controllerFunctionNames(read(file)) }))
        .flatMap(({ file, names }) => [...names]
          .filter((name) => new RegExp(`\\b${name}\\b`).test(handlersText))
          .map((name) => ({ file, name })))
        .at(-1) || null;
      entries.push({
        method: method.toUpperCase(),
        route: `${prefix}${pathPart}`.replace(/\/+/g, "/").replace(/^api/, "/api"),
        routeFile,
        controllerFile: controller?.file || null,
        controller: controller?.name || "inline-or-router-middleware",
      });
    }
  }
  if (text.includes("router.use(")) {
    entries.push({
      method: "USE",
      route: `${prefix}/*`,
      routeFile,
      controllerFile: null,
      controller: "router-level-middleware",
    });
  }
  return entries;
}

function collectionCalls(text) {
  return unique([...text.matchAll(collectionCallPattern)].map((match) => match[1]));
}

function complexitySignals(text) {
  return {
    serviceCalls: (text.match(/\b[A-Za-z0-9_]+Service\b|await\s+[A-Za-z0-9_]+\(/g) || []).length,
    loops: (text.match(/\b(for|forEach|map|filter|reduce)\s*\(/g) || []).length,
    promiseFanout: (text.match(/Promise\.(all|allSettled)/g) || []).length,
    inMemoryFiltering: (text.match(/\.(filter|sort|reduce)\(/g) || []).length,
    aggregations: (text.match(/\b(count|total|sum|average|analytics|metrics|reduce)\b/gi) || []).length,
  };
}

function routeAnalysis(entry) {
  const controllerText = entry.controllerFile ? read(entry.controllerFile) : "";
  const controllerBody = entry.controllerFile ? functionBody(controllerText, entry.controller) || controllerText : "";
  const serviceFiles = entry.controllerFile ? importedLocalFiles(entry.controllerFile, controllerText, [serviceDir]) : [];
  const serviceText = serviceFiles.map((file) => {
    const text = read(file);
    const exportedNames = [...text.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)/g)].map((match) => match[1]);
    const referenced = exportedNames.filter((name) => controllerBody.includes(name));
    return referenced.length ? referenced.map((name) => functionBody(text, name)).join("\n") : "";
  }).join("\n");
  const combined = `${controllerBody}\n${serviceText}`;
  const activeServiceFiles = serviceFiles.filter((file) => {
    const text = read(file);
    const exportedNames = [...text.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)/g)].map((match) => match[1]);
    return exportedNames.some((name) => controllerBody.includes(name));
  });
  const collections = collectionCalls(combined);
  const signals = complexitySignals(combined);
  const usesProjection = /projection|Views|leadDetailsProjection|timelineProjection|queryLeadProjectionForUser|syncLeadProjection/i.test(combined);
  const usesCache = /cached\(|ttlCache|getCached|cache/i.test(combined);
  const usesQueue = /addQueueJob|queueSafe|setImmediate|queueMicrotask|Promise\.resolve\(\)\.then/i.test(combined);
  const approximateResponseRisk = /listRecords|limit:\s*100|limit:\s*250|limit:\s*500|ecosystem|analytics|dashboard/i.test(combined) ? "high" : "medium";
  const score = collections.length * 2
    + serviceFiles.length
    + signals.promiseFanout * 3
    + signals.inMemoryFiltering
    + signals.aggregations
    + (usesProjection ? 0 : 3)
    + (usesCache ? 0 : 1);
  const risk = score >= 35 ? "critical" : score >= 22 ? "high" : score >= 12 ? "medium" : "low";
  return {
    ...entry,
    routeFile: relative(entry.routeFile),
    controllerFile: entry.controllerFile ? relative(entry.controllerFile) : "",
    serviceFiles: activeServiceFiles.map(relative),
    collections,
    projectionUsed: usesProjection,
    cacheUsed: usesCache,
    backgroundReady: usesQueue,
    approximateResponseRisk,
    complexity: signals,
    risk,
    score,
  };
}

function summarize(inventory) {
  const riskCounts = inventory.reduce((acc, item) => {
    acc[item.risk] = (acc[item.risk] || 0) + 1;
    return acc;
  }, {});
  const noProjection = inventory.filter((item) => item.collections.includes("leads") && !item.projectionUsed);
  const highFanout = inventory.filter((item) => item.serviceFiles.length >= 4 || item.collections.length >= 6 || item.complexity.promiseFanout >= 3);
  const inMemory = inventory.filter((item) => item.complexity.inMemoryFiltering >= 10);
  const aggregationHeavy = inventory.filter((item) => item.complexity.aggregations >= 25);
  return {
    generatedAt: new Date().toISOString(),
    totalRoutes: inventory.length,
    riskCounts,
    topRisks: inventory.slice().sort((a, b) => b.score - a.score).slice(0, 15),
    phaseFindings: {
      fanOut: highFanout,
      projectionFirstGaps: noProjection,
      inMemoryFiltering: inMemory,
      repeatedAggregationRisk: aggregationHeavy,
      payloadRisk: inventory.filter((item) => item.approximateResponseRisk === "high"),
      cacheExpansionCandidates: inventory.filter((item) => !item.cacheUsed && ["critical", "high"].includes(item.risk)),
    },
  };
}

function printReport(summary) {
  console.log("CarLoanSaathi API Efficiency Audit");
  console.log(`Generated: ${summary.generatedAt}`);
  console.log(`Routes inventoried: ${summary.totalRoutes}`);
  console.table(Object.entries(summary.riskCounts).map(([risk, count]) => ({ risk, count })));
  console.log("\nTop API efficiency risks:");
  console.table(summary.topRisks.map((item) => ({
    method: item.method,
    route: item.route,
    controller: item.controller,
    risk: item.risk,
    score: item.score,
    collections: item.collections.length,
    services: item.serviceFiles.length,
    projection: item.projectionUsed ? "yes" : "no",
    cache: item.cacheUsed ? "yes" : "no",
  })));
  console.log("\nPhase finding counts:");
  console.table(Object.entries(summary.phaseFindings).map(([phase, items]) => ({ phase, count: items.length })));
}

const inventory = listJsFiles(routeDir).flatMap(routeEntries).map(routeAnalysis);
const summary = summarize(inventory);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ summary, inventory }, null, 2));
} else {
  printReport(summary);
}

const failed = inventory.filter((item) => item.risk === "critical" && item.collections.includes("leads") && !item.projectionUsed);
if (process.argv.includes("--strict") && failed.length) {
  console.error("\nStrict API efficiency audit failed. Critical lead APIs without projection-first path:");
  for (const item of failed) console.error(`- ${item.method} ${item.route} -> ${item.controllerFile}`);
  process.exit(1);
}
