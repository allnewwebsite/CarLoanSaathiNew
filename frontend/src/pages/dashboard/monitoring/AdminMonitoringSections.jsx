import { AlertTriangle, RefreshCw } from "lucide-react";
import { OperationalTable } from "../../../components/OperationalTable.jsx";
import { MetricTile, Section, StatusCard } from "./MonitoringParts.jsx";
import { dateTime, percent, rows, shortText, yesNo } from "./monitoring.helpers.js";

export function MonitoringHeader({ error, load }) {
  return (
    <>
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
    </>
  );
}

export function MonitoringStatusGrid({ cards, icons }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-8">
      <StatusCard title="System Status" icon={icons.Server} item={cards.systemStatus} />
      <StatusCard title="API Health" icon={icons.Activity} item={cards.apiHealth} />
      <StatusCard title="Realtime Status" icon={icons.Radio} item={cards.realtimeStatus} />
      <StatusCard title="Projection Health" icon={icons.Zap} item={cards.projectionHealth} />
      <StatusCard title="Cache Health" icon={icons.ShieldCheck} item={cards.cacheHealth} />
      <StatusCard title="Firestore Health" icon={icons.Database} item={cards.firestoreHealth} />
      <StatusCard title="Razorpay Webhook" icon={icons.CreditCard} item={cards.razorpayWebhook} />
      <StatusCard title="Payment Reconciliation" icon={icons.RefreshCw} item={cards.paymentReconciliation} />
    </div>
  );
}

export function PlatformOverviewSection({ overview, snapshot }) {
  return (
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
  );
}

export function ApiPerformanceSection({ apiPerf, loading, snapshot }) {
  return (
    <Section title="API Performance">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 xl:grid-cols-9">
        <MetricTile label="Average API" value={`${apiPerf.averageApiResponseTime || 0}ms`} />
        <MetricTile label="P95 API" value={`${apiPerf.p95ApiResponseTime || 0}ms`} />
        <MetricTile label="P99 API" value={`${apiPerf.p99ApiResponseTime || 0}ms`} />
        <MetricTile label="Requests" value={apiPerf.requestCount || 0} />
        <MetricTile label="Failures" value={apiPerf.failureCount || 0} />
        <MetricTile label="Timeouts" value={apiPerf.timeoutCount || 0} />
        <MetricTile label="Error Rate" value={`${apiPerf.errorRate || 0}%`} />
        <MetricTile label="Slow Requests" value={apiPerf.slowRequestCount || 0} />
        <MetricTile label="API Errors" value={apiPerf.apiErrorCount || 0} />
        <MetricTile label="Samples" value={snapshot?.sampleWindow?.apiSamples || 0} />
      </div>
      <OperationalTable
        title="Top Slow APIs"
        headers={["Endpoint", "Count", "Average", "P95", "P99", "Max", "Failures", "Timeouts", "Error Rate"]}
        rows={rows(apiPerf.topSlowApis || [], (item) => [item.endpoint, item.count, `${item.averageMs}ms`, `${item.p95Ms}ms`, `${item.p99Ms || 0}ms`, `${item.maxMs}ms`, item.failures || 0, item.timeouts || 0, `${item.errorRate || 0}%`])}
        loading={loading}
        virtualizeAt={20}
      />
    </Section>
  );
}

export function FirestoreMonitoringSection({ firestore, loading, projection }) {
  return (
    <Section title="Firestore Monitoring">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 xl:grid-cols-9">
        <MetricTile label="Reads Today" value={firestore.estimatedReadsToday || 0} />
        <MetricTile label="Writes Today" value={firestore.estimatedWritesToday || 0} />
        <MetricTile label="Deletes Today" value={firestore.estimatedDeletesToday || 0} />
        <MetricTile label="Reads / Minute" value={firestore.readsPerMinute || 0} />
        <MetricTile label="Writes / Minute" value={firestore.writesPerMinute || 0} />
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
  );
}

export function CallFrequencySection({ apiPerf, loading }) {
  return (
    <Section title="Call Frequency">
      <OperationalTable
        title="Most Frequently Called APIs"
        headers={["Endpoint", "Count", "Average", "P95", "Errors"]}
        rows={rows(apiPerf.topCalledApis || [], (item) => [item.endpoint, item.count, `${item.averageMs}ms`, `${item.p95Ms}ms`, item.errors])}
        loading={loading}
        virtualizeAt={20}
      />
    </Section>
  );
}

export function WhatsappMonitoringSection({
  loading,
  sendWhatsappTest,
  setWhatsappTestPhone,
  whatsapp,
  whatsappTestLoading,
  whatsappTestPhone,
  whatsappTestResult,
}) {
  return (
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
  );
}

export function SystemAlertsSection({ alerts }) {
  return (
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
  );
}
