import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { PendingDocumentsPanel } from "../../components/PendingDocumentsPanel.jsx";
import { LEAD_TABLE_LABELS } from "../../constants/leadTableLabels.js";
import { CURRENT_WORKFLOW_STATUS_OPTIONS, LEAD_STATUSES, normalizeStatus, statusLabel as standardStatusLabel } from "../../constants/status.js";
import { useDebouncedValue } from "../../hooks/useDebouncedValue.js";
import { mutationUrlMatches, useBackgroundRefresh, useLeadDetailRealtime, useRoleLeadRealtime } from "../../hooks/useRealtimeRefresh.js";
import { useRealtimeLeadDetailPatch, useRealtimeLeadPatch } from "../../hooks/useRealtimeEntityPatch.js";
import { useCursorPager } from "../../hooks/useCursorPager.js";
import { api, findCachedGetItem, getCachedGetData } from "../../services/api.js";
import { usePageLatency } from "../../services/frontendLatency.js";
import { bankDocumentRows, formatPortalDateTime, loanExecutiveRemark, portalLeadStatusLabel } from "../../utils/portalDisplay.js";

const pageSize = 10;
const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const leadMutationFilter = (detail) => mutationUrlMatches(detail, ["/bank/leads", "/dealer/leads", "/admin/leads", "/documents"]);
const bankAnalyticsMutationFilter = (detail) => mutationUrlMatches(detail, ["/bank/leads", "/dealer/leads", "/admin/leads", "/documents", "/banks", "/bank/executives"]);
const bankExecutiveMutationFilter = (detail) => mutationUrlMatches(detail, ["/bank/executives"]);

const customerDocumentTypes = [
  "Aadhaar",
  "PAN",
  "Salary Slip",
  "ITR",
  "Bank Statement",
  "Electricity Bill",
  "Rent Agreement",
  "Form 16",
];

function display(value) {
  return value || "-";
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanEmail(value) {
  return cleanText(value).toLowerCase();
}

function digits10(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 10);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(value));
}

function executiveDeleteId(executive = {}) {
  return executive.sourceId || executive.executiveId || executive.email || executive.officialEmail || executive.id;
}

function caseId(lead) {
  return lead.caseId || lead.id;
}

function moneyValue(value) {
  return `Rs. ${money.format(Number(value || 0))}`;
}

function numberValue(value) {
  return money.format(Number(value || 0));
}

function dateTime(value) {
  return formatPortalDateTime(value);
}

function generatedAt(lead) {
  return dateTime(lead.generatedAt || lead.createdAt);
}

function workflowStatus(value) {
  const normalized = normalizeStatus(value);
  if (normalized === LEAD_STATUSES.ASSIGNED) return LEAD_STATUSES.NEW;
  if ([LEAD_STATUSES.ACCEPTED, LEAD_STATUSES.UNDER_REVIEW, LEAD_STATUSES.APPROVED].includes(normalized)) return LEAD_STATUSES.UNDER_BANK_PROCESS;
  if (normalized === LEAD_STATUSES.DOCS_PENDING) return LEAD_STATUSES.REQUEST_PENDING_DOCUMENTS;
  return normalized;
}

function leadStatusLabel(lead) {
  return portalLeadStatusLabel(lead);
}

function responseRows(response) {
  return Array.isArray(response?.data?.data) ? response.data.data : Array.isArray(response?.data) ? response.data : [];
}

function Table({ title, headers, rows, loading, page, total, hasMore, onPage }) {
  return <OperationalTable title={title} headers={headers} rows={rows} loading={loading} page={page} total={total} hasMore={hasMore} onPage={onPage} pageSize={pageSize} />;
}

function MetricCard({ label, value, subtext }) {
  const loading = value === "-";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      {loading ? <div className="mt-3 h-8 w-24 animate-pulse rounded-md bg-slate-100" /> : <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>}
      {loading ? <div className="mt-3 h-3 w-36 animate-pulse rounded bg-slate-100" /> : subtext ? <p className="mt-1 text-xs font-medium text-slate-500">{subtext}</p> : null}
    </div>
  );
}

function sameValue(left, right) {
  const a = String(left || "").trim().toLowerCase();
  const b = String(right || "").trim().toLowerCase();
  return Boolean(a && b && a === b);
}

