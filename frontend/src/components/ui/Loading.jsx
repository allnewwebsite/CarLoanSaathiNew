import { Loader2 } from "lucide-react";

export function ButtonSpinner({ className = "h-4 w-4" }) {
  return <Loader2 className={`${className} animate-spin`} aria-hidden="true" />;
}

export function CardSkeleton({ className = "" }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-4 ${className}`} aria-hidden="true">
      <div className="h-3 w-1/4 animate-pulse rounded bg-slate-200" />
      <div className="mt-4 h-5 w-2/3 animate-pulse rounded bg-slate-200/90" />
      <div className="mt-3 h-3 w-1/2 animate-pulse rounded bg-slate-200/75" />
    </section>
  );
}

export function DetailPageSkeleton({ cards = 6 }) {
  return (
    <section className="space-y-4" aria-hidden="true">
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="h-3 w-32 animate-pulse rounded bg-slate-200" />
        <div className="mt-4 h-7 w-72 max-w-full animate-pulse rounded bg-slate-200/90" />
        <div className="mt-3 h-4 w-96 max-w-full animate-pulse rounded bg-slate-200/75" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: cards }).map((_, index) => <CardSkeleton key={index} />)}
      </div>
    </section>
  );
}
