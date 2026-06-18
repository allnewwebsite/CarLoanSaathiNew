import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { LEAD_TABLE_LABELS } from "../../constants/leadTableLabels.js";
import { CURRENT_WORKFLOW_STATUS_OPTIONS, LEAD_STATUSES, normalizeStatus, statusLabel as standardStatusLabel } from "../../constants/status.js";
import { useDebouncedValue } from "../../hooks/useDebouncedValue.js";
import { usePageLatency } from "../../services/frontendLatency.js";
import { SectionTitle, Table } from "./gm/GmTrackingParts.jsx";
import { useGmLeads, useSalespersons } from "./gm/gmTracking.data.js";
import { allCaseHeaders, caseRows, statusRows, totalLeadHeaders, totalRows } from "./gm/gmTracking.rows.jsx";
import {
  display,
  salespersonFilterValue,
  sameSalesperson,
} from "./gm/gmTracking.helpers.js";

const statusCards = CURRENT_WORKFLOW_STATUS_OPTIONS.map((value) => ({ label: standardStatusLabel(value), value }));

function pageFromParams(params) {
  const value = Math.floor(Number(params.get("page") || 1));
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function TotalLeadsScreen() {
  const [params, setParams] = useSearchParams();
  const page = pageFromParams(params);
  const urlSearch = params.get("search") || "";
  const [search, setSearch] = useState(urlSearch);
  const debouncedSearch = useDebouncedValue(search, 180);
  const { leads, total, hasMore, loading } = useGmLeads({ search: debouncedSearch, page });
  const updateSearch = (value) => {
    setSearch(value);
  };
  useEffect(() => {
    setSearch(urlSearch);
  }, [urlSearch]);
  useEffect(() => {
    if (debouncedSearch === urlSearch) return;
    const nextParams = debouncedSearch ? { search: debouncedSearch, page: "1" } : { page: "1" };
    setParams(nextParams, { replace: true });
  }, [debouncedSearch, setParams, urlSearch]);
  const pageTo = (nextPage) => {
    const targetPage = Math.max(Math.floor(Number(nextPage || 1)), 1);
    setParams(debouncedSearch ? { search: debouncedSearch, page: String(targetPage) } : { page: String(targetPage) });
  };
  return (
    <section className="space-y-4">
      <SectionTitle title="Total Leads" subtitle="All leads created by this dealership." />
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3"><Search className="h-4 w-4 text-slate-400" /><input className="h-9 flex-1 outline-none" placeholder="Search Case ID, customer, mobile" value={search} onChange={(event) => updateSearch(event.target.value)} /></div>
      <Table title="Total Leads" headers={totalLeadHeaders} rows={totalRows(leads)} loading={loading} page={page} total={total} hasMore={hasMore} onPage={pageTo} />
    </section>
  );
}

function SalespersonsScreen() {
  const navigate = useNavigate();
  const { salespersons, loading } = useSalespersons();
  const rows = salespersons.map((person) => ({
    key: person.id,
    cells: [
      person.name,
      person.mobile,
      person.jobId,
      person.email,
      person.totalCases || 0,
      person.disbursedCases || 0,
      person.rejectedCases || 0,
      person.pendingCases || 0,
      <button key="view" onClick={() => navigate(`/gm/salespersons/${encodeURIComponent(salespersonFilterValue(person))}/cases`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View Cases</button>,
    ],
  }));
  return (
    <section className="space-y-4">
      <SectionTitle title="All Salespersons" subtitle="Salespersons belonging to this dealership only." />
      <Table title="Salespersons" headers={["Salesperson Name", "Mobile Number", "Job ID", "Mail ID", "Total Cases", "Disbursed Cases", "Rejected Cases", "Pending Cases", "Cases"]} rows={rows} loading={loading} />
    </section>
  );
}

function StatusScreen() {
  const [params, setParams] = useSearchParams();
  const requestedStatus = params.get("status") || CURRENT_WORKFLOW_STATUS_OPTIONS[0];
  const status = CURRENT_WORKFLOW_STATUS_OPTIONS.includes(normalizeStatus(requestedStatus))
    ? normalizeStatus(requestedStatus)
    : CURRENT_WORKFLOW_STATUS_OPTIONS[0];
  const [page, setPage] = useState(Number(params.get("page") || 1));
  const { leads, total, hasMore, loading, load } = useGmLeads({ status });
  const choose = (nextStatus) => {
    setPage(1);
    setParams({ status: nextStatus, page: "1" });
    load({ status: nextStatus, page: 1 });
  };
  const pageTo = (nextPage) => {
    setPage(nextPage);
    load({ status, page: nextPage });
  };
  const rejected = normalizeStatus(status) === LEAD_STATUSES.REJECTED;
  return (
    <section className="space-y-4">
      <SectionTitle title="Status" subtitle="Bank-updated loan statuses for this dealership." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statusCards.map((item) => <button key={item.value} onClick={() => choose(item.value)} className={`rounded-lg border p-4 text-left text-sm font-semibold ${status === item.value ? "border-[#0d47a1] bg-[#0d47a1] text-white" : "border-slate-200 bg-white text-slate-700 hover:border-[#0d47a1]/40"}`}>{item.label}</button>)}
      </div>
      <Table title="Status Cases" headers={rejected ? ["Case ID", "Customer Name", "Assigned Salesperson", "Loan Amount", LEAD_TABLE_LABELS.currentStatus, "Rejection Reason", LEAD_TABLE_LABELS.lastUpdated, "Last Updated Time", "Documents"] : ["Case ID", "Customer Name", "Assigned Salesperson", "Loan Amount", LEAD_TABLE_LABELS.currentStatus, LEAD_TABLE_LABELS.lastUpdated, "Last Updated Time", "Documents"]} rows={statusRows(leads, rejected)} loading={loading} page={page} total={total} hasMore={hasMore} onPage={pageTo} />
    </section>
  );
}

function AllCasesScreen() {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(Number(params.get("page") || 1));
  const salespersonId = params.get("salespersonId") || "";
  const { salespersons } = useSalespersons();
  const { leads, total, hasMore, loading, load } = useGmLeads({ salespersonId });
  const filter = (value) => {
    setPage(1);
    setParams(value ? { salespersonId: value, page: "1" } : { page: "1" });
    load({ salespersonId: value, page: 1 });
  };
  const pageTo = (nextPage) => {
    setPage(nextPage);
    load({ salespersonId, page: nextPage });
  };
  return (
    <section className="space-y-4">
      <SectionTitle title="All Cases" subtitle="Main dealership monitoring screen." />
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <select className="field max-w-sm" value={salespersonId} onChange={(event) => filter(event.target.value)}>
          <option value="">Select Salesperson</option>
          {salespersons.map((person) => <option key={person.id} value={salespersonFilterValue(person)}>{person.name} - {person.jobId}</option>)}
        </select>
      </div>
      <Table title="All Cases" headers={allCaseHeaders} rows={caseRows(leads)} loading={loading} page={page} total={total} hasMore={hasMore} onPage={pageTo} />
    </section>
  );
}

function SalespersonCasesScreen() {
  const { salespersonId } = useParams();
  const { salespersons } = useSalespersons();
  const salesperson = salespersons.find((person) => sameSalesperson(person, salespersonId));
  const { leads, total, hasMore, loading, load } = useGmLeads({ salespersonId });
  const [page, setPage] = useState(1);
  const pageTo = (nextPage) => {
    setPage(nextPage);
    load({ page: nextPage });
  };
  return (
    <section className="space-y-4">
      <SectionTitle title={salesperson ? `${salesperson.name} Cases` : "Salesperson Cases"} subtitle="Only cases linked to this salesperson." />
      <Table title="Salesperson Cases" headers={allCaseHeaders} rows={caseRows(leads)} loading={loading} page={page} total={total} hasMore={hasMore} onPage={pageTo} />
    </section>
  );
}

export function GmTrackingPanel({ mode = "total" }) {
  usePageLatency("GmDashboard", { mode });
  if (mode === "salespersons") return <SalespersonsScreen />;
  if (mode === "status") return <StatusScreen />;
  if (mode === "cases") return <AllCasesScreen />;
  if (mode === "salesperson-cases") return <SalespersonCasesScreen />;
  return <TotalLeadsScreen />;
}

export { GmLeadDetailPage } from './gm/GmLeadDetailPage.jsx';

