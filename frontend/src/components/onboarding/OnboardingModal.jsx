import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { onboardingSlidesFor } from "../../data/onboardingSlides.js";
import { OnboardingProgress } from "./OnboardingProgress.jsx";
import { OnboardingSlides } from "./OnboardingSlides.jsx";

export function OnboardingModal({ open, user, onComplete, onSkip }) {
  const titleId = useId();
  const closeRef = useRef(null);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState("next");
  const slides = useMemo(() => (open ? onboardingSlidesFor(user) : []), [open, user]);
  const slide = slides[index] || slides[0];
  const last = index === slides.length - 1;

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setDirection("next");
  }, [open, user?.role, user?.uid]);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onSkip();
      if (event.key === "ArrowRight") setIndex((value) => Math.min(value + 1, slides.length - 1));
      if (event.key === "ArrowLeft") setIndex((value) => Math.max(value - 1, 0));
    };
    window.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus?.();
    };
  }, [onSkip, open, slides.length]);

  if (!open || !slide || !slides.length) return null;

  const previous = () => {
    setDirection("previous");
    setIndex((value) => Math.max(value - 1, 0));
  };
  const next = () => {
    if (last) return onComplete();
    setDirection("next");
    setIndex((value) => Math.min(value + 1, slides.length - 1));
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-5" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-white/40 bg-white shadow-2xl">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Product Tour</p>
            <h1 id={titleId} className="truncate text-lg font-semibold text-slate-950">Get started with CarLoanSaathi</h1>
          </div>
          <button ref={closeRef} type="button" onClick={onSkip} aria-label="Skip onboarding" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[calc(92vh-9.5rem)] overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
          <OnboardingProgress current={index} total={slides.length} />
          <div key={`${user?.role}-${index}`} className={`mt-6 transition-all duration-300 ease-out ${direction === "next" ? "animate-[fadeSlideIn_280ms_ease-out]" : "animate-[fadeSlideBack_280ms_ease-out]"}`}>
            <OnboardingSlides slide={slide} />
          </div>
        </div>

        <footer className="flex flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <button type="button" onClick={onSkip} className="rounded-md px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-white">
            Skip Tour
          </button>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={previous} disabled={index === 0} className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50">
              Previous
            </button>
            <button type="button" onClick={next} className="rounded-md bg-[#0d47a1] px-4 py-2 text-sm font-semibold text-white hover:bg-[#083b86]">
              {last ? slide.cta || "Finish" : "Next"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
