import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, BarChart3, Database, Radio, RefreshCw, Server, ShieldCheck, Zap } from "lucide-react";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { api, getCachedGetData } from "../../services/api.js";
import { useRenderDiagnostics } from "../../services/frontendLatency.js";

const statusStyles = {
  Healthy: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Warning: "border-amber-200 bg-amber-50 text-amber-700",
  Critical: "border-red-200 bg-red-50 text-red-700",
};

function valueOrDash(value) {
  if (value === null || value === undefined || value === "") return "Not metered";
  if (typeof value === "number") return new Intl.NumberFormat("en-IN").format(value);
  return value;
}

function percent(value) {
  return value === null || value === undefined ? "Not metered" : `${value}%`;
}

function dateTime(value) {
  if (!value) return "None";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Invalid" : date.toLocaleString();
}

function yesNo(value) {
  return value ? "Yes" : "No";
}

function shortText(value, maxLength = 90) {
  if (!value) return "None";
  const text = String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function StatusCard({ title, icon: Icon, item }) {
  const status = item?.status || "Warning";
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">{title}</p>
          <p className="mt-1 text-xs text-slate-500">{item?.detail || "No samples yet"}</p>
        </div>
        <Icon className="h-5 w-5 text-slate-400" />
      </div>
      <span className={`mt-4 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[status] || statusStyles.Warning}`}>
        {status}
      </span>
    </article>
  );
}

