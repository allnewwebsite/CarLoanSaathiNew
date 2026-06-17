import { Activity, AlertTriangle, CreditCard, Database, Radio, RefreshCw, Server, ShieldCheck, Zap } from "lucide-react";
import { OperationalTable } from "../../../components/OperationalTable.jsx";
import { MetricTile, Section, StatusCard } from "./MonitoringParts.jsx";
import { dateTime, percent, rows, shortText, yesNo } from "./monitoring.helpers.js";

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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Super Admin</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">Monitoring Center</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">Operations view for API latency, Firestore reads, projections, cache behavior, and realtime delivery.</p>
        </div>
        <button type="button" onClick={() => load({ force: true })} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-8">
        <StatusCard title="System Status" icon={Server} item={cards.systemStatus} />
        <StatusCard title="API Health" icon={Activity} item={cards.apiHealth} />
        <StatusCard title="Realtime Status" icon={Radio} item={cards.realtimeStatus} />
        <StatusCard title="Projection Health" icon={Zap} item={cards.projectionHealth} />
        <StatusCard title="Cache Health" icon={ShieldCheck} item={cards.cacheHealth} />
        <StatusCard title="Firestore Health" icon={Database} item={cards.firestoreHealth} />
        <StatusCard title="Razorpay Webhook" icon={CreditCard} item={cards.razorpayWebhook} />
        <StatusCard title="Payment Reconciliation" icon={RefreshCw} item={cards.paymentReconciliation} />
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
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <label className="flex-1">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Send Test WhatsApp</span>
              <input
                type="tel"
                value={whatsappTestPhone}
                onChange={(event) => setWhatsappTestPhone(event.target.value)}
                placeholder="+919876543210"
                className="mt-2 w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <button
              type="button"
              onClick={sendWhatsappTest}
              disabled={whatsappTestLoading || !whatsapp.enabled || !whatsapp.configured}
              className="inline-flex justify-center rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {whatsappTestLoading ? "Sending..." : "Send Test"}
            </button>
          </div>
          {whatsappTestResult ? (
            <p className={`mt-3 rounded-md border px-3 py-2 text-sm font-semibold ${whatsappTestResult.success ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}>
              {whatsappTestResult.message}
            </p>
          ) : null}
        </div>
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
