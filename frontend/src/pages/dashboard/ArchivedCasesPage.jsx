import { Download, Search } from "lucide-react";
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
  "Archived Date",
  "Archive Reason",
];

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
    formatPortalDateTime(lead.archivedAt),
    lead.archiveReason,
  ]);
  const csv = [HEADERS, ...data].map((row) => row.map(escapeCsv).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${audience}-archived-cases.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ArchivedCasesPage({ audience = "finance" }) {
  const endpoint = audience === "admin" ? "/admin/archived-leads" : "/dealer/archived-leads";
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
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
    const refreshOnArchive = (event) => {
      const type = event.detail?.eventType || event.detail?.event;
      if (type === "LEAD_ARCHIVED") load({ silent: true });
    };
    window.addEventListener("cls:realtime-event", refreshOnArchive);
    return () => window.removeEventListener("cls:realtime-event", refreshOnArchive);
  }, [load]);

  const tableRows = useMemo(() => rows.map((lead) => ({
    key: lead.id,
    cells: [
      value(lead.caseId || lead.id),
      value(lead.fullName || lead.customerName),
      value(lead.mobile),
      value(lead.vehicleNumber || lead.registrationNumber),
      value(lead.assignedExecutiveName || lead.assignedExecutiveEmail),
      portalLeadStatusLabel(lead),
      formatPortalDateTime(lead.archivedAt),
      value(lead.archiveReason),
    ],
  })), [rows]);

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
          {audience === "admin" ? "Super Admin" : "Finance Desk"}
        </p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Archived Cases</h1>
        <p className="mt-1 text-sm text-slate-500">Historical rejected and disbursed cases. These records are read-only.</p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md border border-slate-200 px-3 sm:max-w-xl">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search case ID, customer, mobile, vehicle, or executive"
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
        title="Archived Cases"
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
