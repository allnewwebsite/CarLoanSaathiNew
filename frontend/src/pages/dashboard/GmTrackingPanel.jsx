import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, Search } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { DetailPageSkeleton } from "../../components/ui/Loading.jsx";
import { BANK_STATUS_OPTIONS, LEAD_STATUSES, normalizeStatus, statusLabel as standardStatusLabel } from "../../constants/status.js";
import { useBackgroundRefresh, useLeadDetailRealtime, useRoleLeadRealtime } from "../../hooks/useRealtimeRefresh.js";
import { useCursorPager } from "../../hooks/useCursorPager.js";
import { api, findCachedGetItem, getCachedGetData } from "../../services/api.js";
import { formatPortalDate, formatPortalDateTime, formatPortalTime, loanExecutiveRemark } from "../../utils/portalDisplay.js";

const pageSize = 10;
const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const docs = ["Aadhaar", "PAN", "Salary Slip", "ITR", "Bank Statement", "Electricity Bill", "Rent Agreement", "Form 16"];
const statusCards = BANK_STATUS_OPTIONS.map((value) => ({ label: standardStatusLabel(value), value }));

function display(value) {
  return value || "-";
}

function caseId(lead) {
  return lead.caseId || lead.id;
}

function moneyValue(value) {
  return `Rs. ${money.format(Number(value || 0))}`;
}

function dateValue(value) {
  return formatPortalDate(value);
}

function timeValue(value) {
  return formatPortalTime(value);
}

function workflowStatus(value) {
  const normalized = normalizeStatus(value);
  if (normalized === LEAD_STATUSES.ASSIGNED) return LEAD_STATUSES.NEW;
  if ([LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW, LEAD_STATUSES.APPROVED].includes(normalized)) return LEAD_STATUSES.UNDER_BANK_PROCESS;
  if (normalized === LEAD_STATUSES.DOCS_PENDING) return LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS;
  return normalized;
}

function statusLabel(lead) {
  const status = workflowStatus(lead.status || lead.assignmentStatus || LEAD_STATUSES.NEW);
  if (status === LEAD_STATUSES.REJECTED) return lead.rejectionReason || lead.loanRejectionReason ? "Rejected With Reason" : "Rejected";
  return standardStatusLabel(status);
}

function Table({ title, headers, rows, loading, page, total, hasMore, onPage }) {
  return <OperationalTable title={title} headers={headers} rows={rows} loading={loading} page={page} total={total} hasMore={hasMore} onPage={onPage} pageSize={pageSize} />;
}

function SectionTitle({ title, subtitle }) {
  return <div><p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">GM / SM Head</p><h1 className="mt-1 text-xl font-semibold text-slate-900">{title}</h1>{subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}</div>;
}

