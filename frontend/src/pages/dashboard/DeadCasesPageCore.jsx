import { Plus } from "lucide-react";
import { useMemo } from "react";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { PolicyInformationBanner } from "../../components/LifecycleArchiveHeader.jsx";
import { AUDIENCE_LABELS, PAGE_SIZE } from "./deadCases.helpers.js";
import { useDeadCasesPageState } from "./deadCases.hooks.js";
import { roleColumns } from "./deadCases.columns.jsx";
import { DeadCaseDialogs } from "./DeadCaseDialogs.jsx";
import { ArchiveSalespersonFilter } from "./ArchiveSalespersonFilter.jsx";

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

      <PolicyInformationBanner kind="dead" />

      {state.salespersonFilterEnabled ? (
        <ArchiveSalespersonFilter audience={audience} value={state.salespersonId} onChange={state.setSalesperson} />
      ) : null}

      {state.filterEnabled ? (
        <div className="flex justify-end">
          <label htmlFor="dead-cases-dealership-filter" className="sr-only">Select Dealership</label>
          <select id="dead-cases-dealership-filter" value={state.dealershipId} onChange={(event) => state.setDealership(event.target.value)} disabled={state.dealershipsLoading} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100 disabled:opacity-60 sm:w-64">
            <option value="">All Dealerships</option>
            {state.dealerships.map((dealership) => <option key={dealership.dealershipId} value={dealership.dealershipId}>{dealership.dealershipName}</option>)}
          </select>
        </div>
      ) : null}

      {state.canModify ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={state.openAdd}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#0d47a1] px-4 text-sm font-semibold text-white shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Add Dead Case
          </button>
        </div>
      ) : null}

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
        emptyMessage={state.salespersonId ? "No archived cases found for this salesperson." : "No dead cases found."}
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
