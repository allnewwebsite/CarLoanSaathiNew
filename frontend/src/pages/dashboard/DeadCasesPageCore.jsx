import { Download, Plus } from "lucide-react";
import { useMemo } from "react";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { PolicyInformationBanner } from "../../components/LifecycleArchiveHeader.jsx";
import { DEAD_CASE_REASONS } from "../../constants/deadCaseReasons.js";
import { AUDIENCE_LABELS, PAGE_SIZE, downloadCsv } from "./deadCases.helpers.js";
import { useDeadCasesPageState } from "./deadCases.hooks.js";
import { roleColumns } from "./deadCases.columns.jsx";
import { DeadCaseDialogs } from "./DeadCaseDialogs.jsx";

export function DeadCasesPage({ audience = "finance" }) {
  const state = useDeadCasesPageState(audience);
  const columns = useMemo(() => roleColumns(audience, state.canModify, state.openEdit), [audience, state.canModify, state.openEdit]);
  const headers = useMemo(() => columns.map((column) => column.header), [columns]);
  const tableRows = useMemo(() => state.rows.map((lead) => ({
    key: lead.id,
    cells: columns.map((column) => column.cell(lead)),
  })), [columns, state.rows]);

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          {AUDIENCE_LABELS[audience] || AUDIENCE_LABELS.finance}
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Dead Cases</h1>
        <p className="mt-1 text-sm text-slate-500">Cases removed from the active loan workflow for lifecycle reference.</p>
      </div>

      <PolicyInformationBanner
        title="Dead Case Policy"
        description="Cases automatically move to Dead Cases when there is no status update for 7 calendar days after a Loan Executive accepts ownership. Dead Cases remain available in the CarLoanSaathi ecosystem for 3 calendar months for reference and search purposes. After 3 calendar months, all customer information, uploaded documents, workflow history, notifications, assignments, and related records are permanently deleted from the system. Deleted cases cannot be recovered. If the customer returns in the future, the Dealership Finance Manager must create a completely new case."
      />

      <div className="flex justify-end">
        <div className="flex w-full flex-col gap-3 rounded-[10px] border border-slate-200 bg-white p-3 shadow-sm sm:w-auto sm:flex-row sm:items-center">
          <select
            value={state.reasonFilter}
            onChange={(event) => state.setReasonFilter(event.target.value)}
            className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100 sm:w-56"
          >
            <option value="">Select Reason</option>
            {DEAD_CASE_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
          </select>
          <button
            type="button"
            onClick={() => downloadCsv(state.rows, audience, columns)}
            disabled={!state.rows.length}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 shadow-sm disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          {state.canModify ? (
            <button
              type="button"
              onClick={state.openAdd}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0d47a1] px-4 text-sm font-semibold text-white shadow-sm"
            >
              <Plus className="h-4 w-4" />
              Add Dead Case
            </button>
          ) : null}
        </div>
      </div>

      <OperationalTable
        title="Dead Cases"
        headers={headers}
        rows={tableRows}
        loading={state.loading}
        page={state.page}
        total={null}
        hasMore={state.hasMore}
        onPage={state.setPage}
        pageSize={PAGE_SIZE}
      />

      <DeadCaseDialogs
        actionId={state.actionId}
        addError={state.addError}
        addNotes={state.addNotes}
        addOpen={state.addOpen}
        addReason={state.addReason}
        addSaving={state.addSaving}
        caseNumber={state.caseNumber}
        editError={state.editError}
        editLead={state.editLead}
        editNotes={state.editNotes}
        editReason={state.editReason}
        onAddNotesChange={state.setAddNotes}
        onAddReasonChange={state.setAddReason}
        onCaseNumberChange={state.setCaseNumber}
        onCloseAdd={() => state.setAddOpen(false)}
        onCloseEdit={() => state.setEditLead(null)}
        onEditNotesChange={state.setEditNotes}
        onEditReasonChange={state.setEditReason}
        onRestore={state.restoreCase}
        onSaveEdit={state.saveEdit}
        onSubmitAdd={state.submitAdd}
      />
    </section>
  );
}
