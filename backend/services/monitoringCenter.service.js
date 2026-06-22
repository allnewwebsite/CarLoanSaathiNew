const WINDOW_LIMIT = Number(process.env.MONITORING_WINDOW_LIMIT || 1500);
const SLOW_API_MS = Number(process.env.MONITORING_SLOW_API_MS || 1000);
const REALTIME_DISCONNECT_STORM_THRESHOLD = Number(process.env.REALTIME_DISCONNECT_STORM_THRESHOLD || 25);
const REPEATED_API_FAILURE_THRESHOLD = Number(process.env.REPEATED_API_FAILURE_THRESHOLD || 10);

const state = {
  api: [],
  reads: [],
  signals: [],
  realtime: [],
};

function nowIso() {
  return new Date().toISOString();
}

function todayPrefix() {
  return nowIso().slice(0, 10);
}

function pushLimited(bucket, item) {
  bucket.push({ at: nowIso(), ...item });
  if (bucket.length > WINDOW_LIMIT) bucket.splice(0, bucket.length - WINDOW_LIMIT);
}

function routeKey(value = "") {
  return String(value || "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .split("?")[0]
    .replace(/\/[A-Za-z0-9_-]{16,}(?=\/|$)/g, "/:id")
    .replace(/\/[A-Fa-f0-9]{8,}(?=\/|$)/g, "/:id")
    || "/";
}

function percentile(values = [], p = 95) {
  const clean = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const index = Math.min(clean.length - 1, Math.ceil((p / 100) * clean.length) - 1);
  return clean[index];
}

function average(values = []) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return 0;
  return Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length);
}

function groupBy(items, keyFn, seedFn = () => ({}), applyFn = () => {}) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, { key, ...seedFn(item) });
    applyFn(map.get(key), item);
  });
  return [...map.values()];
}

function statusFromThreshold(value, warning, critical, inverse = false) {
  if (inverse) {
    if (value <= critical) return "critical";
    if (value <= warning) return "warning";
    return "healthy";
  }
  if (value >= critical) return "critical";
  if (value >= warning) return "warning";
  return "healthy";
}

export function recordApiMetric(meta = {}) {
  pushLimited(state.api, {
    method: meta.method || "GET",
    endpoint: routeKey(meta.endpoint || meta.path || ""),
    rawEndpoint: meta.endpoint || meta.path || "",
    statusCode: Number(meta.statusCode || 0),
    durationMs: Number(meta.durationMs || 0),
    responseBytes: Number(meta.responseBytes || 0),
    role: meta.role || null,
    userId: meta.userId || null,
  });
}

export function recordReadMeterMetric(meta = {}) {
  pushLimited(state.reads, {
    method: meta.method || "GET",
    endpoint: routeKey(meta.route || meta.endpoint || ""),
    route: meta.route || meta.endpoint || "",
    totalEstimatedReads: Number(meta.totalEstimatedReads || 0),
    writeCount: Number(meta.writeCount || 0),
    totalEstimatedWrites: Number(meta.totalEstimatedWrites || 0),
    cacheHit: Number(meta.cacheHit || 0),
    cacheMiss: Number(meta.cacheMiss || 0),
    cacheHitRate: meta.cacheHitRate === null || meta.cacheHitRate === undefined ? null : Number(meta.cacheHitRate),
    duplicateReadCount: Number(meta.duplicateReadCount || 0),
    duplicateReads: Array.isArray(meta.duplicateReads) ? meta.duplicateReads : [],
    byCollection: meta.byCollection || {},
    writesByCollection: meta.writesByCollection || {},
    writeOperations: meta.writeOperations || {},
    durationMs: Number(meta.durationMs || 0),
    responseBytes: Number(meta.responseBytes || 0),
  });
}

