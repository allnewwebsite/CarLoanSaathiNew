import { BadgeCheck, Bell, Network } from "lucide-react";
import {
  animatedKpis,
  comparisonAfter,
  comparisonBefore,
  journeyStages,
  lifecycleStatuses,
  notificationFeed,
} from "./home.data.js";

function CountUpMetric({ value }) {
  return <span>{Number(value || 0).toLocaleString("en-IN")}</span>;
}

export function AnimatedWorkflow() {
  return (
    <article className="rounded-[2rem] border border-blue-100 bg-white p-6 public-soft-shadow">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">Automated journey</p>
          <h3 className="mt-2 text-xl font-semibold text-slate-950">Customer to disbursement</h3>
        </div>
        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">Live loop</span>
      </div>
      <div className="mt-6 grid gap-3">
        {journeyStages.map(([title, text], index) => (
          <div key={title} className="relative grid grid-cols-[2.5rem_1fr] gap-3">
            <div className="relative flex justify-center">
              {index < journeyStages.length - 1 && (
                <div className="absolute top-10 h-[calc(100%+0.75rem)] w-px overflow-hidden bg-blue-100">
                  <span className="public-flow-y absolute left-0 top-0 h-12 w-px bg-blue-500" style={{ animationDelay: `${index * 0.18}s` }} />
                </div>
              )}
              <div className="public-stage-glow relative z-10 flex h-10 w-10 items-center justify-center rounded-2xl border border-blue-100 bg-white text-sm font-semibold text-blue-700" style={{ animationDelay: `${index * 0.42}s` }}>
                {index + 1}
              </div>
            </div>
            <div className="public-soft-pulse rounded-2xl border border-slate-100 bg-gradient-to-r from-white to-blue-50/70 px-4 py-3" style={{ animationDelay: `${index * 0.42}s` }}>
              <p className="text-sm font-semibold text-slate-950">{title}</p>
              <p className="mt-1 text-xs text-slate-500">{text}</p>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

export function CaseLifecycleDemo() {
  return (
    <article className="rounded-[2rem] border border-emerald-100 bg-gradient-to-br from-white to-emerald-50 p-6 public-soft-shadow">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-600">Case lifecycle</p>
      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-semibold text-slate-950">CLS-1024</h3>
          <p className="mt-1 text-sm text-slate-600">A loan case moving automatically through the platform.</p>
        </div>
        <BadgeCheck className="h-6 w-6 text-emerald-600" />
      </div>
      <div className="mt-6 grid gap-3">
        {lifecycleStatuses.map((status, index) => (
          <div key={status} className="public-lifecycle-pulse flex items-center justify-between rounded-2xl border border-emerald-100 bg-white px-4 py-3" style={{ animationDelay: `${index * 0.45}s` }}>
            <span className="text-sm font-semibold text-slate-800">{status}</span>
            <span className="public-dot-pulse h-2.5 w-2.5 rounded-full bg-emerald-500" style={{ animationDelay: `${index * 0.45}s` }} />
          </div>
        ))}
      </div>
    </article>
  );
}

export function DashboardShowcaseAnimation() {
  return (
    <article className="rounded-[2rem] border border-slate-200 bg-white p-6 public-soft-shadow">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">Dashboard animation</p>
      <h3 className="mt-2 text-xl font-semibold text-slate-950">KPI cards that make operations visible</h3>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {animatedKpis.map(([label, value, note], index) => (
          <div key={label} className="public-fade-in rounded-2xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white p-4 transition-transform duration-200 hover:-translate-y-1" style={{ animationDelay: `${index * 0.06}s` }}>
            <p className="text-xs font-semibold text-slate-500">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950"><CountUpMetric value={value} /></p>
            <p className="mt-1 text-xs text-blue-700">{note}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

export function ConnectivityAnimation() {
  const nodes = ["Dealership", "Bank Branch", "Executive", "Disbursement"];
  return (
    <article className="rounded-[2rem] border border-blue-100 bg-gradient-to-br from-white to-blue-50 p-6 public-soft-shadow">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">Connectivity flow</p>
      <h3 className="mt-2 text-xl font-semibold text-slate-950">Dealer, bank, and executive stay connected</h3>
      <div className="mt-7 grid gap-4 md:grid-cols-4">
        {nodes.map((node, index) => (
          <div key={node} className="relative">
            {index < nodes.length - 1 && <div className="absolute left-1/2 top-6 hidden h-px w-full overflow-hidden bg-blue-100 md:block"><span className="public-flow-x absolute top-0 h-px w-16 bg-blue-500" style={{ animationDelay: `${index * 0.2}s` }} /></div>}
            <div className="public-node-float relative z-10 rounded-2xl border border-white bg-white p-4 text-center public-soft-shadow" style={{ animationDelay: `${index * 0.25}s` }}>
              <Network className="mx-auto h-5 w-5 text-blue-700" />
              <p className="mt-3 text-sm font-semibold text-slate-900">{node}</p>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

export function NotificationShowcase() {
  return (
    <article className="rounded-[2rem] border border-amber-100 bg-gradient-to-br from-white to-amber-50 p-6 public-soft-shadow">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-600">Realtime updates</p>
          <h3 className="mt-2 text-xl font-semibold text-slate-950">Notifications appear as work moves</h3>
        </div>
        <Bell className="h-6 w-6 text-amber-600" />
      </div>
      <div className="mt-6 space-y-3">
        {notificationFeed.map(([title, text], index) => (
          <div key={title} className="public-notification-pulse rounded-2xl border border-amber-100 bg-white px-4 py-3" style={{ animationDelay: `${index * 0.5}s` }}>
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            <p className="mt-1 text-xs text-slate-500">{text}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

export function BeforeAfterComparison() {
  return (
    <article className="rounded-[2rem] border border-slate-200 bg-white p-6 public-soft-shadow">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">Before vs After</p>
      <h3 className="mt-2 text-xl font-semibold text-slate-950">From manual follow-up to controlled workflow</h3>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-red-100 bg-red-50/70 p-4">
          <p className="text-sm font-semibold text-red-700">Before</p>
          <div className="mt-4 grid gap-3">
            {comparisonBefore.map(([label, Icon]) => <div key={label} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2"><Icon className="h-4 w-4 text-red-500" /><span className="text-sm font-semibold text-slate-700">{label}</span></div>)}
          </div>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4">
          <p className="text-sm font-semibold text-emerald-700">After</p>
          <div className="mt-4 grid gap-3">
            {comparisonAfter.map(([label, Icon]) => <div key={label} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2 transition-transform duration-200 hover:translate-x-1"><Icon className="h-4 w-4 text-emerald-600" /><span className="text-sm font-semibold text-slate-700">{label}</span></div>)}
          </div>
        </div>
      </div>
    </article>
  );
}
