import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, getCachedGetData, invalidateGetCache } from "../../services/api.js";
import { useRenderDiagnostics } from "../../services/frontendLatency.js";
import { AdminMonitoringContent } from "./monitoring/AdminMonitoringContent.jsx";
import { dateTime, percent, rows, shortText, valueOrDash, yesNo } from "./monitoring/monitoring.helpers.js";

export function AdminMonitoringCenter() {
  useRenderDiagnostics("AdminMonitoringCenter");
  const initialCachedRef = useRef(getCachedGetData("/admin/monitoring") || null);
  const cached = initialCachedRef.current;
  const lastSilentRefreshAtRef = useRef(0);
  const [snapshot, setSnapshot] = useState(cached);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState("");
  const [whatsappTestPhone, setWhatsappTestPhone] = useState("");
  const [whatsappTestLoading, setWhatsappTestLoading] = useState(false);
  const [whatsappTestResult, setWhatsappTestResult] = useState(null);

  const load = useCallback(async ({ silent = false, force = false } = {}) => {
    if (silent && !force && Date.now() - lastSilentRefreshAtRef.current < 15000) return;
    if (silent) lastSilentRefreshAtRef.current = Date.now();
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
  }, []);

  useEffect(() => {
    load({ silent: Boolean(initialCachedRef.current) });
    const refreshFromEvent = () => {
      invalidateGetCache({ url: "/admin/monitoring", purge: true });
      load({ silent: true });
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) refreshFromEvent();
    };
    window.addEventListener("cls:realtime-event", refreshFromEvent);
    window.addEventListener("cls:realtime-connection", refreshFromEvent);
    window.addEventListener("online", refreshFromEvent);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("cls:realtime-event", refreshFromEvent);
      window.removeEventListener("cls:realtime-connection", refreshFromEvent);
      window.removeEventListener("online", refreshFromEvent);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load]);

  const sendWhatsappTest = async () => {
    const phone = whatsappTestPhone.trim();
    setWhatsappTestResult(null);
    if (!phone) {
      setWhatsappTestResult({ success: false, message: "Enter a WhatsApp number with country code, for example +919876543210." });
      return;
    }

    setWhatsappTestLoading(true);
    try {
      const response = await api.post("/admin/test-whatsapp", { phone });
      const payload = response.data || {};
      setWhatsappTestResult({
        success: Boolean(payload.success),
        message: payload.success
          ? `Test WhatsApp sent${payload.messageSid ? ` (${payload.messageSid})` : ""}.`
          : payload.error || payload.deliveryStatus || "WhatsApp test failed.",
      });
      await load({ silent: true });
    } catch (err) {
      setWhatsappTestResult({
        success: false,
        message: err.response?.data?.message || err.response?.data?.error || err.message || "WhatsApp test failed.",
      });
    } finally {
      setWhatsappTestLoading(false);
    }
  };

  const cards = snapshot?.healthCards || {};
  const overview = snapshot?.platformOverview || {};
  const apiPerf = snapshot?.apiPerformance || {};
  const firestore = snapshot?.firestoreMonitoring || {};
  const projection = snapshot?.projectionHealth || {};
  const realtime = snapshot?.realtimeMonitoring || {};
  const notifications = snapshot?.notificationMonitoring || realtime.notificationDelivery || {};
  const cache = snapshot?.cacheMonitoring || {};
  const whatsapp = snapshot?.whatsappMonitoring || {};
  const queue = snapshot?.queueMonitoring || {};
  const branches = snapshot?.branchMonitoring || {};
  const dealers = snapshot?.dealerMonitoring || {};
  const alerts = snapshot?.systemAlerts || [];
  const portals = snapshot?.portalHealth || [];
  const leads = snapshot?.leadMonitoring || {};
  const business = snapshot?.businessMonitoring || {};
  const security = snapshot?.securityMonitoring || {};
  const services = snapshot?.serviceHealth || {};

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
    <AdminMonitoringContent
      alerts={alerts}
      apiPerf={apiPerf}
      business={business}
      branchCapacityRows={branchCapacityRows}
      branchLocationRows={branchLocationRows}
      branches={branches}
      branchStateRows={branchStateRows}
      cache={cache}
      cards={cards}
      dealerBrandRows={dealerBrandRows}
      dealerLocationRows={dealerLocationRows}
      dealers={dealers}
      dealerStateRows={dealerStateRows}
      error={error}
      firestore={firestore}
      load={load}
      loading={loading}
      leads={leads}
      overview={overview}
      projection={projection}
      projectionCollections={projectionCollections}
      portals={portals}
      queue={queue}
      queueRows={queueRows}
      realtime={realtime}
      security={security}
      services={services}
      notifications={notifications}
      sendWhatsappTest={sendWhatsappTest}
      setWhatsappTestPhone={setWhatsappTestPhone}
      snapshot={snapshot}
      whatsapp={whatsapp}
      whatsappTestLoading={whatsappTestLoading}
      whatsappTestPhone={whatsappTestPhone}
      whatsappTestResult={whatsappTestResult}
    />
  );
}