export function recordMonitoringSignal(tag, meta = {}) {
  pushLimited(state.signals, {
    tag,
    endpoint: routeKey(meta.endpoint || meta.path || ""),
    path: meta.path || "",
    collection: meta.collection || null,
    projectionId: meta.projectionId || meta.leadId || meta.sourceId || null,
    dealerId: meta.dealerId || null,
    dealerBrand: meta.dealerBrand || null,
    dealerStatus: meta.dealerStatus || null,
    bankId: meta.bankId || null,
    branchId: meta.branchId || null,
    state: meta.state || null,
    location: meta.location || meta.branchLocation || null,
    capacityRange: meta.capacityRange || meta.monthlyLoanCapacity || null,
    monthlySalesCapacity: meta.monthlySalesCapacity || null,
    sourceCollection: meta.sourceCollection || null,
    cacheKey: meta.cacheKey || null,
    estimatedReads: Number(meta.estimatedReads || 0),
    resultCount: Number(meta.resultCount || 0),
    durationMs: Number(meta.durationMs || 0),
    projectionLagMs: Number(meta.projectionLagMs || 0),
    staleProjectionCount: Number(meta.staleProjectionCount || 0),
    reason: meta.reason || null,
  });
}

export function recordRealtimeMetric(meta = {}) {
  pushLimited(state.realtime, {
    eventType: meta.eventType || "realtime",
    delivered: Number(meta.delivered || 0),
    errors: Number(meta.errors || 0),
    dropped: Number(meta.dropped || 0),
    activeClients: Number(meta.activeClients || 0),
    candidateClients: Number(meta.candidateClients || 0),
    durationMs: Number(meta.durationMs || 0),
    latencyMs: Number(meta.latencyMs || meta.durationMs || 0),
    disconnected: Number(meta.disconnected || 0),
    notificationDelta: Number(meta.notificationDelta || 0),
  });
}

function todayItems(items) {
  const prefix = todayPrefix();
  return items.filter((item) => String(item.at || "").startsWith(prefix));
}

function apiSummary(apiItems) {
  const durations = apiItems.map((item) => item.durationMs);
  const grouped = groupBy(
    apiItems,
    (item) => `${item.method} ${item.endpoint}`,
    () => ({ count: 0, durations: [], errors: 0, responseBytes: 0 }),
    (row, item) => {
      row.count += 1;
      row.durations.push(item.durationMs);
      row.errors += item.statusCode >= 500 ? 1 : 0;
      row.responseBytes += item.responseBytes || 0;
    },
  ).map((row) => ({
    endpoint: row.key,
    count: row.count,
    averageMs: average(row.durations),
    p95Ms: percentile(row.durations),
    maxMs: Math.max(...row.durations, 0),
    errors: row.errors,
    responseBytes: row.responseBytes,
  }));

  return {
    averageMs: average(durations),
    p95Ms: percentile(durations),
    maxMs: Math.max(...durations, 0),
    slowRequestCount: apiItems.filter((item) => item.durationMs >= SLOW_API_MS).length,
    errorCount: apiItems.filter((item) => item.statusCode >= 500).length,
    topSlowApis: [...grouped].sort((a, b) => b.p95Ms - a.p95Ms || b.maxMs - a.maxMs).slice(0, 10),
    topCalledApis: [...grouped].sort((a, b) => b.count - a.count).slice(0, 10),
  };
}