function DocumentsButton({ lead }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(`/gm/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View Documents</button>;
}

function useGmLeads(filters = {}) {
  const initialParams = { page: 1, limit: pageSize, ...filters };
  const cached = getCachedGetData("/gm/leads", initialParams);
  const [leads, setLeads] = useState(() => cached?.data || []);
  const [total, setTotal] = useState(() => cached?.total || 0);
  const [hasMore, setHasMore] = useState(() => Boolean(cached?.hasMore || cached?.nextCursor));
  const [loading, setLoading] = useState(() => !cached);
  const { cursorParamsForPage, rememberNextCursor } = useCursorPager([filters.search || "", filters.status || "", filters.salespersonId || ""]);
  const load = useCallback(async (next = {}) => {
    const silent = next.silent === true;
    if (!silent) setLoading(true);
    try {
      const { silent: _silent, ...params } = next;
      const targetPage = Math.max(Number(params.page || 1), 1);
      const response = await api.get("/gm/leads", { params: { page: targetPage, limit: pageSize, ...filters, ...params, ...cursorParamsForPage(targetPage) } });
      const rows = response.data?.data || [];
      setLeads(rows);
      setHasMore(Boolean(response.data?.hasMore || response.data?.nextCursor));
      rememberNextCursor(targetPage, response.data?.nextCursor);
      setTotal(Number.isFinite(Number(response.data?.total)) ? Number(response.data.total) : (targetPage - 1) * pageSize + rows.length + (response.data?.hasMore || response.data?.nextCursor ? 1 : 0));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filters.search, filters.status, filters.salespersonId, cursorParamsForPage, rememberNextCursor]);
  useEffect(() => {
    load();
  }, [load]);
  useRoleLeadRealtime({ onRefresh: load, pageSize });
  return { leads, total, hasMore, loading, load };
}

function useSalespersons() {
  const cachedSalespersons = getCachedGetData("/gm/salespersons");
  const [salespersons, setSalespersons] = useState(() => cachedSalespersons || []);
  const [loading, setLoading] = useState(() => !cachedSalespersons);
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get("/gm/salespersons");
      setSalespersons(response.data || []);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useBackgroundRefresh({ onRefresh: load });
  return { salespersons, loading };
}

function totalRows(leads) {
  return leads.map((lead) => ({
    key: lead.id,
    cells: [
      caseId(lead),
      display(lead.fullName || lead.customerName),
      display(lead.mobile),
      display(lead.city || lead.dealershipCity),
      moneyValue(lead.carPrice || lead.carOnRoadPrice || lead.onRoadPrice),
      moneyValue(lead.loanAmount || lead.requiredLoanAmount),
      display(lead.assignedSalesperson || lead.salespersonName),
      statusLabel(lead),
      dateValue(lead.generatedAt || lead.createdAt),
      <DocumentsButton key="docs" lead={lead} />,
    ],
  }));
}

function caseRows(leads) {
  return leads.map((lead) => ({
    key: lead.id,
    cells: [
      caseId(lead),
      display(lead.fullName || lead.customerName),
      display(lead.mobile),
      display(lead.city || lead.dealershipCity),
      moneyValue(lead.carPrice || lead.carOnRoadPrice || lead.onRoadPrice),
      moneyValue(lead.loanAmount || lead.requiredLoanAmount),
      display(lead.assignedSalesperson || lead.salespersonName),
      display(lead.bankPartner || lead.assignedBankName),
      display(lead.assignedExecutiveName),
      statusLabel(lead),
      dateValue(lead.generatedAt || lead.createdAt),
      <DocumentsButton key="docs" lead={lead} />,
    ],
  }));
}

function statusRows(leads, rejected) {
  return leads.map((lead) => {
    const cells = [
      caseId(lead),
      display(lead.fullName || lead.customerName),
      display(lead.assignedSalesperson || lead.salespersonName),
      moneyValue(lead.loanAmount || lead.requiredLoanAmount),
      statusLabel(lead),
    ];
    if (rejected) cells.push(display(lead.rejectionReason || lead.loanRejectionReason));
    cells.push(dateValue(lead.statusUpdatedAt || lead.updatedAt || lead.createdAt));
    cells.push(timeValue(lead.statusUpdatedAt || lead.updatedAt || lead.createdAt));
    cells.push(<DocumentsButton key="docs" lead={lead} />);
    return { key: lead.id, cells };
  });
}

function TotalLeadsScreen() {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(Number(params.get("page") || 1));
  const search = params.get("search") || "";
  const { leads, total, hasMore, loading, load } = useGmLeads({ search });
  const updateSearch = (value) => {
    setPage(1);
    setParams(value ? { search: value, page: "1" } : { page: "1" });
    load({ search: value, page: 1 });
  };
  const pageTo = (nextPage) => {
    setPage(nextPage);
    load({ page: nextPage });
  };
  return (
    <section className="space-y-4">
      <SectionTitle title="Total Leads" subtitle="All leads created by this dealership." />
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-3"><Search className="h-4 w-4 text-slate-400" /><input className="h-9 flex-1 outline-none" placeholder="Search Case ID, customer, mobile" defaultValue={search} onChange={(event) => updateSearch(event.target.value)} /></div>
      <Table title="Total Leads" headers={["Case ID", "Customer Name", "Mobile Number", "Customer City", "Car On-Road Price", "Required Loan Amount", "Assigned Salesperson", "Current Status", "Generated Date", "Documents"]} rows={totalRows(leads)} loading={loading} page={page} total={total} hasMore={hasMore} onPage={pageTo} />
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
      <button key="view" onClick={() => navigate(`/gm/salespersons/${person.id}/cases`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View Cases</button>,
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
  const status = params.get("status") || LEAD_STATUSES.NEW;
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
      <Table title="Status Cases" headers={rejected ? ["Case ID", "Customer Name", "Assigned Salesperson", "Loan Amount", "Current Status", "Rejection Reason", "Last Updated Date", "Last Updated Time", "Documents"] : ["Case ID", "Customer Name", "Assigned Salesperson", "Loan Amount", "Current Status", "Last Updated Date", "Last Updated Time", "Documents"]} rows={statusRows(leads, rejected)} loading={loading} page={page} total={total} hasMore={hasMore} onPage={pageTo} />
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
          {salespersons.map((person) => <option key={person.id} value={person.id}>{person.name} - {person.jobId}</option>)}
        </select>
      </div>
      <Table title="All Cases" headers={["Case ID", "Customer Name", "Mobile Number", "Customer City", "Car On-Road Price", "Required Loan Amount", "Assigned Salesperson", "Assigned Bank", "Assigned Executive", "Current Status", "Generated Date", "Documents"]} rows={caseRows(leads)} loading={loading} page={page} total={total} hasMore={hasMore} onPage={pageTo} />
    </section>
  );
}

function SalespersonCasesScreen() {
  const { salespersonId } = useParams();
  const { salespersons } = useSalespersons();
  const salesperson = salespersons.find((person) => person.id === salespersonId);
  const { leads, total, hasMore, loading, load } = useGmLeads({ salespersonId });
  const [page, setPage] = useState(1);
  const pageTo = (nextPage) => {
    setPage(nextPage);
    load({ page: nextPage });
  };
  return (
    <section className="space-y-4">
      <SectionTitle title={salesperson ? `${salesperson.name} Cases` : "Salesperson Cases"} subtitle="Only cases linked to this salesperson." />
      <Table title="Salesperson Cases" headers={["Case ID", "Customer Name", "Mobile Number", "Customer City", "Car On-Road Price", "Required Loan Amount", "Assigned Salesperson", "Assigned Bank", "Assigned Executive", "Current Status", "Generated Date", "Documents"]} rows={caseRows(leads)} loading={loading} page={page} total={total} hasMore={hasMore} onPage={pageTo} />
    </section>
  );
}

export function GmTrackingPanel({ mode = "total" }) {
  if (mode === "salespersons") return <SalespersonsScreen />;
  if (mode === "status") return <StatusScreen />;
  if (mode === "cases") return <AllCasesScreen />;
  if (mode === "salesperson-cases") return <SalespersonCasesScreen />;
  return <TotalLeadsScreen />;
}

export function GmLeadDetailPage() {
  const { leadId } = useParams();
  const cachedLead = getCachedGetData(`/gm/leads/${leadId}`)
    || findCachedGetItem("/gm/leads", (item) => item.id === leadId || item.caseId === leadId);
  const [lead, setLead] = useState(() => cachedLead);
  const [loading, setLoading] = useState(() => !cachedLead);

  const loadLead = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get(`/gm/leads/${leadId}`);
      setLead(response.data);
    } catch {
      setLead((current) => current || null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    loadLead();
  }, [loadLead]);
  useLeadDetailRealtime({ lead, leadId, onRefresh: loadLead });

  if (loading && !lead) return <DetailPageSkeleton />;
  if (!lead) return <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Lead not found.</section>;

  return (
    <section className="space-y-4">
      <SectionTitle title="Customer Documents" subtitle={`Case ID: ${caseId(lead)}`} />
      <div className="grid gap-3 md:grid-cols-4">
        {[["Customer", lead.fullName || lead.customerName], ["Mobile", lead.mobile], ["Salesperson", lead.assignedSalesperson || lead.salespersonName], ["Current Status", statusLabel(lead)]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-1 font-medium text-slate-900">{display(value)}</p></div>)}
      </div>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">Loan Executive Remark</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{loanExecutiveRemark(lead)}</p>
      </section>
      <Table title="Customer Uploaded Documents" headers={["Document", "Preview", "Uploaded Timestamp", "Download"]} rows={docs.map((type) => {
        const document = (lead.documents || []).find((item) => String(item.type || item.documentType || "").toLowerCase() === type.toLowerCase());
        const url = document?.url || document?.fileUrl || document?.downloadUrl;
        return { key: type, cells: [type, url ? <a key="preview" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Preview</a> : "Not uploaded", formatPortalDateTime(document?.createdAt || document?.uploadedAt), url ? <a key="download" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Download</a> : "-"] };
      })} loading={false} />
    </section>
  );
}
