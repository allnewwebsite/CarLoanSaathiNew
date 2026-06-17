import { ArrowRight, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { heroMetrics, platformRows } from "./home.data.js";

export function PortalLink({ to, label, variant = "primary" }) {
  const styles = {
    dealer: "border-blue-100 bg-blue-50 text-blue-800 hover:border-blue-200 hover:bg-blue-100",
    bank: "border-emerald-100 bg-emerald-50 text-emerald-800 hover:border-emerald-200 hover:bg-emerald-100",
    head: "border-amber-100 bg-amber-50 text-amber-800 hover:border-amber-200 hover:bg-amber-100",
    executive: "border-violet-100 bg-violet-50 text-violet-800 hover:border-violet-200 hover:bg-violet-100",
    primary: "border-blue-100 bg-blue-50 text-blue-800 hover:border-blue-200 hover:bg-blue-100",
  };
  const className = `group inline-flex h-12 min-w-[11rem] items-center justify-center whitespace-nowrap rounded-full border px-5 text-sm font-semibold leading-none transition hover:-translate-y-0.5 public-soft-shadow ${styles[variant] || styles.primary}`;

  return (
    <Link to={to} className={className}>
      {label}
      <ArrowRight className="ml-2 h-4 w-4 transition group-hover:translate-x-0.5" />
    </Link>
  );
}

function DashboardMockup() {
  return (
    <div className="relative mx-auto w-full max-w-2xl public-fade-in">
      <div className="absolute -left-8 top-12 hidden rounded-2xl bg-white/80 p-4 public-glass public-float lg:block">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Realtime</p>
        <p className="mt-1 text-2xl font-semibold text-slate-950">Live</p>
        <p className="text-xs text-emerald-600">Case updates synced</p>
      </div>
      <div className="absolute -right-6 bottom-10 hidden rounded-2xl bg-white/85 p-4 public-glass public-float-delayed lg:block">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Queue</p>
        <p className="mt-1 text-2xl font-semibold text-slate-950">247</p>
        <p className="text-xs text-blue-700">Cases in motion</p>
      </div>

      <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/85 public-premium-shadow">
        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-5 py-4">
          <span className="h-3 w-3 rounded-full bg-red-400" />
          <span className="h-3 w-3 rounded-full bg-amber-400" />
          <span className="h-3 w-3 rounded-full bg-emerald-400" />
          <span className="ml-3 rounded-full bg-white px-4 py-1 text-xs font-medium text-slate-500">platform.carloansaathi</span>
        </div>
        <div className="grid gap-0 md:grid-cols-[170px_1fr]">
          <aside className="hidden border-r border-slate-100 bg-slate-950 p-4 text-white md:block">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-200">Workspace</p>
            {["Cases", "Bank Routing", "Documents", "Status", "Analytics"].map((item, index) => (
              <div
                key={item}
                className={`mt-3 rounded-xl px-3 py-2 text-sm ${index === 0 ? "bg-white text-slate-950" : "text-slate-300"}`}
              >
                {item}
              </div>
            ))}
          </aside>
          <div className="p-5 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Live workflow</p>
                <h3 className="mt-2 text-xl font-semibold text-slate-950">Dealer to bank coordination</h3>
              </div>
              <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Operational</div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {["New cases", "Bank review", "Disbursed"].map((label, index) => (
                <div key={label} className="rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-blue-50 p-4">
                  <p className="text-xs font-medium text-slate-500">{label}</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">{[48, 126, 73][index]}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 overflow-hidden rounded-2xl border border-slate-100">
              {platformRows.map(([id, vehicle, status, branch, time]) => (
                <div key={id} className="grid grid-cols-[1fr_auto] gap-3 border-b border-slate-100 bg-white px-4 py-3 last:border-b-0 sm:grid-cols-[0.8fr_0.9fr_1fr_auto]">
                  <div>
                    <p className="text-xs font-semibold text-slate-400">{id}</p>
                    <p className="text-sm font-semibold text-slate-900">{vehicle}</p>
                  </div>
                  <p className="hidden text-sm font-medium text-slate-600 sm:block">{status}</p>
                  <p className="hidden text-sm text-slate-500 sm:block">{branch}</p>
                  <p className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">{time}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function HomeHero() {
  return (
    <section className="relative overflow-hidden bg-[radial-gradient(circle_at_top_left,#dbeafe_0%,#ffffff_34%,#f8fafc_100%)] px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div className="public-gradient-orb absolute -left-28 top-16 h-72 w-72 rounded-full bg-blue-300/30 blur-3xl" />
      <div className="public-gradient-orb absolute right-0 top-0 h-96 w-96 rounded-full bg-cyan-200/40 blur-3xl" />

      <div className="relative mx-auto grid w-full max-w-7xl items-center gap-12 lg:grid-cols-[1fr_1.05fr]">
        <div className="public-fade-in">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white/80 px-4 py-2 text-sm font-semibold text-blue-700 public-glass">
            <Sparkles className="h-4 w-4" />
            Enterprise dealer-bank connectivity platform
          </div>
          <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-[1.05] tracking-[-0.055em] text-slate-950 sm:text-6xl lg:text-7xl">
            Loan workflow management built for modern dealership operations.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            CarLoanSaathi connects dealerships, finance teams, bank branches, and executives through a controlled platform for case tracking, bank coordination, and operational visibility.
          </p>
          <p className="mt-8 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Existing users</p>
          <div className="mt-8 flex max-w-4xl flex-col gap-3 sm:flex-row sm:flex-wrap">
            <PortalLink to="/dealer/login" label="Dealer Login" variant="dealer" />
            <PortalLink to="/bank/login" label="Bank Login" variant="bank" />
            <PortalLink to="/finance/login" label="Dealership Head Login" variant="head" />
            <PortalLink to="/executive/login" label="Loan Executive Login" variant="executive" />
          </div>
          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {heroMetrics.map(([value, label, note]) => (
              <div key={label} className="rounded-2xl border border-white bg-white/80 p-4 public-soft-shadow">
                <p className="public-counter text-2xl font-semibold tracking-[-0.03em] text-slate-950">{value}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">{label}</p>
                <p className="mt-2 text-[11px] font-semibold text-blue-700">{note}</p>
              </div>
            ))}
          </div>
        </div>

        <DashboardMockup />
      </div>
    </section>
  );
}
