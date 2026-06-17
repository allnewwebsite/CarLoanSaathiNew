import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LEAD_TABLE_LABELS } from "../../constants/leadTableLabels.js";
import { useDebouncedValue } from "../../hooks/useDebouncedValue.js";
import { BankManagerTable as Table, PageTitle, SearchBar } from "./BankManagerPanelParts.jsx";
import { useBankDealershipDisbursedCases, useBankDealerships } from "./bankManager.hooks.js";
import { caseId, dateTime, display, generatedAt, leadStatusLabel, moneyValue, numberValue } from "./bankManager.helpers.js";

export function BankDealershipsPage() {
  const navigate = useNavigate();
  const { rows, total, hasMore, loading, page, onPage } = useBankDealerships();
  const [dealershipFilter, setDealershipFilter] = useState("");
  const dealershipOptions = useMemo(() => rows.map((dealership) => ({
    id: String(dealership.dealershipId || dealership.id || "").trim(),
    name: dealership.dealershipName || dealership.dealerName || dealership.dealershipEmail || dealership.id,
  })).filter((dealership) => dealership.id).sort((left, right) => left.name.localeCompare(right.name)), [rows]);
  const visibleDealerships = useMemo(() => rows.filter((dealership) => {
    if (!dealershipFilter) return true;
    return String(dealership.dealershipId || dealership.id || "").trim() === dealershipFilter;
  }), [dealershipFilter, rows]);
  const tableRows = useMemo(() => visibleDealerships.map((dealership) => ({
    key: dealership.id || dealership.dealershipId,
    cells: [
      display(dealership.dealershipName || dealership.dealerName),
      display(dealership.dealershipEmail),
      display(dealership.city || dealership.dealershipCity),
      display(dealership.dealerMobile),
      numberValue(dealership.totalCases),
      numberValue(dealership.activeCases),
      <button
        key="disbursed"
        type="button"
        onClick={() => navigate(`/bank-manager/dealerships/${encodeURIComponent(dealership.dealershipId || dealership.id)}/disbursed`)}
        className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-[#0d47a1]"
      >
        {numberValue(dealership.totalDisbursedCases)}
      </button>,
      dateTime(dealership.lastLeadAt || dealership.updatedAt),
    ],
  })), [navigate, visibleDealerships]);
  return (
    <section className="space-y-4">
      <PageTitle title="All Dealerships" />
      <p className="text-sm text-slate-500">Dealerships actively sending business to this bank.</p>
      <div className="flex justify-end">
        <label htmlFor="bank-dealership-filter" className="sr-only">Filter dealership activity</label>
        <select id="bank-dealership-filter" value={dealershipFilter} onChange={(event) => setDealershipFilter(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100 sm:w-64">
          <option value="">All Dealerships</option>
          {dealershipOptions.map((dealership) => <option key={dealership.id} value={dealership.id}>{dealership.name}</option>)}
        </select>
      </div>
      <Table title="Dealership Business Activity" headers={["Dealership", "Email", "City", "Mobile", "Total Cases", "Active Cases", "Total Disbursed Cases", "Last Activity"]} rows={tableRows} loading={loading} page={page} total={total} hasMore={hasMore} onPage={onPage} />
    </section>
  );
}

export function BankDealershipDisbursedPage() {
  const navigate = useNavigate();
  const { dealershipId = "" } = useParams();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 180);
  const { rows, total, hasMore, loading, page, onPage } = useBankDealershipDisbursedCases(dealershipId, debouncedSearch);
  const dealershipName = rows[0]?.dealershipName || rows[0]?.dealerName || rows[0]?.dealershipEmail || "Dealership";
  const tableRows = useMemo(() => rows.map((lead) => ({
    key: lead.id,
    cells: [
      caseId(lead),
      display(lead.fullName || lead.customerName),
      display(lead.mobile),
      display(lead.city || lead.dealershipCity),
      moneyValue(lead.loanAmount || lead.requiredLoanAmount),
      display(lead.assignedExecutiveName || lead.assignedExecutiveEmail),
      display(lead.assignedExecutiveMobile || lead.executiveMobile),
      leadStatusLabel(lead),
      generatedAt(lead),
      dateTime(lead.statusUpdatedAt || lead.updatedAt || lead.createdAt),
      <button key="view" onClick={() => navigate(`/bank-manager/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View</button>,
    ],
  })), [navigate, rows]);
  return (
    <section className="space-y-4">
      <PageTitle title={`${dealershipName} Disbursed Cases`} />
      <p className="text-sm text-slate-500">Disbursed cases for this dealership within the current bank scope.</p>
      <SearchBar value={search} onChange={setSearch} />
      <Table title="Disbursed Cases" headers={["Case ID", "Customer Name", "Mobile Number", "Customer City", "Loan Amount", LEAD_TABLE_LABELS.assignedExecutive, LEAD_TABLE_LABELS.executiveMobile, LEAD_TABLE_LABELS.currentStatus, LEAD_TABLE_LABELS.generatedDate, LEAD_TABLE_LABELS.lastUpdated, "Action"]} rows={tableRows} loading={loading} page={page} total={total} hasMore={hasMore} onPage={onPage} />
    </section>
  );
}
