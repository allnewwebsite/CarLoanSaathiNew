import { useEffect } from "react";

export function DeleteExecutiveModal({ executive, activeLeadBlock, busy, onCancel, onConfirm, onTransfer }) {
  useEffect(() => {
    if (!executive) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, executive, onCancel]);

  if (!executive) return null;

  const executiveName = executive.name || executive.fullName || executive.email || executive.officialEmail || "Executive";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="delete-executive-title" className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-2xl">
        <h2 id="delete-executive-title" className="text-lg font-semibold text-slate-950">Delete Executive</h2>
        <p className="mt-3 text-sm leading-6 text-slate-700">You are about to permanently delete this executive.</p>
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Executive Name</p>
          <p className="mt-1 text-sm font-semibold text-slate-950">{executiveName}</p>
        </div>
        <p className="mt-4 text-sm font-semibold text-red-700">This action cannot be undone.</p>
        <div className="mt-4 text-sm text-slate-700">
          <p className="font-semibold text-slate-900">Before deletion ensure:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>No active assigned cases</li>
            <li>No pending transfers</li>
            <li>No active reassignment operations</li>
          </ul>
        </div>
        {activeLeadBlock ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <p className="font-semibold">Executive has active cases.</p>
            <p>{activeLeadBlock.activeLeadCount} active case{activeLeadBlock.activeLeadCount === 1 ? "" : "s"} must be transferred before deletion.</p>
          </div>
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60">Cancel</button>
          {activeLeadBlock ? (
            <button type="button" onClick={onTransfer} className="rounded-md bg-[#0d47a1] px-4 py-2 text-sm font-semibold text-white">Transfer Leads</button>
          ) : (
            <button type="button" disabled={busy} onClick={onConfirm} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {busy ? "Deleting..." : "Delete Executive"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
