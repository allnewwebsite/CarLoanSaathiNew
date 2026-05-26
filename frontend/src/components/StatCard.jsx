import { TrendingUp } from "lucide-react";

export function StatCard({ label, value, delta }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <h3 className="text-2xl font-semibold text-slate-900">{value}</h3>
        {delta && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"><TrendingUp className="h-3 w-3" />{delta}</span>}
      </div>
    </div>
  );
}
