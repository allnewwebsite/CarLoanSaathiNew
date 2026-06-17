import { Download, RotateCcw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { useCursorPager } from "../../hooks/useCursorPager.js";
import { api } from "../../services/api.js";
import { formatPortalDateTime, portalLeadStatusLabel } from "../../utils/portalDisplay.js";

const PAGE_SIZE = 20;
const HEADERS = [
  "Case ID",
  "Customer Name",
  "Mobile Number",
  "Vehicle Number",
  "Executive Name",
  "Status",
  "Dead Date",
  "Dead Reason",
  "Actions",
];
const CSV_HEADERS = HEADERS.filter((header) => header !== "Actions");

function value(input) {
  return String(input || "").trim() || "-";
}

function escapeCsv(input) {
  const text = String(input ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(rows, audience) {
  const data = rows.map((lead) => [
    lead.caseId || lead.id,
    lead.fullName || lead.customerName,
    lead.mobile,
    lead.vehicleNumber || lead.registrationNumber,
    lead.assignedExecutiveName || lead.assignedExecutiveEmail,
    portalLeadStatusLabel(lead),
    formatPortalDateTime(lead.deadCaseDate),
    lead.deadCaseReason,
  ]);
  const csv = [CSV_HEADERS, ...data].map((row) => row.map(escapeCsv).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${audience}-dead-cases.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function DeadCasesPage({ audience = "finance" }) {
  const endpoint = audience === "admin" ? "/admin/dead-cases" : "/dealer/dead-cases";
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const { cursorParamsForPage, rememberNextCursor } = useCursorPager([endpoint, debouncedSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const cursor = cursorParamsForPage(page);
      const response = await api.get(endpoint, {
        params: {
          page,
          limit: PAGE_SIZE,
          search: debouncedSearch || undefined,
          ...cursor,
        },
      });
      const payload = Array.isArray(response.data) ? { data: response.data } : response.data || {};
      setRows(payload.data || []);
      setHasMore(Boolean(payload.hasMore || payload.nextCursor));
      rememberNextCursor(page, payload.nextCursor);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [cursorParamsForPage, debouncedSearch, endpoint, page, rememberNextCursor]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const refreshOnDeadCase = (event) => {
      const type = event.detail?.eventType || event.detail?.event;
      if (["LEAD_MARKED_DEAD", "LEAD_RESTORED_FROM_DEAD", "DEAD_CASE_UPDATED"].includes(type)) load({ silent: true });
    };
    window.addEventListener("cls:realtime-event", refreshOnDeadCase);
    return () => window.removeEventListener("cls:realtime-event", refreshOnDeadCase);
  }, [load]);

  const restoreCase = useCallback(async (lead) => {
    if (audience !== "finance" || !lead?.id) return;
    setActionId(lead.id);
    try {
      await api.post(`/dealer/dead-cases/${lead.id}/restore`);
      setRows((current) => current.filter((item) => item.id !== lead.id));
    } finally {
      setActionId("");
      load({ silent: true });
    }
  }, [audience, load]);

  const tableRows = useMemo(() => rows.map((lead) => ({
    key: lead.id,
    cells: [
      value(lead.caseId || lead.id),
      value(lead.fullName || lead.customerName),
      value(lead.mobile),
      value(lead.vehicleNumber || lead.registrationNumber),
      value(lead.assignedExecutiveName || lead.assignedExecutiveEmail),
      portalLeadStatusLabel(lead),
      formatPortalDateTime(lead.deadCaseDate),
      value(lead.deadCaseReason),
      audience === "finance" ? (
        <button
          type="button"
          onClick={() => restoreCase(lead)}
          disabled={actionId === lead.id}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2 text-xs font-medium text-slate-700 disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Restore
        </button>
      ) : "Read only",
    ],
  })), [actionId, audience, restoreCase, rows]);

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          {audience === "admin" ? "Super Admin" : "Finance Desk"}
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Dead Cases</h1>
        <p className="mt-1 text-sm text-slate-500">Cases manually moved out of active workflow by Finance Desk.</p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 px-3 sm:max-w-xl">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search case ID, customer, mobile, reason, or executive"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() => downloadCsv(rows, audience)}
          disabled={!rows.length}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-slate-200 px-4 text-sm font-medium text-slate-700 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      <OperationalTable
        title="Dead Cases"
        headers={HEADERS}
        rows={tableRows}
        loading={loading}
        page={page}
        total={null}
        hasMore={hasMore}
        onPage={setPage}
        pageSize={PAGE_SIZE}
      />
    </section>
  );
}
