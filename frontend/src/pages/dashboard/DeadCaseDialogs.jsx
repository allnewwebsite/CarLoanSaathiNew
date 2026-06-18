import { RotateCcw, X } from "lucide-react";
import { DEAD_CASE_REASONS } from "./finance/financeLeadPage.helpers.js";

export function DeadCaseDialogs({
  actionId,
  addError,
  addNotes,
  addOpen,
  addReason,
  addSaving,
  caseNumber,
  editError,
  editLead,
  editNotes,
  editReason,
  onAddNotesChange,
  onAddReasonChange,
  onCaseNumberChange,
  onCloseAdd,
  onCloseEdit,
  onEditNotesChange,
  onEditReasonChange,
  onRestore,
  onSaveEdit,
  onSubmitAdd,
}) {
  return (
    <>
      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-base font-semibold text-slate-900">Add Dead Case</h3>
              <button type="button" onClick={onCloseAdd} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-4">
              <label className="block text-sm font-medium text-slate-700">
                Case Number *
                <input
                  value={caseNumber}
                  onChange={(event) => onCaseNumberChange(event.target.value)}
                  placeholder="CLS-0001"
                  className="mt-1.5 h-10 w-full rounded-md border border-slate-300 px-3 text-sm uppercase outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Dead Reason *
                <select value={addReason} onChange={(event) => onAddReasonChange(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100">
                  <option value="">Select reason</option>
                  {DEAD_CASE_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Dead Notes *
                <textarea
                  value={addNotes}
                  onChange={(event) => onAddNotesChange(event.target.value)}
                  rows={4}
                  className="mt-1.5 w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100"
                  placeholder="Customer purchased vehicle from another dealer."
                />
              </label>
              {addError ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{addError}</p> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button type="button" onClick={onCloseAdd} className="h-9 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700">Cancel</button>
              <button type="button" onClick={onSubmitAdd} disabled={addSaving} className="h-9 rounded-md bg-[#0d47a1] px-3 text-xs font-medium text-white disabled:opacity-50">
                {addSaving ? "Saving..." : "Add To Dead Cases"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {editLead ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h3 className="text-base font-semibold text-slate-900">Update Dead Case</h3>
              <button type="button" onClick={onCloseEdit} className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-4">
              <label className="block text-sm font-medium text-slate-700">
                Dead Reason *
                <select value={editReason} onChange={(event) => onEditReasonChange(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100">
                  <option value="">Select reason</option>
                  {DEAD_CASE_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Dead Notes *
                <textarea value={editNotes} onChange={(event) => onEditNotesChange(event.target.value)} rows={4} className="mt-1.5 w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100" />
              </label>
              {editError ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{editError}</p> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <button type="button" onClick={onCloseEdit} className="h-9 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700">Cancel</button>
              <button type="button" onClick={() => onRestore(editLead)} disabled={actionId === editLead.id} className="inline-flex h-9 items-center gap-1 rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 disabled:opacity-50">
                <RotateCcw className="h-3.5 w-3.5" />
                {actionId === editLead.id ? "Restoring..." : "Restore"}
              </button>
              <button type="button" onClick={onSaveEdit} disabled={actionId === editLead.id} className="h-9 rounded-md bg-[#0d47a1] px-3 text-xs font-medium text-white disabled:opacity-50">
                {actionId === editLead.id ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