function MetricTile({ label, value, subtext }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{valueOrDash(value)}</p>
      {subtext ? <p className="mt-1 text-xs text-slate-500">{subtext}</p> : null}
    </div>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function rows(items = [], mapper) {
  return items.map((item, index) => ({ key: `${item.key || item.endpoint || item.title || index}`, cells: mapper(item, index) }));
}

export function AdminMonitoringCenter() {
  useRenderDiagnostics("AdminMonitoringCenter");
  const cached = getCachedGetData("/admin/monitoring") || null;
  const [snapshot, setSnapshot] = useState(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState("");

  const load = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const response = await api.get("/admin/monitoring", { cacheTtlMs: 15000 });
      setSnapshot(response.data || {});
    } catch (err) {
      setError(err.message || "Unable to load monitoring center.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load({ silent: Boolean(cached) });
    const timer = window.setInterval(() => load({ silent: true }), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const cards = snapshot?.healthCards || {};
  const overview = snapshot?.platformOverview || {};
  const apiPerf = snapshot?.apiPerformance || {};
  const firestore = snapshot?.firestoreMonitoring || {};
  const projection = snapshot?.projectionHealth || {};
  const realtime = snapshot?.realtimeMonitoring || {};
  const cache = snapshot?.cacheMonitoring || {};
  const whatsapp = snapshot?.whatsappMonitoring || {};
  const queue = snapshot?.queueMonitoring || {};
  const branches = snapshot?.branchMonitoring || {};
  const dealers = snapshot?.dealerMonitoring || {};
  const alerts = snapshot?.systemAlerts || [];

  const projectionCollections = useMemo(() => rows(projection.collections || [], (item) => [
    item.key,
    valueOrDash(item.projectionHit),
    valueOrDash(item.projectionMiss),
    valueOrDash(item.canonicalFallback),
    valueOrDash(item.stale),
    valueOrDash(item.rebuilds),
    valueOrDash(item.rebuildSkipped),
    percent(item.projectionHit + item.projectionMiss ? Math.round((item.projectionHit / (item.projectionHit + item.projectionMiss)) * 100) : null),
  ]), [projection.collections]);

  const queueRows = useMemo(() => rows(queue.queues || [], (item) => [
    item.queueName,
    item.status,
    valueOrDash(item.failedJobsTotal),
    valueOrDash(item.failedJobsLastHour),
    valueOrDash(item.failedJobsLast24Hours),
    valueOrDash(item.historicalFailedJobs),
    dateTime(item.oldestFailedJobTimestamp),
    dateTime(item.newestFailedJobTimestamp),
    shortText(item.latestFailedReason),
    dateTime(item.lastSuccessfulJobTimestamp),
    valueOrDash(item.waitingJobs),
    valueOrDash(item.activeJobs),
    valueOrDash(item.delayedJobs),
    yesNo(item.paused),
    yesNo(item.workerConnected),
  ]), [queue.queues]);

  const branchStateRows = useMemo(() => rows(branches.branchesByState || [], (item) => [
    item.key,
    valueOrDash(item.count),
    valueOrDash(item.created),
    valueOrDash(item.updated),
    valueOrDash(item.disabled),
  ]), [branches.branchesByState]);

  const branchLocationRows = useMemo(() => rows(branches.branchesByLocation || [], (item) => [
    item.key,
    valueOrDash(item.count),
    valueOrDash(item.created),
    valueOrDash(item.updated),
    valueOrDash(item.disabled),
  ]), [branches.branchesByLocation]);

  const branchCapacityRows = useMemo(() => rows(branches.branchesByCapacity || [], (item) => [
    item.key,
    valueOrDash(item.count),
    valueOrDash(item.created),
    valueOrDash(item.updated),
  ]), [branches.branchesByCapacity]);

  const dealerBrandRows = useMemo(() => rows(dealers.dealershipsByBrand || [], (item) => [
    item.key,
    valueOrDash(item.count),
    valueOrDash(item.created),
    valueOrDash(item.approved),
    valueOrDash(item.updated),
    valueOrDash(item.disabled),
  ]), [dealers.dealershipsByBrand]);

  const dealerStateRows = useMemo(() => rows(dealers.dealershipsByState || [], (item) => [
    item.key,
    valueOrDash(item.count),
    valueOrDash(item.created),
    valueOrDash(item.approved),
    valueOrDash(item.updated),
    valueOrDash(item.disabled),
  ]), [dealers.dealershipsByState]);

  const dealerLocationRows = useMemo(() => rows(dealers.dealershipsByLocation || [], (item) => [
    item.key,
    valueOrDash(item.count),
    valueOrDash(item.created),
    valueOrDash(item.approved),
    valueOrDash(item.updated),
    valueOrDash(item.disabled),
  ]), [dealers.dealershipsByLocation]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Super Admin</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">Monitoring Center</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">Operations view for API latency, Firestore reads, projections, cache behavior, and realtime delivery.</p>
        </div>
        <button type="button" onClick={() => load()} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatusCard title="System Status" icon={Server} item={cards.systemStatus} />
        <StatusCard title="API Health" icon={Activity} item={cards.apiHealth} />
        <StatusCard title="Realtime Status" icon={Radio} item={cards.realtimeStatus} />
        <StatusCard title="Projection Health" icon={Zap} item={cards.projectionHealth} />
        <StatusCard title="Cache Health" icon={ShieldCheck} item={cards.cacheHealth} />
        <StatusCard title="Firestore Health" icon={Database} item={cards.firestoreHealth} />
      </div>

      <Section title="Platform Overview" subtitle={snapshot?.generatedAt ? `Generated ${new Date(snapshot.generatedAt).toLocaleString()}` : "Waiting for telemetry samples."}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <MetricTile label="Active Dealerships" value={overview.totalActiveDealerships} />
          <MetricTile label="Active Banks" value={overview.totalActiveBanks} />
          <MetricTile label="Active Users" value={overview.totalActiveUsers} />
          <MetricTile label="Online Users" value={overview.currentOnlineUsers} />
          <MetricTile label="SSE Connections" value={overview.activeSseConnections} />
          <MetricTile label="Total Leads" value={overview.totalLeads} />
          <MetricTile label="Disbursed Cases" value={overview.totalDisbursedCases} />
        </div>
      </Section>

      <Section title="API Performance">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MetricTile label="Average API" value={`${apiPerf.averageApiResponseTime || 0}ms`} />
          <MetricTile label="P95 API" value={`${apiPerf.p95ApiResponseTime || 0}ms`} />
          <MetricTile label="Slow Requests" value={apiPerf.slowRequestCount || 0} />
          <MetricTile label="API Errors" value={apiPerf.apiErrorCount || 0} />
          <MetricTile label="Samples" value={snapshot?.sampleWindow?.apiSamples || 0} />
        </div>
        <OperationalTable
          title="Top Slow APIs"
          headers={["Endpoint", "Count", "Average", "P95", "Max", "Errors"]}
          rows={rows(apiPerf.topSlowApis || [], (item) => [item.endpoint, item.count, `${item.averageMs}ms`, `${item.p95Ms}ms`, `${item.maxMs}ms`, item.errors])}
          loading={loading}
          virtualizeAt={20}
        />
      </Section>

      <Section title="Firestore Monitoring">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <MetricTile label="Reads Today" value={firestore.estimatedReadsToday || 0} />
          <MetricTile label="Writes Today" value={firestore.estimatedWritesToday || 0} />
          <MetricTile label="Read Reduction" value={percent(firestore.readReductionScore)} />
          <MetricTile label="Projection Hit" value={percent(projection.projectionHitRate)} />
          <MetricTile label="Cache Hit" value={percent(firestore.cacheHitRate)} />
          <MetricTile label="Duplicate Reads" value={firestore.duplicateReadCount || 0} />
        </div>
        <OperationalTable
          title="Top Read Endpoints"
          headers={["Endpoint", "Requests", "Estimated Reads", "Duplicate Reads"]}
          rows={rows(firestore.topReadEndpoints || [], (item) => [item.key, item.count, item.estimatedReads, item.duplicateReadCount])}
          loading={loading}
          virtualizeAt={20}
        />
      </Section>

      <Section title="Bank Branch Monitoring" subtitle="IFSC-first branch telemetry from counters and realtime branch events.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <MetricTile label="Total Banks" value={branches.totalBanks || 0} />
          <MetricTile label="Total Branches" value={branches.totalBranches || 0} />
          <MetricTile label="Disabled Branches" value={branches.disabledBranches || 0} />
          <MetricTile label="IFSC Duplicates" value={branches.ifscDuplicates || 0} />
          <MetricTile label="Realtime Sync Events" value={branches.realtimeSyncEvents || 0} />
          <MetricTile label="Branch Created" value={branches.branchCreationEvents || 0} />
          <MetricTile label="Branch Updated" value={branches.branchUpdateEvents || 0} />
        </div>
        <div className="grid gap-3 xl:grid-cols-3">
          <OperationalTable
            title="Branches By State"
            headers={["State", "Events", "Created", "Updated", "Disabled"]}
            rows={branchStateRows}
            loading={loading}
            virtualizeAt={20}
          />
          <OperationalTable
            title="Branches By Location"
            headers={["Location", "Events", "Created", "Updated", "Disabled"]}
            rows={branchLocationRows}
            loading={loading}
            virtualizeAt={30}
          />
          <OperationalTable
            title="Branch Count By Capacity"
            headers={["Capacity", "Events", "Created", "Updated"]}
            rows={branchCapacityRows}
            loading={loading}
            virtualizeAt={20}
          />
        </div>
      </Section>

      <Section title="Dealer Monitoring" subtitle="Dealership telemetry from onboarding, approval, and realtime dealer sync events.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <MetricTile label="Total Dealerships" value={dealers.totalDealerships || 0} />
          <MetricTile label="Approved Dealerships" value={dealers.approvedDealerships || 0} />
          <MetricTile label="Pending Dealerships" value={dealers.pendingDealerships || 0} />
          <MetricTile label="Disabled Dealerships" value={dealers.disabledDealerships || 0} />
          <MetricTile label="Realtime Dealer Events" value={dealers.realtimeDealerEvents || 0} />
          <MetricTile label="Dealer Created" value={dealers.dealerCreationEvents || 0} />
          <MetricTile label="Dealer Approved" value={dealers.dealerApprovalEvents || 0} />
          <MetricTile label="Dealer Updated" value={dealers.dealerUpdateEvents || 0} />
        </div>
        <div className="grid gap-3 xl:grid-cols-3">
          <OperationalTable
            title="Dealerships By Brand"
            headers={["Brand", "Events", "Created", "Approved", "Updated", "Disabled"]}
            rows={dealerBrandRows}
            loading={loading}
            virtualizeAt={30}
          />
          <OperationalTable
            title="Dealerships By State"
            headers={["State", "Events", "Created", "Approved", "Updated", "Disabled"]}
            rows={dealerStateRows}
            loading={loading}
            virtualizeAt={20}
          />
          <OperationalTable
            title="Dealerships By Location"
            headers={["Location", "Events", "Created", "Approved", "Updated", "Disabled"]}
            rows={dealerLocationRows}
            loading={loading}
            virtualizeAt={30}
          />
        </div>
      </Section>

      <Section title="Projection Health">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <MetricTile label="Projection Hit" value={projection.projectionHit || 0} />
          <MetricTile label="Projection Miss" value={projection.projectionMiss || 0} />
          <MetricTile label="Canonical Fallback" value={projection.canonicalFallback || 0} />
          <MetricTile label="Rebuild Count" value={projection.projectionRebuildCount || 0} />
          <MetricTile label="Rebuild Skipped" value={projection.projectionRebuildSkippedCount || 0} />
          <MetricTile label="Stale Count" value={projection.staleProjectionCount || 0} />
          <MetricTile label="Projection Lag" value={projection.projectionLagMs === null ? "Not metered" : `${projection.projectionLagMs}ms`} />
          <MetricTile label="Freshness" value={projection.projectionFreshness || "Not metered"} />
        </div>
        <OperationalTable
          title="Projection Collections"
          headers={["Collection", "Hit", "Miss", "Fallback", "Stale", "Rebuild", "Skipped", "Hit Rate"]}
          rows={projectionCollections}
          loading={loading}
          virtualizeAt={20}
        />
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Realtime Monitoring">
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricTile label="Active SSE Connections" value={realtime.activeSseConnections || 0} />
            <MetricTile label="Realtime Events Today" value={realtime.realtimeEventsToday || 0} />
            <MetricTile label="Realtime Errors" value={realtime.realtimeErrors || 0} />
            <MetricTile label="Disconnected Clients" value={realtime.disconnectedClients || 0} />
            <MetricTile label="Average Delivery" value={`${realtime.averageEventDeliveryMs || 0}ms`} />
            <MetricTile label="Buffered Events" value={realtime.bufferedEvents || 0} />
          </div>
        </Section>

        <Section title="Cache Monitoring">
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricTile label="Cache Hits" value={cache.hits || 0} />
            <MetricTile label="Cache Misses" value={cache.misses || 0} />
            <MetricTile label="Cache Hit %" value={percent(cache.hitRate)} />
            <MetricTile label="Projection Cache" value={percent((cache.byCache || []).find((item) => item.key === "Projection Cache")?.hitRate)} />
            <MetricTile label="Identity Cache" value={percent((cache.byCache || []).find((item) => item.key === "Identity Cache")?.hitRate)} />
            <MetricTile label="Permission Cache" value={percent((cache.byCache || []).find((item) => item.key === "Permission Cache")?.hitRate)} />
          </div>
        </Section>
      </div>

      <Section title="WhatsApp Monitoring" subtitle="Twilio WhatsApp delivery uses queued jobs; API workflows do not wait for provider delivery.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <MetricTile label="WhatsApp Enabled" value={yesNo(whatsapp.enabled)} />
          <MetricTile label="Provider" value={whatsapp.provider || "twilio"} />
          <MetricTile label="Configured" value={yesNo(whatsapp.configured)} />
          <MetricTile label="Twilio Status" value={whatsapp.twilioConnectionStatus || "not-checked"} />
          <MetricTile label="Sent Today" value={whatsapp.sentToday || 0} />
          <MetricTile label="Failed Today" value={whatsapp.failedToday || 0} />
          <MetricTile label="Pending" value={whatsapp.pending || 0} />
          <MetricTile label="Queued" value={whatsapp.queued || 0} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile label="Last Success" value={dateTime(whatsapp.lastSuccess)} />
          <MetricTile label="Last Failed" value={dateTime(whatsapp.lastFailed)} />
          <MetricTile label="Last Message SID" value={whatsapp.lastMessageSid || "None"} />
          <MetricTile label="Last Error" value={shortText(whatsapp.lastError)} />
        </div>
        <OperationalTable
          title="Latest WhatsApp Events"
          headers={["Time", "Event", "Status", "Message SID", "Error"]}
          rows={rows(whatsapp.events || [], (item) => [dateTime(item.timestamp), item.eventType, item.status, item.messageSid || "-", shortText(item.error, 60)])}
          loading={loading}
          virtualizeAt={20}
        />
      </Section>

      <Section title="Queue Monitoring" subtitle="Active health uses failures from the last 24 hours. Retained BullMQ failures are shown separately as historical context.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <MetricTile label="Queue Status" value={queue.enabled ? queue.status : "local-fallback"} />
          <MetricTile label="Failed Last Hour" value={queue.failedJobsLastHour || 0} />
          <MetricTile label="Failed Last 24 Hours" value={queue.failedJobsLast24Hours || 0} />
          <MetricTile label="Historical Failures" value={queue.historicalFailedJobs || 0} />
          <MetricTile label="Waiting Jobs" value={queue.waitingJobs || 0} />
          <MetricTile label="Delayed Jobs" value={queue.delayedJobs || 0} />
        </div>
        <OperationalTable
          title="Queues"
          headers={["Queue Name", "Health", "Failed Total", "Failed 1h", "Failed 24h", "Historical Failed", "Oldest Failed", "Newest Failed", "Latest Failed Reason", "Last Success", "Waiting", "Active", "Delayed", "Paused", "Worker Connected"]}
          rows={queueRows}
          loading={loading}
          virtualizeAt={20}
          rowHeight={40}
        />
      </Section>

      <Section title="System Alerts">
        <div className="grid gap-3">
          {alerts.length ? alerts.map((alert, index) => (
            <article key={`${alert.title}-${index}`} className={`rounded-lg border p-4 ${alert.severity === "critical" || alert.severity === "high" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
              <div className="flex items-start gap-3">
                <AlertTriangle className={`mt-0.5 h-5 w-5 ${alert.severity === "critical" || alert.severity === "high" ? "text-red-600" : "text-amber-600"}`} />
                <div>
                  <p className="font-semibold text-slate-950">{alert.title}</p>
                  <p className="mt-1 text-sm text-slate-600">{alert.detail}</p>
                </div>
              </div>
            </article>
          )) : <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">No active monitoring alerts in the current telemetry window.</div>}
        </div>
      </Section>

      <Section title="Call Frequency">
        <OperationalTable
          title="Most Frequently Called APIs"
          headers={["Endpoint", "Count", "Average", "P95", "Errors"]}
          rows={rows(apiPerf.topCalledApis || [], (item) => [item.endpoint, item.count, `${item.averageMs}ms`, `${item.p95Ms}ms`, item.errors])}
          loading={loading}
          virtualizeAt={20}
        />
      </Section>

      <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-500">
        Monitoring source: {snapshot?.readModel?.source || "metrics + telemetry"}. Snapshot cache TTL: {snapshot?.readModel?.snapshotCacheTtlMs || 15000}ms. This page avoids collection scans and uses bounded telemetry windows.
      </div>
    </div>
  );
}