function normalizedBranch(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\b(branch|br|city|district)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function branchValue(record = {}) {
  return record.branchId || record.bankBranchLocation || record.branchCity || record.branchLocation || record.bankLocation || record.branch || record.city || "";
}

function branchMatch(lead = {}, executive = {}) {
  const leadIfsc = lead.assignedBankIfsc || lead.bankIfsc || lead.ifscCode || "";
  const executiveIfsc = executive.bankIfsc || executive.ifsc || executive.ifscCode || executive.branchIfsc || executive.assignedBankIfsc || "";
  if (leadIfsc && executiveIfsc) return sameValue(leadIfsc, executiveIfsc);
  const leadBranch = lead.branchId || lead.bankBranchId || lead.bankBranchCity || lead.branchCity || lead.branchLocation || lead.bankBranchLocation || lead.city || "";
  const executiveBranch = branchValue(executive);
  const leadNormalized = normalizedBranch(leadBranch);
  const executiveNormalized = normalizedBranch(executiveBranch);
  if (!leadNormalized || !executiveNormalized) return true;
  return leadNormalized === executiveNormalized
    || leadNormalized.includes(executiveNormalized)
    || executiveNormalized.includes(leadNormalized);
}

function executiveIdentity(executive = {}) {
  return [executive.id, executive.sourceId, executive.executiveId, executive.email, executive.officialEmail, executive.mobile]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
}

function currentExecutiveIdentity(lead = {}) {
  return [lead.assignedExecutiveId, lead.assignedExecutiveEmail, lead.assignedExecutiveMobile, lead.assignedExecutiveName]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
}

function reassignmentExecutiveId(executive = {}) {
  return executive.sourceId || executive.executiveId || executive.email || executive.officialEmail || executive.id;
}

function reassignmentDiagnostics(lead = {}, rows = []) {
  const currentIds = new Set(currentExecutiveIdentity(lead));
  const caseBranch = lead.branchId || lead.bankBranchId || lead.bankBranchCity || lead.branchCity || lead.branchLocation || lead.bankBranchLocation || lead.city || "";
  const caseIfsc = lead.assignedBankIfsc || lead.bankIfsc || lead.ifscCode || "";
  const diagnostics = rows.map((executive) => {
    const status = String(executive.status || "").trim().toLowerCase();
    const active = executive.active !== false && !["inactive", "deleted", "removed", "suspended", "disabled"].includes(status);
    const current = executiveIdentity(executive).some((key) => currentIds.has(key));
    const sameBranch = branchMatch(lead, executive);
    const reasons = [];
    if (!active) reasons.push("inactive/deleted/suspended");
    if (current) reasons.push("current owner");
    if (!sameBranch) reasons.push(`branch mismatch (${branchValue(executive) || "missing branch"} / ${executive.bankIfsc || executive.ifsc || executive.ifscCode || "missing IFSC"})`);
    return {
      name: executive.name || executive.fullName || executive.email || executive.officialEmail || executive.id,
      active,
      current,
      sameBranch,
      eligibleStrict: active && !current && sameBranch,
      eligibleFallback: active && !current,
      reason: reasons.join(", ") || "eligible",
    };
  });
  console.info("CASE_REASSIGNMENT_EXECUTIVE_FILTER", {
    caseId: caseId(lead),
    caseBranch,
    caseIfsc,
    currentExecutive: lead.assignedExecutiveName || lead.assignedExecutiveEmail || lead.assignedExecutiveId || "",
    foundExecutives: rows.length,
    filteredExecutives: diagnostics,
    eligibleStrict: diagnostics.filter((item) => item.eligibleStrict).map((item) => item.name),
    eligibleFallback: diagnostics.filter((item) => item.eligibleFallback).map((item) => item.name),
  });
  return diagnostics;
}

async function performLeadReassignment(lead, reason, newExecutiveId, onDone) {
  await api.patch(`/bank/leads/${lead.id}/reassign`, { reason, newExecutiveId });
  await onDone?.();
}

function ReassignLeadDialog({ lead, onCancel, onDone }) {
  const [reason, setReason] = useState("manager-reassignment");
  const [executives, setExecutives] = useState([]);
  const [selectedExecutiveId, setSelectedExecutiveId] = useState("");
  const [loadingExecutives, setLoadingExecutives] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setReason("manager-reassignment");
    setExecutives([]);
    setSelectedExecutiveId("");
    setError("");
    setBusy(false);
  }, [lead?.id]);

  useEffect(() => {
    if (!lead) return undefined;
    let cancelled = false;
    setLoadingExecutives(true);
    api.get("/bank/executives", { params: { limit: 100 } })
      .then((response) => {
        if (cancelled) return;
        const rows = responseRows(response);
        const diagnostics = reassignmentDiagnostics(lead, rows);
        const strictEligible = rows.filter((_executive, index) => diagnostics[index]?.eligibleStrict);
        const fallbackEligible = rows.filter((_executive, index) => diagnostics[index]?.eligibleFallback);
        const eligible = strictEligible.length ? strictEligible : fallbackEligible;
        setExecutives(eligible);
        setSelectedExecutiveId(reassignmentExecutiveId(eligible[0]) || "");
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.message || err.message || "Unable to load executives");
      })
      .finally(() => {
        if (!cancelled) setLoadingExecutives(false);
      });
    return () => { cancelled = true; };
  }, [lead]);

  if (!lead) return null;

  const submit = async (event) => {
    event.preventDefault();
    const cleanReason = cleanText(reason);
    if (!cleanReason) {
      setError("Reassignment reason is required.");
      return;
    }
    if (!selectedExecutiveId) {
      setError("Select a new executive.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await performLeadReassignment(lead, cleanReason, selectedExecutiveId, onDone);
      onCancel();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Unable to reassign lead");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6">
      <form onSubmit={submit} className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Reassign Case</h2>
            <p className="mt-1 text-sm text-slate-600">Move {caseId(lead)} to another same-branch executive.</p>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 disabled:opacity-60">Close</button>
        </div>
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <p><span className="font-semibold">Case ID:</span> {caseId(lead)}</p>
          <p className="mt-1"><span className="font-semibold">Customer:</span> {display(lead.fullName || lead.customerName)}</p>
          <p><span className="font-semibold">Current executive:</span> {display(lead.assignedExecutiveName || lead.assignedExecutiveEmail)}</p>
          {(lead.assignedExecutiveMobile || lead.executiveMobile) ? <p className="mt-1"><span className="font-semibold">Mobile:</span> {lead.assignedExecutiveMobile || lead.executiveMobile}</p> : null}
          <p className="mt-1"><span className="font-semibold">Status:</span> {leadStatusLabel(lead)}</p>
          <p className="mt-1"><span className="font-semibold">Branch:</span> {display(lead.bankBranchCity || lead.branchCity || lead.branchLocation || lead.bankBranchLocation || lead.assignedBankIfsc || lead.bankIfsc || lead.ifscCode)}</p>
        </div>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          Select New Executive
          <select
            value={selectedExecutiveId}
            disabled={loadingExecutives || busy}
            onChange={(event) => {
              setSelectedExecutiveId(event.target.value);
              setError("");
            }}
            className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-[#0d47a1] disabled:bg-slate-50 disabled:text-slate-400"
          >
            {loadingExecutives ? <option value="">Loading executives...</option> : null}
            {!loadingExecutives && !executives.length ? <option value="">No eligible executives found.</option> : null}
            {!loadingExecutives && executives.map((executive) => (
              <option key={reassignmentExecutiveId(executive)} value={reassignmentExecutiveId(executive)}>
                {executive.name || executive.fullName || executive.email || executive.officialEmail} {executive.mobile ? `- ${executive.mobile}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          Reason
          <textarea
            value={reason}
            onChange={(event) => {
              setReason(event.target.value.replace(/[<>]/g, ""));
              setError("");
            }}
            rows={3}
            className="mt-2 w-full resize-none rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#0d47a1]"
          />
        </label>
        {error ? <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60">Cancel</button>
          <button type="submit" disabled={busy || loadingExecutives || !selectedExecutiveId} className="rounded-md bg-[#0d47a1] px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? "Reassigning..." : "Reassign"}
          </button>
        </div>
      </form>
    </div>
  );
}

function DetailState({ title, message, requestId, onRetry, tone = "slate" }) {
  const tones = {
    slate: "border-slate-200 bg-white text-slate-600",
    red: "border-red-100 bg-red-50 text-red-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
  };
  return (
    <section className={`rounded-lg border p-5 text-sm ${tones[tone] || tones.slate}`}>
      <p className="font-semibold">{title}</p>
      <p className="mt-1">{message}</p>
      {requestId ? <p className="mt-2 text-xs opacity-80">Request ID: {requestId}</p> : null}
      {onRetry ? <button onClick={onRetry} className="mt-4 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700">Retry</button> : null}
    </section>
  );
}

function DetailSkeleton() {
  return (
    <section className="space-y-4">
      <div className="h-20 animate-pulse rounded-lg border border-slate-200 bg-white" />
      <div className="grid gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg border border-slate-200 bg-white" />)}
      </div>
      <div className="h-64 animate-pulse rounded-lg border border-slate-200 bg-white" />
    </section>
  );
}

function SearchBar({ value, onChange }) {
  return (
    <div className="relative rounded-lg border border-slate-200 bg-white p-3">
      <Search className="absolute left-6 top-5 h-4 w-4 text-slate-400" />
      <input className="h-9 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-[#0d47a1]" placeholder="Search records" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function useBankLeads(search, status = "", dealershipId = "") {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") || 1);
  const cached = getCachedGetData("/bank/leads", { page, limit: pageSize, search, status, dealershipId });
  const cachedRows = responseRows({ data: cached });
  const [rows, setRows] = useState(() => cachedRows);
  const [total, setTotal] = useState(() => cached?.total || cachedRows.length);
  const [hasMore, setHasMore] = useState(() => Boolean(cached?.hasMore || cached?.nextCursor));
  const [loading, setLoading] = useState(() => !cached);
  const { cursorParamsForPage, rememberNextCursor } = useCursorPager([search || "", status || "", dealershipId || ""]);

  const load = useCallback(async (nextPage = page, { silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const targetPage = Math.max(Number(nextPage || 1), 1);
      const response = await api.get("/bank/leads", { params: { page: targetPage, limit: pageSize, search, status, dealershipId, ...cursorParamsForPage(targetPage) } });
      const nextRows = responseRows(response);
      setRows(nextRows);
      setHasMore(Boolean(response.data?.hasMore || response.data?.nextCursor));
      rememberNextCursor(targetPage, response.data?.nextCursor);
      setTotal(Number.isFinite(Number(response.data?.total)) ? Number(response.data.total) : (targetPage - 1) * pageSize + nextRows.length + (response.data?.hasMore || response.data?.nextCursor ? 1 : 0));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, search, status, dealershipId, cursorParamsForPage, rememberNextCursor]);

  useEffect(() => { load(page, { silent: Boolean(cached) }); }, [load, page]);
  const realtimeRefresh = useCallback(() => load(page, { silent: true }), [load, page]);
  useRealtimeLeadPatch({ setRows, statusFilter: status });
  useRoleLeadRealtime({ onRefresh: realtimeRefresh, pageSize, mutationFilter: leadMutationFilter });
  const onPage = (nextPage) => setParams((current) => ({ ...Object.fromEntries(current.entries()), page: String(nextPage) }));
  return { rows, total, hasMore, loading, page, onPage, load };
}

function useBankDealerships() {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") || 1);
  const cached = getCachedGetData("/bank/dealerships", { page, limit: pageSize });
  const cachedRows = responseRows({ data: cached });
  const [rows, setRows] = useState(() => cachedRows);
  const [total, setTotal] = useState(() => cached?.total || cachedRows.length);
  const [hasMore, setHasMore] = useState(() => Boolean(cached?.hasMore || cached?.nextCursor));
  const [loading, setLoading] = useState(() => !cached);
  const { cursorParamsForPage, rememberNextCursor } = useCursorPager([]);

  const load = useCallback(async (nextPage = page, { silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const targetPage = Math.max(Number(nextPage || 1), 1);
      const response = await api.get("/bank/dealerships", { params: { page: targetPage, limit: pageSize, ...cursorParamsForPage(targetPage) } });
      const nextRows = responseRows(response);
      setRows(nextRows);
      setHasMore(Boolean(response.data?.hasMore || response.data?.nextCursor));
      rememberNextCursor(targetPage, response.data?.nextCursor);
      setTotal(Number.isFinite(Number(response.data?.total)) ? Number(response.data.total) : (targetPage - 1) * pageSize + nextRows.length + (response.data?.hasMore || response.data?.nextCursor ? 1 : 0));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, cursorParamsForPage, rememberNextCursor]);

  useEffect(() => { load(page, { silent: Boolean(cached) }); }, [load, page]);
  useRoleLeadRealtime({ onRefresh: () => load(page, { silent: true }), pageSize, mutationFilter: leadMutationFilter });
  const onPage = (nextPage) => setParams((current) => ({ ...Object.fromEntries(current.entries()), page: String(nextPage) }));
  return { rows, total, hasMore, loading, page, onPage };
}

function useBankDealershipDisbursedCases(dealershipId, search) {
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") || 1);
  const url = `/bank/dealerships/${encodeURIComponent(dealershipId)}/disbursed`;
  const cached = getCachedGetData(url, { page, limit: pageSize, search });
  const cachedRows = responseRows({ data: cached });
  const [rows, setRows] = useState(() => cachedRows);
  const [total, setTotal] = useState(() => cached?.total || cachedRows.length);
  const [hasMore, setHasMore] = useState(() => Boolean(cached?.hasMore || cached?.nextCursor));
  const [loading, setLoading] = useState(() => !cached);
  const { cursorParamsForPage, rememberNextCursor } = useCursorPager([dealershipId || "", search || ""]);

  const load = useCallback(async (nextPage = page, { silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const targetPage = Math.max(Number(nextPage || 1), 1);
      const response = await api.get(url, { params: { page: targetPage, limit: pageSize, search, ...cursorParamsForPage(targetPage) } });
      const nextRows = responseRows(response);
      setRows(nextRows);
      setHasMore(Boolean(response.data?.hasMore || response.data?.nextCursor));
      rememberNextCursor(targetPage, response.data?.nextCursor);
      setTotal(Number.isFinite(Number(response.data?.total)) ? Number(response.data.total) : (targetPage - 1) * pageSize + nextRows.length + (response.data?.hasMore || response.data?.nextCursor ? 1 : 0));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [page, search, url, cursorParamsForPage, rememberNextCursor]);

  useEffect(() => { load(page, { silent: Boolean(cached) }); }, [load, page]);
  useRoleLeadRealtime({ onRefresh: () => load(page, { silent: true }), pageSize, mutationFilter: leadMutationFilter });
  const onPage = (nextPage) => setParams((current) => ({ ...Object.fromEntries(current.entries()), page: String(nextPage) }));
  return { rows, total, hasMore, loading, page, onPage };
}

function useExecutives() {
  const cached = getCachedGetData("/bank/executives");
  const [rows, setRows] = useState(() => responseRows({ data: cached }));
  const [loading, setLoading] = useState(() => !cached);
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get("/bank/executives");
      setRows(responseRows(response));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);
  useEffect(() => { load({ silent: Boolean(cached) }); }, [load]);
  useBackgroundRefresh({ onRefresh: load, refreshKey: "bank-executives", mutationFilter: bankExecutiveMutationFilter });
  return { rows, loading, load };
}

function TotalLeadsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const dealershipId = params.get("dealershipId") || "";
  const { rows, total, hasMore, loading, page, onPage, load } = useBankLeads("", "", dealershipId);
  const [knownDealerships, setKnownDealerships] = useState([]);
  const [actionError, setActionError] = useState("");
  const [pendingReassign, setPendingReassign] = useState(null);
  useEffect(() => {
    setKnownDealerships((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      rows.forEach((lead) => {
        const id = String(lead.dealershipId || lead.dealershipEmail || lead.dealerEmail || "").trim();
        if (!id) return;
        byId.set(id, {
          id,
          name: lead.dealershipName || lead.dealerName || lead.dealerBusinessName || lead.dealershipEmail || lead.dealerEmail || id,
        });
      });
      return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
    });
  }, [rows]);
  const selectDealership = (value) => {
    const next = new URLSearchParams(params);
    if (value) next.set("dealershipId", value);
    else next.delete("dealershipId");
    next.set("page", "1");
    setParams(next);
  };
  const tableRows = useMemo(() => rows.map((lead) => ({
    key: lead.id,
    cells: [
      caseId(lead),
      display(lead.fullName || lead.customerName),
      display(lead.mobile),
      display(lead.city || lead.dealershipCity),
      moneyValue(lead.onRoadPrice || lead.carOnRoadPrice),
      moneyValue(lead.loanAmount || lead.requiredLoanAmount),
      generatedAt(lead),
      display(lead.financeManagerName || lead.assignedFinanceManager),
      display(lead.financeManagerMobile),
      display(lead.assignedExecutiveName),
      display(lead.assignedExecutiveMobile || lead.executiveMobile),
      leadStatusLabel(lead),
      <div key="actions" className="flex flex-wrap gap-2">
        <button onClick={() => navigate(`/bank-manager/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View</button>
        <button
          onClick={() => {
            setActionError("");
            setPendingReassign(lead);
          }}
          className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-[#0d47a1]"
        >
          {lead.assignedExecutiveId || lead.assignedExecutiveEmail ? "Reassign" : "Assign"}
        </button>
      </div>,
    ],
  })), [load, navigate, page, rows]);
  return (
    <section className="space-y-4">
      <PageTitle title="Total Leads" />
      <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:max-w-sm">
        <label htmlFor="bank-lead-dealership-filter" className="text-xs font-semibold uppercase text-slate-500">Dealership Filter</label>
        <select id="bank-lead-dealership-filter" value={dealershipId} onChange={(event) => selectDealership(event.target.value)} className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-[#0d47a1] focus:ring-2 focus:ring-blue-100">
          <option value="">All Dealerships</option>
          {knownDealerships.map((dealership) => <option key={dealership.id} value={dealership.id}>{dealership.name}</option>)}
        </select>
      </div>
      {actionError ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{actionError}</p> : null}
      <ReassignLeadDialog lead={pendingReassign} onCancel={() => setPendingReassign(null)} onDone={() => load(page, { silent: true })} />
      <Table title="Assigned Bank Leads" headers={["Case ID", "Customer Name", "Mobile Number", "Customer City", "Car On-Road Price", "Required Loan Amount", LEAD_TABLE_LABELS.generatedDate, "Finance Manager", "Finance Manager Mobile", LEAD_TABLE_LABELS.assignedExecutive, LEAD_TABLE_LABELS.executiveMobile, LEAD_TABLE_LABELS.currentStatus, "Actions"]} rows={tableRows} loading={loading} page={page} total={total} hasMore={hasMore} onPage={onPage} />
    </section>
  );
}

function StatusPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const requestedStatus = params.get("status") || CURRENT_WORKFLOW_STATUS_OPTIONS[0];
  const status = CURRENT_WORKFLOW_STATUS_OPTIONS.includes(normalizeStatus(requestedStatus))
    ? normalizeStatus(requestedStatus)
    : CURRENT_WORKFLOW_STATUS_OPTIONS[0];
  const [search, setSearch] = useState(params.get("search") || "");
  const debouncedSearch = useDebouncedValue(search, 180);
  const { rows, total, hasMore, loading, page, onPage } = useBankLeads(debouncedSearch, status);
  const choose = (nextStatus) => setParams({ status: nextStatus, page: "1", ...(search ? { search } : {}) });
  const tableRows = useMemo(() => rows.map((lead) => ({
    key: lead.id,
    cells: [
      caseId(lead),
      display(lead.fullName || lead.customerName),
      display(lead.mobile),
      display(lead.city || lead.dealershipCity),
      moneyValue(lead.loanAmount || lead.requiredLoanAmount),
      leadStatusLabel(lead),
      dateTime(lead.statusUpdatedAt || lead.updatedAt || lead.createdAt),
      ...(normalizeStatus(status) === LEAD_STATUSES.REJECTED ? [display(lead.rejectionReason || lead.loanRejectionReason)] : []),
      display(lead.assignedExecutiveName || lead.assignedExecutiveEmail),
      <button key="docs" onClick={() => navigate(`/bank-manager/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">Documents</button>,
    ],
  })), [navigate, rows, status]);
  const headers = normalizeStatus(status) === LEAD_STATUSES.REJECTED
    ? ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Loan Amount", LEAD_TABLE_LABELS.currentStatus, LEAD_TABLE_LABELS.lastUpdated, "Rejection Reason", LEAD_TABLE_LABELS.assignedExecutive, "Documents"]
    : ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Loan Amount", LEAD_TABLE_LABELS.currentStatus, LEAD_TABLE_LABELS.lastUpdated, LEAD_TABLE_LABELS.assignedExecutive, "Documents"];
  return (
    <section className="space-y-4">
      <PageTitle title="Status" />
      <SearchBar value={search} onChange={(value) => {
        setSearch(value);
        setParams({ status, page: "1", ...(value ? { search: value } : {}) });
      }} />
      <div className="flex flex-wrap gap-2">
        {CURRENT_WORKFLOW_STATUS_OPTIONS.map((value) => <button key={value} onClick={() => choose(value)} className={`rounded-md border px-3 py-2 text-sm font-medium ${status === value ? "border-[#0d47a1] bg-[#0d47a1] text-white" : "border-slate-200 bg-white text-slate-700"}`}>{standardStatusLabel(value)}</button>)}
      </div>
      <Table title="Status Cases" headers={headers} rows={tableRows} loading={loading} page={page} total={total} hasMore={hasMore} onPage={onPage} />
    </section>
  );
}

function AnalyticsPage() {
  const navigate = useNavigate();
  const cachedAnalytics = getCachedGetData("/bank/analytics");
  const [data, setData] = useState(() => cachedAnalytics);
  const [loading, setLoading] = useState(() => !cachedAnalytics);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async ({ silent = false, executiveCursor = null } = {}) => {
    if (!silent) setLoading(true);
    if (executiveCursor) setLoadingMore(true);
    setError("");
    try {
      const response = await api.get("/bank/analytics", {
        params: { executiveLimit: 100, ...(executiveCursor ? { executiveCursor } : {}) },
      });
      const payload = response.data || {};
      setData((current) => executiveCursor ? {
        ...payload,
        executivePerformance: [
          ...(current?.executivePerformance || []),
          ...(payload.executivePerformance || []),
        ],
      } : payload);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Unable to load bank analytics");
    } finally {
      if (!silent) setLoading(false);
      if (executiveCursor) setLoadingMore(false);
    }
  }, []);

  useEffect(() => { load({ silent: Boolean(cachedAnalytics) }); }, [load]);
  useRoleLeadRealtime({ onRefresh: () => load({ silent: true }), pageSize, mutationFilter: bankAnalyticsMutationFilter });
  const emptyLoading = loading && !data;

  const branchRows = useMemo(() => (data?.branchMetrics || []).map((item) => ({
    key: item.branch,
    cells: [
      display(item.branch),
      numberValue(item.assignedLeads),
      numberValue(item.activeLeads),
      numberValue(item.pendingDocuments),
      numberValue(item.approvedLeads),
      numberValue(item.rejectedLeads),
      numberValue(item.disbursedLeads),
    ],
  })), [data?.branchMetrics]);
  const executiveRows = useMemo(() => (data?.executivePerformance || []).map((item) => ({
    key: item.executiveId,
    cells: [
      display(item.executiveName),
      display(item.mobile),
      display(item.branch),
      numberValue(item.assignedLeads),
      numberValue(item.activeLeads),
      numberValue(item.pendingDocuments),
      numberValue(item.approvedLeads),
      numberValue(item.rejectedLeads),
      moneyValue(item.disbursedAmount || item.disbursedLeads || 0),
    ],
  })), [data?.executivePerformance]);
  const recentRows = useMemo(() => (data?.recentCases || []).map((lead) => ({
    key: lead.id,
    cells: [
      lead.caseId,
      display(lead.customerName),
      display(lead.executiveName),
      display(lead.branch),
      leadStatusLabel(lead),
      dateTime(lead.updatedAt),
      <button key="view" onClick={() => navigate(`/bank-manager/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View</button>,
    ],
  })), [data?.recentCases, navigate]);

  return (
    <section className="space-y-5">
      <PageTitle title="Analytics" />
      {error ? <DetailState title="Analytics unavailable" message={error} onRetry={() => load()} tone="red" /> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Assigned Leads" value={emptyLoading ? "-" : numberValue(data?.assignedLeads)} subtext={data?.branch || data?.bankName || "Current branch scope"} />
        <MetricCard label="Active Cases" value={emptyLoading ? "-" : numberValue(data?.pendingLeads)} subtext={`${numberValue(data?.pendingDocuments)} pending document cases`} />
        <MetricCard label="Disbursed Amount" value={emptyLoading ? "-" : moneyValue(data?.disbursedAmount)} subtext={`${numberValue(data?.disbursedLeads)} disbursed cases`} />
        <MetricCard label="Approved" value={emptyLoading ? "-" : numberValue(data?.approvedLeads)} subtext={`${numberValue(data?.conversionRate)}% conversion`} />
        <MetricCard label="Rejected" value={emptyLoading ? "-" : numberValue(data?.rejectedLeads)} subtext={`${numberValue(data?.rejectionRate)}% rejection`} />
        <MetricCard label="Branches" value={emptyLoading ? "-" : numberValue(data?.branches ?? data?.branchMetrics?.length)} subtext="Branch-level workload" />
        <MetricCard label="Executives" value={emptyLoading ? "-" : numberValue(data?.executives ?? data?.executivePerformance?.length)} subtext="Tracked assignment owners" />
      </div>
      <Table title="Branch Performance" headers={["Branch", "Assigned", "Active", "Pending Docs", "Approved", "Rejected", "Disbursed"]} rows={branchRows} loading={emptyLoading} />
      <Table title="Executive Performance" headers={["Executive", "Mobile", "Branch", "Assigned", "Active", "Pending Docs", "Approved", "Rejected", "Disbursed Amount"]} rows={executiveRows} loading={emptyLoading} />
      {data?.executivePagination?.hasMore ? (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => load({ silent: true, executiveCursor: data.executivePagination.nextCursor })}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingMore ? "Loading..." : "Load more executives"}
          </button>
        </div>
      ) : null}
      <Table title="Recent Case Activity" headers={["Case ID", "Customer", LEAD_TABLE_LABELS.assignedExecutive, "Branch", LEAD_TABLE_LABELS.currentStatus, "Updated", "Action"]} rows={recentRows} loading={emptyLoading} />
    </section>
  );
}

function ManageExecutivePage() {
  const navigate = useNavigate();
  const { rows, loading, load } = useExecutives();
  const [form, setForm] = useState({ name: "", mobile: "", email: "" });
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [credentials, setCredentials] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [activeLeadBlock, setActiveLeadBlock] = useState(null);
  const [toast, setToast] = useState({ message: "", type: "success" });

  const closeDeleteModal = useCallback(() => {
    setPendingDelete(null);
    setActiveLeadBlock(null);
  }, []);

  const openDeleteModal = useCallback((executive) => {
    setError("");
    setMessage("");
    setToast({ message: "", type: "success" });
    setActiveLeadBlock(null);
    setPendingDelete(executive);
  }, []);

  useEffect(() => {
    if (!toast.message) return undefined;
    const timer = window.setTimeout(() => setToast({ message: "", type: "success" }), 3500);
    return () => window.clearTimeout(timer);
  }, [toast.message]);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };
  const validate = (nextForm = form) => {
    const nextErrors = {};
    if (!cleanText(nextForm.name)) nextErrors.name = "Field required";
    if (!/^\d{10}$/.test(nextForm.mobile)) nextErrors.mobile = "Enter valid 10-digit mobile number";
    if (!validEmail(nextForm.email)) nextErrors.email = "Enter valid email address";
    return nextErrors;
  };

  const submit = async (event) => {
    event.preventDefault();
    setMessage("");
    setError("");
    const nextForm = { name: cleanText(form.name), mobile: digits10(form.mobile), email: cleanEmail(form.email) };
    const nextErrors = validate(nextForm);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setBusy(true);
    try {
      const response = await api.post("/bank/executives", nextForm);
      setForm({ name: "", mobile: "", email: "" });
      setMessage("Executive added successfully.");
      setCredentials({
        name: response.data?.name || response.data?.fullName || nextForm.name,
        email: response.data?.email || nextForm.email,
        temporaryPassword: response.data?.temporaryPassword || "",
        portalLogin: response.data?.portalLogin || `${window.location.origin}/executive/login`,
      });
      await load();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Unable to add executive");
    } finally {
      setBusy(false);
    }
  };

  const deleteExecutive = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    setError("");
    setMessage("");
    setActiveLeadBlock(null);
    try {
      await api.delete(`/bank/executives/${encodeURIComponent(executiveDeleteId(pendingDelete))}`);
      closeDeleteModal();
      setToast({ message: "Executive deleted successfully.", type: "success" });
      await load();
    } catch (err) {
      if (err.response?.data?.code === "ACTIVE_EXECUTIVE_LEADS") {
        setActiveLeadBlock({
          executive: pendingDelete,
          activeLeadCount: err.response.data.activeLeadCount || 0,
          transferUrl: err.response.data.transferUrl || `/bank-manager/executives/${encodeURIComponent(executiveDeleteId(pendingDelete))}/cases`,
        });
      } else {
        setToast({ message: err.response?.data?.message || "Unable to delete executive", type: "error" });
      }
    } finally {
      setBusy(false);
    }
  };

  const tableRows = useMemo(() => rows.map((executive) => ({
    key: executive.id,
    cells: [
      display(executive.name || executive.fullName),
      display(executive.mobile),
      display(executive.email || executive.officialEmail),
      display(executive.status),
      <div key="actions" className="flex flex-wrap gap-2">
        <button type="button" onClick={() => window.alert(`${executive.name || executive.fullName}\n${executive.email || executive.officialEmail}\n+91 ${executive.mobile || ""}`)} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700">View</button>
        <button type="button" onClick={() => openDeleteModal(executive)} className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700">Delete</button>
      </div>,
    ],
  })), [openDeleteModal, rows]);

  return (
    <section className="space-y-4">
      <PageTitle title="Manage Executive" />
      {toast.message ? (
        <div className={`fixed right-4 top-20 z-[60] rounded-lg border px-4 py-3 text-sm font-semibold shadow-lg ${toast.type === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {toast.message}
        </div>
      ) : null}
      {credentials ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Executive Created Successfully</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">{credentials.name}</h2>
              <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                <p><span className="font-semibold">Portal Login:</span> {credentials.portalLogin}</p>
                <p><span className="font-semibold">Email:</span> {credentials.email}</p>
                <p><span className="font-semibold">Temporary Password:</span> {credentials.temporaryPassword}</p>
              </div>
              <p className="mt-3 text-sm font-medium text-emerald-800">Please ask executive to change password after first login.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => navigator.clipboard?.writeText(`Portal Login: ${credentials.portalLogin}\nEmail: ${credentials.email}\nTemporary Password: ${credentials.temporaryPassword}`)} className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700">Copy Credentials</button>
              <button type="button" onClick={() => navigator.clipboard?.writeText(credentials.portalLogin)} className="rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700">Copy Portal URL</button>
              <button type="button" onClick={() => setCredentials(null)} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">Close</button>
            </div>
          </div>
        </div>
      ) : null}
      <DeleteExecutiveModal
        executive={pendingDelete}
        activeLeadBlock={activeLeadBlock}
        busy={busy}
        onCancel={closeDeleteModal}
        onConfirm={deleteExecutive}
        onTransfer={() => {
          if (activeLeadBlock?.transferUrl) navigate(activeLeadBlock.transferUrl);
        }}
      />
      <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Executive Name<input aria-invalid={Boolean(errors.name)} className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3 outline-none focus:border-[#0d47a1]" value={form.name} onBlur={() => setErrors(validate(form))} onChange={(event) => update("name", event.target.value.replace(/[<>]/g, ""))} /><span className={`validation-slot ${errors.name ? "" : "validation-slot-empty"}`}>{errors.name || "No validation issue"}</span></label>
          <label className="text-sm font-medium text-slate-700">
            Mobile Number
            <div className={`mt-2 flex h-10 overflow-hidden rounded-md border ${errors.mobile ? "border-red-300" : "border-slate-200"} focus-within:border-[#0d47a1]`}>
              <span className="inline-flex items-center border-r border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">+91</span>
              <input aria-invalid={Boolean(errors.mobile)} className="h-full w-full px-3 outline-none" value={form.mobile} maxLength={10} inputMode="numeric" onBlur={() => setErrors(validate(form))} onChange={(event) => update("mobile", digits10(event.target.value))} />
            </div>
            <span className={`validation-slot ${errors.mobile ? "" : "validation-slot-empty"}`}>{errors.mobile || "No validation issue"}</span>
          </label>
          <label className="text-sm font-medium text-slate-700 md:col-span-2">Official Email<input aria-invalid={Boolean(errors.email)} type="email" className="mt-2 h-10 w-full rounded-md border border-slate-200 px-3 outline-none focus:border-[#0d47a1]" value={form.email} onBlur={() => setErrors(validate(form))} onChange={(event) => update("email", event.target.value.trim().toLowerCase())} /><span className={`validation-slot ${errors.email ? "" : "validation-slot-empty"}`}>{errors.email || "No validation issue"}</span></label>
        </div>
        {message ? <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}
        <div className="form-action-row">
          <button disabled={busy} className="inline-flex h-10 min-w-32 items-center justify-center rounded-md bg-[#0d47a1] px-4 text-sm font-medium text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Add Executive"}
          </button>
        </div>
      </form>
      <Table title="Executive List" headers={["Executive Name", "Mobile Number", "Official Email", "Status", "Actions"]} rows={tableRows} loading={loading} />
    </section>
  );
}

function AllExecutivesPage() {
  const navigate = useNavigate();
  const { rows, loading } = useExecutives();
  const tableRows = useMemo(() => rows.map((executive) => ({
    key: executive.id,
    cells: [
      display(executive.name || executive.fullName),
      display(executive.mobile),
      display(executive.email || executive.officialEmail),
      executive.totalAssignedCases || 0,
      executive.currentActiveCases || 0,
      display(executive.status),
      <button key="cases" onClick={() => navigate(`/bank-manager/executives/${executive.id}/cases`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">All Cases</button>,
    ],
  })), [navigate, rows]);
  return (
    <section className="space-y-4">
      <PageTitle title="All Executives" />
      <Table title="Bank Executives" headers={["Executive Name", "Mobile Number", "Official Email", "Total Assigned Cases", "Current Active Cases", "Status", "All Cases"]} rows={tableRows} loading={loading} />
    </section>
  );
}

function ExecutiveCasesPage() {
  const { executiveId } = useParams();
  const navigate = useNavigate();
  const [payload, setPayload] = useState({ data: [], executive: null });
  const [loading, setLoading] = useState(true);
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.get(`/bank/executives/${executiveId}/cases`);
      setPayload({ data: responseRows(response), executive: response.data?.executive || null });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [executiveId]);
  useEffect(() => { load(); }, [load]);
  useBackgroundRefresh({ onRefresh: load, refreshKey: "bank-executive-cases", mutationFilter: leadMutationFilter });
  const rows = useMemo(() => payload.data.map((lead) => ({
    key: lead.id,
    cells: [
      caseId(lead),
      display(lead.fullName || lead.customerName),
      display(lead.mobile),
      display(lead.city || lead.dealershipCity),
      moneyValue(lead.loanAmount || lead.requiredLoanAmount),
      leadStatusLabel(lead),
      dateTime(lead.assignmentTimestamp || lead.createdAt),
      dateTime(lead.updatedAt || lead.statusUpdatedAt || lead.createdAt),
      <button key="docs" onClick={() => navigate(`/bank-manager/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">Documents</button>,
    ],
  })), [navigate, payload.data]);
  return (
    <section className="space-y-4">
      <PageTitle title={payload.executive ? `${payload.executive.name || payload.executive.fullName} Cases` : "Executive Cases"} />
      <Table title="Assigned Cases" headers={["Case ID", "Customer Name", "Customer Mobile", "Customer City", "Loan Amount", LEAD_TABLE_LABELS.currentStatus, "Assigned Date", LEAD_TABLE_LABELS.lastUpdated, "Documents"]} rows={rows} loading={loading} />
    </section>
  );
}

function BankDealershipsPage() {
  const navigate = useNavigate();
  const { rows, total, hasMore, loading, page, onPage } = useBankDealerships();
  const tableRows = useMemo(() => rows.map((dealership) => ({
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
  })), [navigate, rows]);
  return (
    <section className="space-y-4">
      <PageTitle title="All Dealerships" />
      <p className="text-sm text-slate-500">Dealerships actively sending business to this bank.</p>
      <Table title="Dealership Business Activity" headers={["Dealership", "Email", "City", "Mobile", "Total Cases", "Active Cases", "Total Disbursed Cases", "Last Activity"]} rows={tableRows} loading={loading} page={page} total={total} hasMore={hasMore} onPage={onPage} />
    </section>
  );
}

function BankDealershipDisbursedPage() {
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

function PageTitle({ title }) {
  return <div><p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Bank Manager</p><h1 className="mt-1 text-xl font-semibold text-slate-900">{title}</h1></div>;
}

function DeleteExecutiveModal({ executive, activeLeadBlock, busy, onCancel, onConfirm, onTransfer }) {
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

export function BankBranchManagerPanel({ mode = "leads" }) {
  usePageLatency("BankManager", { mode });
  if (mode === "analytics") return <AnalyticsPage />;
  if (mode === "status") return <StatusPage />;
  if (mode === "manage-executive") return <ManageExecutivePage />;
  if (mode === "executives") return <AllExecutivesPage />;
  if (mode === "executive-cases") return <ExecutiveCasesPage />;
  if (mode === "dealerships") return <BankDealershipsPage />;
  if (mode === "dealership-disbursed") return <BankDealershipDisbursedPage />;
  return <TotalLeadsPage />;
}

export function BankManagerLeadDetailPage() {
  const { leadId } = useParams();
  const cachedLead = getCachedGetData(`/bank/leads/${leadId}`)
    || findCachedGetItem("/bank/leads", (item) => item.id === leadId || item.caseId === leadId)
    || findCachedGetItem("/bank/analytics", (item) => item.id === leadId || item.caseId === leadId);
  const [lead, setLead] = useState(() => cachedLead);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState("");
  const [pendingReassign, setPendingReassign] = useState(null);
  const [loading, setLoading] = useState(() => !cachedLead);

  const loadLead = useCallback(async ({ silent = false } = {}) => {
    setError(null);
    if (!silent) setLoading(true);
    try {
      const response = await api.get(`/bank/leads/${leadId}`);
      setLead(response.data);
    } catch (err) {
      setLead((current) => current || null);
      setError({
        status: err.response?.status || 0,
        message: err.response?.data?.message || err.message || "Unable to load this lead.",
        requestId: err.response?.data?.requestId || err.response?.headers?.["x-request-id"] || "",
      });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { loadLead(); }, [loadLead]);
  useRealtimeLeadDetailPatch({ leadId, setLead });
  useLeadDetailRealtime({ lead, leadId, onRefresh: loadLead, mutationFilter: leadMutationFilter });

  if (loading && !lead) return <DetailSkeleton />;
  if (!lead) {
    if (error?.status === 403) return <DetailState title="Access denied" message="This lead is outside your authorized bank or branch scope." requestId={error.requestId} onRetry={() => loadLead()} tone="amber" />;
    if (error?.status === 404) return <DetailState title="Lead not found" message="This lead may have been removed or the link is no longer valid." requestId={error.requestId} onRetry={() => loadLead()} />;
    return <DetailState title="Documents could not be loaded" message={error?.message || "Unexpected server error while loading this lead."} requestId={error?.requestId} onRetry={() => loadLead()} tone="red" />;
  }

  const documents = [...(lead.documents || [])];
  const bankDocs = bankDocumentRows(lead);
  const rows = customerDocumentTypes.map((type) => {
    const doc = documents.find((item) => String(item.type || item.documentType || "").toLowerCase() === type.toLowerCase());
    const url = doc?.url || doc?.fileUrl || doc?.downloadUrl;
    return {
      key: type,
      cells: [
        type,
        url ? <a key="preview" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Preview</a> : "Not uploaded",
        dateTime(doc?.createdAt || doc?.uploadedAt),
        url ? <a key="download" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Download</a> : "-",
      ],
    };
  });

  return (
    <section className="space-y-4">
      <PageTitle title="Customer Documents" />
      {actionError ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{actionError}</p> : null}
      <ReassignLeadDialog lead={pendingReassign} onCancel={() => setPendingReassign(null)} onDone={() => loadLead({ silent: true })} />
      <div className="grid gap-3 md:grid-cols-4">
        {[["Case ID", caseId(lead)], ["Customer", lead.fullName || lead.customerName], ["Mobile", lead.mobile], ["Finance Manager", lead.financeManagerName || lead.assignedFinanceManager], ["Finance Manager Mobile", lead.financeManagerMobile], [LEAD_TABLE_LABELS.assignedExecutive, lead.assignedExecutiveName || lead.assignedExecutiveEmail], [LEAD_TABLE_LABELS.executiveMobile, lead.assignedExecutiveMobile || lead.executiveMobile], [LEAD_TABLE_LABELS.currentStatus, leadStatusLabel(lead)]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-1 font-medium text-slate-900">{display(value)}</p></div>)}
      </div>
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">Loan Executive Remark</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{loanExecutiveRemark(lead)}</p>
      </section>
      <PendingDocumentsPanel lead={lead} />
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900">Case Assignment</p>
            <p className="mt-1 text-sm text-slate-500">Current executive: {display(lead.assignedExecutiveName || lead.assignedExecutiveEmail)}{lead.assignedExecutiveMobile || lead.executiveMobile ? ` - ${lead.assignedExecutiveMobile || lead.executiveMobile}` : ""}</p>
          </div>
          <button
            onClick={() => {
              setActionError("");
              setPendingReassign(lead);
            }}
            className="w-full rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-[#0d47a1] sm:w-auto"
          >
            {lead.assignedExecutiveId || lead.assignedExecutiveEmail ? "Reassign to Next Executive" : "Assign to Executive"}
          </button>
        </div>
      </div>
      <Table title="Customer Uploaded Documents" headers={["Document", "Preview", "Uploaded Timestamp", "Download"]} rows={rows} loading={false} />
      <Table title="Bank Uploaded Documents" headers={["Document", "Preview", "Uploaded Timestamp", "Download"]} rows={bankDocs.map((document) => {
        const url = document?.url || document?.fileUrl || document?.downloadUrl;
        return {
          key: document.id || document.documentType || document.type,
          cells: [
            display(document.documentType || document.type),
            url ? <a key="preview" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Preview</a> : "Stored in application",
            dateTime(document?.createdAt || document?.uploadedAt),
            url ? <a key="download" href={url} target="_blank" rel="noreferrer" className="text-[#0d47a1]">Download</a> : "-",
          ],
        };
      })} loading={false} />
    </section>
  );
}
