export function OnboardingProgress({ current, total }) {
  const progress = total ? ((current + 1) / total) * 100 : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        <span>Step {current + 1} of {total}</span>
        <span>{Math.round(progress)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-[#0d47a1] transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}