function firestoreSummary(readItems, signalItems) {
  const topReadEndpoints = groupBy(
    readItems,
    (item) => `${item.method} ${item.endpoint}`,
    () => ({ count: 0, estimatedReads: 0, duplicateReadCount: 0 }),
    (row, item) => {
      row.count += 1;
      row.estimatedReads += item.totalEstimatedReads;
      row.duplicateReadCount += item.duplicateReadCount;
    },
  ).sort((a, b) => b.estimatedReads - a.estimatedReads).slice(0, 10);

  const topWriteEndpoints = groupBy(
    readItems.filter((item) => item.totalEstimatedWrites > 0),
    (item) => `${item.method} ${item.endpoint}`,
    () => ({ count: 0, estimatedWrites: 0 }),
    (row, item) => {
      row.count += 1;
      row.estimatedWrites += item.totalEstimatedWrites || 0;
    },
  ).sort((a, b) => b.estimatedWrites - a.estimatedWrites).slice(0, 10);

  const before = signalItems.filter((item) => item.tag === "READS-BEFORE").reduce((sum, item) => sum + item.estimatedReads, 0);
  const after = signalItems.filter((item) => item.tag === "READS-AFTER").reduce((sum, item) => sum + item.estimatedReads, 0);
  const totalCacheHit = readItems.reduce((sum, item) => sum + item.cacheHit, 0);
  const totalCacheMiss = readItems.reduce((sum, item) => sum + item.cacheMiss, 0);
  const cacheEvents = totalCacheHit + totalCacheMiss;

  return {
    estimatedReadsToday: readItems.reduce((sum, item) => sum + item.totalEstimatedReads, 0),
    estimatedWritesToday: readItems.reduce((sum, item) => sum + item.totalEstimatedWrites, 0),
    topReadEndpoints,
    topWriteEndpoints,
    readReductionScore: before > 0 ? Math.max(0, Math.round(((before - after) / before) * 100)) : null,
    cacheHitRate: cacheEvents ? Math.round((totalCacheHit / cacheEvents) * 100) : null,
    duplicateReadCount: readItems.reduce((sum, item) => sum + item.duplicateReadCount, 0),
    byCollection: readItems.reduce((acc, item) => {
      Object.entries(item.byCollection || {}).forEach(([collection, reads]) => {
        acc[collection] = (acc[collection] || 0) + Number(reads || 0);
      });
      return acc;
    }, {}),
    writesByCollection: readItems.reduce((acc, item) => {
      Object.entries(item.writesByCollection || {}).forEach(([collection, writes]) => {
        acc[collection] = (acc[collection] || 0) + Number(writes || 0);
      });
      return acc;
    }, {}),
  };
}

function projectionSummary(signalItems) {
  const hits = signalItems.filter((item) => item.tag === "PROJECTION-HIT");
  const misses = signalItems.filter((item) => item.tag === "PROJECTION-MISS");
  const fallbacks = signalItems.filter((item) => item.tag === "CANONICAL-FALLBACK");
  const stale = signalItems.filter((item) => item.tag === "PROJECTION-STALE");
  const rebuilds = signalItems.filter((item) => item.tag === "PROJECTION-REBUILD");
  const rebuildSkipped = signalItems.filter((item) => item.tag === "PROJECTION-REBUILD-SKIPPED");
  const freshness = signalItems.filter((item) => item.tag === "PROJECTION-FRESHNESS");
  const byCollection = groupBy(
    [...hits, ...misses, ...fallbacks, ...stale, ...rebuilds, ...rebuildSkipped],
    (item) => item.collection || "unknown",
    () => ({ projectionHit: 0, projectionMiss: 0, canonicalFallback: 0, stale: 0, rebuilds: 0, rebuildSkipped: 0 }),
    (row, item) => {
      if (item.tag === "PROJECTION-HIT") row.projectionHit += 1;
      if (item.tag === "PROJECTION-MISS") row.projectionMiss += 1;
      if (item.tag === "CANONICAL-FALLBACK") row.canonicalFallback += 1;
      if (item.tag === "PROJECTION-STALE") row.stale += 1;
      if (item.tag === "PROJECTION-REBUILD") row.rebuilds += 1;
      if (item.tag === "PROJECTION-REBUILD-SKIPPED") row.rebuildSkipped += 1;
    },
  );
  const total = hits.length + misses.length;
  const lagSamples = [...hits, ...freshness, ...stale]
    .map((item) => item.durationMs || item.projectionLagMs)
    .filter(Number.isFinite);
  return {
    projectionHit: hits.length,
    projectionMiss: misses.length,
    canonicalFallback: fallbacks.length,
    projectionRebuildCount: rebuilds.length,
    projectionRebuildSkippedCount: rebuildSkipped.length,
    staleProjectionCount: stale.length,
    projectionHitRate: total ? Math.round((hits.length / total) * 100) : null,
    projectionLagMs: lagSamples.length ? Math.max(...lagSamples) : null,
    projectionFreshness: stale.length ? "stale-detected" : hits.length || freshness.length ? "fresh" : "not-metered",
    collections: byCollection,
  };
}

