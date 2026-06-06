import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, FileText, Search, Send, ShieldAlert } from "lucide-react";
import { useTimelineRealtime } from "../hooks/useRealtimeRefresh.js";
import { api } from "../services/api.js";

const iconByType = {
  "lead-created": Clock3,
  "document-uploaded": FileText,
  "document-replaced": FileText,
  "lead-sent-to-bank": Send,
  "branch-assigned": Send,
  "executive-assigned": Send,
  "sla-started": Clock3,
  "executive-accepted": CheckCircle2,
  approval: CheckCircle2,
  rejection: ShieldAlert,
  "sla-missed": ShieldAlert,
  "escalation-triggered": ShieldAlert,
};

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function eventTone(type) {
  if (["approval", "executive-accepted", "disbursement-marked"].includes(type)) return "bg-emerald-50 text-emerald-700 border-emerald-100";
  if (["rejection", "sla-missed", "escalation-triggered"].includes(type)) return "bg-red-50 text-red-700 border-red-100";
  return "bg-blue-50 text-[#0d47a1] border-blue-100";
}

export function LeadTimeline({ leadId, compact = false }) {
  const [events, setEvents] = useState([]);
  const [filters, setFilters] = useState({ search: "", date: "", eventType: "", page: 1 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const limit = compact ? 8 : 20;

  const totalPages = useMemo(() => Math.max(Math.ceil(total / limit), 1), [total, limit]);

  const load = async (nextFilters = filters) => {
    if (!leadId) return;
    const silent = nextFilters?.silent === true;
    if (!silent) setLoading(true);
    try {
      const { silent: _silent, ...params } = nextFilters;
      const response = await api.get(`/timeline/leads/${leadId}`, { params: { ...params, limit } });
      const payload = response.data;
      setEvents(Array.isArray(payload) ? payload : payload.data || []);
      setTotal(Array.isArray(payload) ? payload.length : payload.total || 0);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);
  useTimelineRealtime({ leadId, onRefresh: () => load({ ...filters, silent: true }) });

  const updateFilter = (field, value) => {
    const next = { ...filters, [field]: value, page: field === "page" ? value : 1 };
    setFilters(next);
    load(next);
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="font-semibold text-slate-900">Activity Timeline</h4>
          <p className="mt-1 text-xs text-slate-500">Immutable case history from creation to disbursement.</p>
        </div>
        {!compact && (
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#536173]" />
              <input className="field h-10 pl-9 text-sm" placeholder="Search timeline" value={filters.search} onChange={(e) => updateFilter("search", e.target.value)} />
            </label>
            <select className="field h-10 text-sm" value={filters.date} onChange={(e) => updateFilter("date", e.target.value)}>
              <option value="">All dates</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="last7">Last 7 Days</option>
            </select>
            <select className="field h-10 text-sm" value={filters.eventType} onChange={(e) => updateFilter("eventType", e.target.value)}>
              <option value="">All events</option>
              <option value="lead-created">Lead created</option>
              <option value="document-uploaded">Documents</option>
              <option value="lead-sent-to-bank">Bank routing</option>
              <option value="executive-assigned">Executive assigned</option>
              <option value="approval">Approval</option>
              <option value="rejection">Rejection</option>
              <option value="sla-missed">SLA missed</option>
            </select>
          </div>
        )}
      </div>

      <div className="mt-5 space-y-0">
        {loading && !events.length && Array.from({ length: compact ? 3 : 5 }).map((_, index) => (
          <div key={index} className="relative grid grid-cols-[2rem_1fr] gap-3 pb-5" aria-hidden="true">
            {index !== (compact ? 2 : 4) && <span className="absolute left-4 top-8 h-full w-px bg-slate-200" />}
            <span className="relative z-10 h-8 w-8 animate-pulse rounded-full bg-slate-200" />
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="h-4 w-1/3 animate-pulse rounded bg-slate-200" />
              <div className="mt-3 h-3 w-5/6 animate-pulse rounded bg-slate-200/80" />
              <div className="mt-4 h-3 w-1/2 animate-pulse rounded bg-slate-200/70" />
            </div>
          </div>
        ))}
        {!loading && !events.length && <p className="py-6 text-center text-sm text-slate-500">No timeline events yet.</p>}
        {events.map((event, index) => {
          const Icon = iconByType[event.eventType] || Clock3;
          return (
            <div key={event.id} className="relative grid grid-cols-[2rem_1fr] gap-3 pb-5">
              {index !== events.length - 1 && <span className="absolute left-4 top-8 h-full w-px bg-slate-200" />}
              <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border ${eventTone(event.eventType)}`}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                    {event.caseId && <p className="mt-1 text-xs font-semibold text-[#0d47a1]">{event.caseId}</p>}
                    <p className="mt-1 text-sm leading-6 text-slate-600">{event.description}</p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${eventTone(event.eventType)}`}>
                    {event.eventType || "event"}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{formatDate(event.createdAt)}</span>
                  <span>by {event.actorName || event.actorId || "System"}</span>
                  {event.actorRole && <span className="rounded-full bg-white px-2 py-0.5 font-medium text-[#0d47a1]">{event.actorRole}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!compact && totalPages > 1 && (
        <div className="mt-2 flex items-center justify-end gap-3">
          <button disabled={filters.page <= 1} onClick={() => updateFilter("page", filters.page - 1)} className="rounded-md border border-[#dbe7f6] px-3 py-2 text-sm disabled:opacity-50">Prev</button>
          <span className="text-sm text-[#536173]">Page {filters.page} of {totalPages}</span>
          <button disabled={filters.page >= totalPages} onClick={() => updateFilter("page", filters.page + 1)} className="rounded-md border border-[#dbe7f6] px-3 py-2 text-sm disabled:opacity-50">Next</button>
        </div>
      )}
    </section>
  );
}
