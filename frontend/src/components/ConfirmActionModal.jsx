import { AlertTriangle, Loader2, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";

export function ConfirmActionModal({
  open,
  title,
  eyebrow = "Confirm Action",
  message,
  detail = "",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  loading = false,
  danger = true,
  onConfirm,
  onCancel,
}) {
  const titleId = useId();
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !loading) onCancel?.();
    };
    window.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus?.();
    };
  }, [loading, onCancel, open]);

  if (!open) return null;

  const accent = danger ? "bg-red-50 text-red-700 ring-red-100" : "bg-[#0d47a1]/10 text-[#0d47a1] ring-[#0d47a1]/10";
  const confirmClass = danger
    ? "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500/30"
    : "bg-[#0d47a1] text-white hover:bg-[#083b86] focus:ring-[#0d47a1]/30";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onCancel?.();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md ring-1 ${accent}`}>
              <AlertTriangle className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{eyebrow}</p>
              <h2 id={titleId} className="mt-1 text-lg font-semibold text-slate-950">{title}</h2>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            disabled={loading}
            onClick={onCancel}
            aria-label="Close confirmation"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="px-5 py-4">
          <p className="text-sm leading-6 text-slate-700">{message}</p>
          {detail ? (
            <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900">
              {detail}
            </p>
          ) : null}
        </div>
        <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${confirmClass}`}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