function cacheSummary(readItems, signalItems) {
  const hits = readItems.reduce((sum, item) => sum + item.cacheHit, 0) + signalItems.filter((item) => /CACHE-HIT$/.test(item.tag)).length;
  const misses = readItems.reduce((sum, item) => sum + item.cacheMiss, 0) + signalItems.filter((item) => /CACHE-MISS$/.test(item.tag)).length;
  const total = hits + misses;
  const byCache = groupBy(
    signalItems.filter((item) => /CACHE/.test(item.tag)),
    (item) => {
      const key = String(item.cacheKey || item.tag || "cache");
      if (key.startsWith("auth:verified-identity")) return "Identity Cache";
      if (key.startsWith("auth:firebase-email-verified")) return "Permission Cache";
      if (key.startsWith("auth:session")) return "Session Cache";
      if (/analytics/i.test(key)) return "Analytics Cache";
      if (/projection|Views|staffView|leadDetails/i.test(key)) return "Projection Cache";
      return "General Cache";
    },
    () => ({ hits: 0, misses: 0 }),
    (row, item) => {
      if (/HIT$/.test(item.tag)) row.hits += 1;
      if (/MISS$/.test(item.tag)) row.misses += 1;
    },
  ).map((row) => ({ ...row, hitRate: row.hits + row.misses ? Math.round((row.hits / (row.hits + row.misses)) * 100) : null }));

  return { hits, misses, hitRate: total ? Math.round((hits / total) * 100) : null, byCache };
}

function realtimeSummary(realtimeItems, currentStats = {}) {
  const disconnectedClients = realtimeItems.reduce((sum, item) => sum + item.disconnected, 0);
  const realtimeErrors = realtimeItems.reduce((sum, item) => sum + item.errors, 0) + Number(currentStats.failedEvents || 0);
  const droppedEvents = realtimeItems.reduce((sum, item) => sum + item.dropped, 0) + Number(currentStats.droppedEvents || 0);
  const notificationItems = realtimeItems.filter((item) => String(item.eventType || "").includes("NOTIFICATION"));
  const notificationSent = notificationItems.filter((item) => item.eventType === "NOTIFICATION_CREATED").length;
  return {
    activeSseConnections: Number(currentStats.clients || 0),
    connectedUsers: Number(currentStats.connectedUsers || currentStats.clients || 0),
    pendingTickets: Number(currentStats.pendingTickets || 0),
    bufferedEvents: Number(currentStats.bufferedEvents || 0),
    redisEnabled: Boolean(currentStats.redisEnabled),
    realtimeEventsToday: realtimeItems.length,
    realtimeErrors,
    droppedEvents,
    disconnectedClients,
    reconnectCount: Number(currentStats.reconnectCount || 0),
    duplicateConnections: Number(currentStats.connectionLifecycle?.duplicateConnections || 0),
    acknowledgedEvents: Number(currentStats.acknowledgedEvents || 0),
    disconnectStormThreshold: REALTIME_DISCONNECT_STORM_THRESHOLD,
    disconnectStormDetected: disconnectedClients >= REALTIME_DISCONNECT_STORM_THRESHOLD,
    averageCandidateClients: average(realtimeItems.map((item) => item.candidateClients)),
    averageEventDeliveryMs: average(realtimeItems.map((item) => item.durationMs)),
    averageEventLatencyMs: Number(currentStats.averageEventLatencyMs || average(realtimeItems.map((item) => item.latencyMs))),
    productionReadinessScore: Number(currentStats.productionReadinessScore || 100),
    eventAudit: currentStats.eventAudit || {},
    performance: currentStats.performance || {},
    eventRegistryCount: Array.isArray(currentStats.eventRegistry) ? currentStats.eventRegistry.length : 0,
    roleDeliveryMatrix: currentStats.roleDeliveryMatrix || {},
    notificationDelivery: {
      sent: notificationSent,
      unreadCount: Math.max(0, notificationItems.reduce((sum, item) => sum + Number(item.notificationDelta || 0), 0)),
      failedDeliveries: notificationItems.reduce((sum, item) => sum + Number(item.errors || 0), 0),
      deliveryLatencyMs: average(notificationItems.map((item) => item.latencyMs)),
      connectedUsers: Number(currentStats.connectedUsers || currentStats.clients || 0),
    },
  };
}

