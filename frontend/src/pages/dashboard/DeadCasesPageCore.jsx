import { Download, Plus, Search } from "lucide-react";
import { useMemo } from "react";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { AUDIENCE_LABELS, PAGE_SIZE, downloadCsv } from "./deadCases.helpers.js";
import { useDeadCasesPageState } from "./deadCases.hooks.js";
import { roleColumns } from "./deadCases.columns.jsx";
import { DeadCaseDialogs } from "./DeadCaseDialogs.jsx";
import { DEAD_CASE_REASONS } from "./finance/financeLeadPage.helpers.js";

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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
              {AUDIENCE_LABELS[audience] || AUDIENCE_LABELS.finance}
            </p>
            <h1 className="mt-1 text-xl font-semibold text-slate-900">Dead Cases</h1>
            <p className="mt-1 text-sm text-slate-500">Cases manually moved out of active workflow by Finance Desk.</p>
          </div>
          {state.canModify ? (
            <button
              type="button"
              onClick={state.openAdd}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#0d47a1] px-4 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" />
              Add Dead Case
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 lg:grid-cols-[1fr_220px_auto] lg:items-center">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 px-3 sm:max-w-xl">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={state.search}
            onChange={(event) => state.setSearch(event.target.value)}
            placeholder="Search case ID, customer, mobile, reason, or executive"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <select
          value={state.reasonFilter}
          onChange={(event) => state.setReasonFilter(event.target.value)}
          className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none"
        >
          <option value="">All Reasons</option>
          {DEAD_CASE_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
        </select>
        <button
          type="button"
          onClick={() => downloadCsv(state.rows, audience, columns)}
          disabled={!state.rows.length}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-700 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
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
