import { Activity, CreditCard, Database, Radio, RefreshCw, Server, ShieldCheck, Zap } from "lucide-react";
import { OperationalTable } from "../../../components/OperationalTable.jsx";
import { MetricTile, Section } from "./MonitoringParts.jsx";
import {
  ApiPerformanceSection,
  CallFrequencySection,
  FirestoreMonitoringSection,
  MonitoringHeader,
  MonitoringStatusGrid,
  PlatformOverviewSection,
  SystemAlertsSection,
  WhatsappMonitoringSection,
} from "./AdminMonitoringSections.jsx";
import { dateTime, percent } from "./monitoring.helpers.js";

export function AdminMonitoringContent({
  alerts,
  apiPerf,
  branchCapacityRows,
  branchLocationRows,
  branches,
  branchStateRows,
  cache,
  cards,
  dealerBrandRows,
  dealerLocationRows,
  dealers,
  dealerStateRows,
  error,
  firestore,
  load,
  loading,
  overview,
  projection,
  projectionCollections,
  queue,
  queueRows,
  realtime,
  sendWhatsappTest,
  setWhatsappTestPhone,
  snapshot,
  whatsapp,
  whatsappTestLoading,
  whatsappTestPhone,
  whatsappTestResult,
}) {
  return (
    <div className="space-y-6">
      <MonitoringHeader error={error} load={load} />

      <MonitoringStatusGrid cards={cards} icons={{ Activity, CreditCard, Database, Radio, RefreshCw, Server, ShieldCheck, Zap }} />
      <PlatformOverviewSection overview={overview} snapshot={snapshot} />
      <ApiPerformanceSection apiPerf={apiPerf} loading={loading} snapshot={snapshot} />
      <FirestoreMonitoringSection firestore={firestore} loading={loading} projection={projection} />

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
          <OperationalTable title="Branches By State" headers={["State", "Events", "Created", "Updated", "Disabled"]} rows={branchStateRows} loading={loading} virtualizeAt={20} />
          <OperationalTable title="Branches By Location" headers={["Location", "Events", "Created", "Updated", "Disabled"]} rows={branchLocationRows} loading={loading} virtualizeAt={30} />
          <OperationalTable title="Branch Count By Capacity" headers={["Capacity", "Events", "Created", "Updated"]} rows={branchCapacityRows} loading={loading} virtualizeAt={20} />
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
          <OperationalTable title="Dealerships By Brand" headers={["Brand", "Events", "Created", "Approved", "Updated", "Disabled"]} rows={dealerBrandRows} loading={loading} virtualizeAt={30} />
          <OperationalTable title="Dealerships By State" headers={["State", "Events", "Created", "Approved", "Updated", "Disabled"]} rows={dealerStateRows} loading={loading} virtualizeAt={20} />
          <OperationalTable title="Dealerships By Location" headers={["Location", "Events", "Created", "Approved", "Updated", "Disabled"]} rows={dealerLocationRows} loading={loading} virtualizeAt={30} />
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
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile label="Active SSE Connections" value={realtime.activeSseConnections || 0} />
            <MetricTile label="Connected Users" value={realtime.connectedUsers || 0} />
            <MetricTile label="Realtime Events Today" value={realtime.realtimeEventsToday || 0} />
            <MetricTile label="Realtime Errors" value={realtime.realtimeErrors || 0} />
            <MetricTile label="Dropped Events" value={realtime.droppedEvents || 0} />
            <MetricTile label="Disconnected Clients" value={realtime.disconnectedClients || 0} />
            <MetricTile label="Reconnect Count" value={realtime.reconnectCount || 0} />
            <MetricTile label="Applied Events" value={realtime.acknowledgedEvents || 0} />
            <MetricTile label="Average Delivery" value={`${realtime.averageEventDeliveryMs || 0}ms`} />
            <MetricTile label="Average Latency" value={`${realtime.averageEventLatencyMs || 0}ms`} />
            <MetricTile label="Buffered Events" value={realtime.bufferedEvents || 0} />
            <MetricTile label="Event Registry" value={realtime.eventRegistryCount || 0} />
            <MetricTile label="Readiness Score" value={`${realtime.productionReadinessScore ?? 100}/100`} />
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

      <WhatsappMonitoringSection
        loading={loading}
        sendWhatsappTest={sendWhatsappTest}
        setWhatsappTestPhone={setWhatsappTestPhone}
        whatsapp={whatsapp}
        whatsappTestLoading={whatsappTestLoading}
        whatsappTestPhone={whatsappTestPhone}
        whatsappTestResult={whatsappTestResult}
      />

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

      <SystemAlertsSection alerts={alerts} />

      <CallFrequencySection apiPerf={apiPerf} loading={loading} />

      <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-500">
        Monitoring source: {snapshot?.readModel?.source || "metrics + telemetry"}. Snapshot cache TTL: {snapshot?.readModel?.snapshotCacheTtlMs || 15000}ms. This page avoids collection scans and uses bounded telemetry windows.
      </div>
    </div>
  );
}