function branchSummary(signalItems, realtimeItems) {
  const branchCreated = signalItems.filter((item) => item.tag === "BRANCH-CREATED");
  const branchUpdated = signalItems.filter((item) => item.tag === "BRANCH-UPDATED");
  const branchDisabled = signalItems.filter((item) => item.tag === "BRANCH-DISABLED");
  const duplicateIfsc = signalItems.filter((item) => item.tag === "IFSC-DUPLICATE");
  const byState = groupBy(
    [...branchCreated, ...branchUpdated, ...branchDisabled],
    (item) => item.state || "unknown",
    () => ({ count: 0, created: 0, updated: 0, disabled: 0 }),
    (row, item) => {
      row.count += 1;
      if (item.tag === "BRANCH-CREATED") row.created += 1;
      if (item.tag === "BRANCH-UPDATED") row.updated += 1;
      if (item.tag === "BRANCH-DISABLED") row.disabled += 1;
    },
  );
  const byLocation = groupBy(
    [...branchCreated, ...branchUpdated, ...branchDisabled],
    (item) => item.location || "unknown",
    () => ({ count: 0, created: 0, updated: 0, disabled: 0 }),
    (row, item) => {
      row.count += 1;
      if (item.tag === "BRANCH-CREATED") row.created += 1;
      if (item.tag === "BRANCH-UPDATED") row.updated += 1;
      if (item.tag === "BRANCH-DISABLED") row.disabled += 1;
    },
  ).sort((a, b) => b.count - a.count).slice(0, 20);
  const byCapacity = groupBy(
    [...branchCreated, ...branchUpdated],
    (item) => item.capacityRange || "Not metered",
    () => ({ count: 0, created: 0, updated: 0 }),
    (row, item) => {
      row.count += 1;
      if (item.tag === "BRANCH-CREATED") row.created += 1;
      if (item.tag === "BRANCH-UPDATED") row.updated += 1;
    },
  );
  const syncEvents = realtimeItems.filter((item) => /BANK|BRANCH/.test(item.eventType || ""));
  return {
    branchCreationEvents: branchCreated.length,
    branchUpdateEvents: branchUpdated.length,
    branchDisabledEvents: branchDisabled.length,
    ifscDuplicates: duplicateIfsc.length,
    realtimeSyncEvents: syncEvents.length,
    branchesByState: byState,
    branchesByLocation: byLocation,
    branchesByCapacity: byCapacity,
  };
}

