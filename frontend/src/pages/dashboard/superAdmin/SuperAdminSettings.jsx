import { useEffect, useState } from "react";
import { DetailPageSkeleton } from "../../../components/ui/Loading.jsx";
import { api, getCachedGetData } from "../../../services/api.js";

function SettingCard({ title, text, children }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="text-base font-semibold text-slate-900">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-500">{text}</p>{children && <div className="mt-3">{children}</div>}</div>;
}

export function SystemSettings({ data }) {
  const cachedSettings = getCachedGetData("/admin/workflow/settings");
  const [settings, setSettings] = useState(() => cachedSettings || null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.get("/admin/workflow/settings").then((response) => setSettings(response.data || {})).catch(() => setSettings({}));
  }, []);

  const update = async (patch) => {
    const next = { ...(settings || {}), ...patch };
    setSettings(next);
    const response = await api.patch("/admin/workflow/settings", next);
    setMessage(response.data.message || "Settings updated");
  };

  if (!settings) return <DetailPageSkeleton cards={3} />;

  return (
    <section className="grid gap-4 lg:grid-cols-3">
      {message && <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700 lg:col-span-3">{message}</div>}
      <SettingCard title="Routing Logic" text="City match, fallback routing, and assignment engine.">
        <button onClick={() => update({ routingEngineEnabled: !settings.routingEngineEnabled })} className="rounded-md bg-[#0d47a1] px-3 py-2 text-sm font-medium text-white">{settings.routingEngineEnabled === false ? "Enable Routing" : "Pause Routing"}</button>
      </SettingCard>
      <SettingCard title="WhatsApp Provider" text="Dry-run mode and notification provider controls.">
        <button onClick={() => update({ whatsappDryRun: !settings.whatsappDryRun })} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">{settings.whatsappDryRun ? "Disable Dry Run" : "Enable Dry Run"}</button>
      </SettingCard>
      <SettingCard title="Supported Cities" text={`${data.onboardingRequests.map((item) => item.city).filter(Boolean).length} dealership city mappings tracked.`} />
      <SettingCard title="Active Banks" text={`${data.bankPartners.length + data.banks.length} bank records available.`} />
      <SettingCard title="Audit Records" text={`${data.auditLogs.length} platform audit records available.`} />
    </section>
  );
}
