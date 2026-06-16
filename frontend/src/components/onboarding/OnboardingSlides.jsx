import { CheckCircle2 } from "lucide-react";

function Illustration({ slide }) {
  const Icon = slide.icon;
  return (
    <div className="relative min-h-56 overflow-hidden rounded-xl bg-gradient-to-br from-[#0d47a1] via-[#1565c0] to-[#08736d] p-5 text-white sm:min-h-72">
      <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-white/10" />
      <div className="absolute -bottom-16 left-8 h-48 w-48 rounded-full bg-white/10" />
      <div className="relative flex h-full flex-col justify-between">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25">
          <Icon className="h-7 w-7" />
        </span>
        <div className="mt-10 grid gap-3">
          <div className="h-3 w-28 rounded-full bg-white/40" />
          <div className="h-3 w-44 rounded-full bg-white/25" />
          <div className="grid grid-cols-3 gap-2 pt-2">
            <div className="h-16 rounded-xl bg-white/15" />
            <div className="h-16 rounded-xl bg-white/20" />
            <div className="h-16 rounded-xl bg-white/15" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function OnboardingSlides({ slide }) {
  return (
    <div className="grid gap-6 md:grid-cols-[0.95fr_1.05fr] md:items-center">
      <Illustration slide={slide} />
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0d47a1]">{slide.eyebrow}</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{slide.title}</h2>
        {slide.message ? <p className="mt-4 text-sm leading-6 text-slate-600 sm:text-base">{slide.message}</p> : null}
        {slide.highlights?.length ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {slide.highlights.map((item) => (
              <div key={item.text} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium text-slate-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                <span>{item.text}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