function dealerSummary(signalItems, realtimeItems) {
  const dealerCreated = signalItems.filter((item) => item.tag === "DEALER-CREATED");
  const dealerApproved = signalItems.filter((item) => item.tag === "DEALER-APPROVED");
  const dealerUpdated = signalItems.filter((item) => item.tag === "DEALER-UPDATED" || item.tag === "DEALER-LOCATION-UPDATED" || item.tag === "DEALER-CAPACITY-UPDATED");
  const dealerDisabled = signalItems.filter((item) => item.tag === "DEALER-DISABLED");
  const dealerSignals = [...dealerCreated, ...dealerApproved, ...dealerUpdated, ...dealerDisabled];
  const byBrand = groupBy(
    dealerSignals,
    (item) => item.dealerBrand || "unknown",
    () => ({ count: 0, created: 0, approved: 0, updated: 0, disabled: 0 }),
    (row, item) => {
      row.count += 1;
      if (item.tag === "DEALER-CREATED") row.created += 1;
      if (item.tag === "DEALER-APPROVED") row.approved += 1;
      if (item.tag === "DEALER-UPDATED" || item.tag === "DEALER-LOCATION-UPDATED" || item.tag === "DEALER-CAPACITY-UPDATED") row.updated += 1;
      if (item.tag === "DEALER-DISABLED") row.disabled += 1;
    },
  ).sort((a, b) => b.count - a.count).slice(0, 20);
  const byState = groupBy(
    dealerSignals,
    (item) => item.state || "unknown",
    () => ({ count: 0, created: 0, approved: 0, updated: 0, disabled: 0 }),
    (row, item) => {
      row.count += 1;
      if (item.tag === "DEALER-CREATED") row.created += 1;
      if (item.tag === "DEALER-APPROVED") row.approved += 1;
      if (item.tag === "DEALER-UPDATED" || item.tag === "DEALER-LOCATION-UPDATED" || item.tag === "DEALER-CAPACITY-UPDATED") row.updated += 1;
      if (item.tag === "DEALER-DISABLED") row.disabled += 1;
    },
  );
  const byLocation = groupBy(
    dealerSignals,
    (item) => item.location || "unknown",
    () => ({ count: 0, created: 0, approved: 0, updated: 0, disabled: 0 }),
    (row, item) => {
      row.count += 1;
      if (item.tag === "DEALER-CREATED") row.created += 1;
      if (item.tag === "DEALER-APPROVED") row.approved += 1;
      if (item.tag === "DEALER-UPDATED" || item.tag === "DEALER-LOCATION-UPDATED" || item.tag === "DEALER-CAPACITY-UPDATED") row.updated += 1;
      if (item.tag === "DEALER-DISABLED") row.disabled += 1;
    },
  ).sort((a, b) => b.count - a.count).slice(0, 20);
  const realtimeDealerEvents = realtimeItems.filter((item) => /DEALER/.test(item.eventType || ""));
  return {
    dealerCreationEvents: dealerCreated.length,
    dealerApprovalEvents: dealerApproved.length,
    dealerUpdateEvents: dealerUpdated.length,
    dealerDisabledEvents: dealerDisabled.length,
    realtimeDealerEvents: realtimeDealerEvents.length,
    dealershipsByBrand: byBrand,
    dealershipsByState: byState,
    dealershipsByLocation: byLocation,
  };
}

export function monitoringTelemetrySummary({ realtimeStats = {} } = {}) {
  const apiItems = todayItems(state.api);
  const readItems = todayItems(state.reads);
  const signalItems = todayItems(state.signals);
  const realtimeItems = todayItems(state.realtime);
  const api = apiSummary(apiItems);
  api.repeatedFailureThreshold = REPEATED_API_FAILURE_THRESHOLD;
  api.repeatedFailuresDetected = api.errorCount >= REPEATED_API_FAILURE_THRESHOLD;
  const firestore = firestoreSummary(readItems, signalItems);
  const projection = projectionSummary(signalItems);
  const cache = cacheSummary(readItems, signalItems);
  const realtime = realtimeSummary(realtimeItems, realtimeStats);
  const branches = branchSummary(signalItems, realtimeItems);
  const dealers = dealerSummary(signalItems, realtimeItems);

  return {
    generatedAt: nowIso(),
    sampleWindow: {
      maxItems: WINDOW_LIMIT,
      apiSamples: apiItems.length,
      readSamples: readItems.length,
      signalSamples: signalItems.length,
      realtimeSamples: realtimeItems.length,
    },
    api,
    firestore,
    projection,
    cache,
    realtime,
    branches,
    dealers,
    statuses: {
      api: api.repeatedFailuresDetected ? "critical" : statusFromThreshold(api.p95Ms, 1000, 2000),
      firestore: statusFromThreshold(firestore.estimatedReadsToday, 50000, 150000),
      projection: projection.staleProjectionCount > 10
        ? "critical"
        : projection.staleProjectionCount > 0
          ? "warning"
          : projection.projectionHitRate === null ? "warning" : statusFromThreshold(projection.projectionHitRate, 80, 50, true),
      cache: cache.hitRate === null ? "warning" : statusFromThreshold(cache.hitRate, 70, 40, true),
      realtime: realtime.disconnectStormDetected || realtime.realtimeErrors > 0 || realtime.droppedEvents > 0 ? "warning" : "healthy",
    },
  };
}
