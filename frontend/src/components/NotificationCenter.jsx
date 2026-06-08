import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { api, getCachedGetData } from "../services/api.js";

const NOTIFICATION_REFRESH_COOLDOWN_MS = 10000;
const NOTIFICATION_REFRESH_DEBOUNCE_MS = 700;

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function priorityClass(priority) {
  if (priority === "high") return "bg-red-50 text-red-700 border-red-100";
  return "bg-blue-50 text-[#0d47a1] border-blue-100";
}

function mutationCanAffectNotifications(detail = {}) {
  const url = String(detail.url || "");
  if (!url) return true;
  return [
    "/notifications",
    "/admin/leads",
    "/bank/leads",
    "/dealer/leads",
    "/documents",
    "/gm/leads",
  ].some((prefix) => url.startsWith(prefix));
}

export function NotificationCenter() {
  const initialPayload = getCachedGetData("/notifications", { limit: 20 });
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(() => initialPayload?.data || []);
  const [unread, setUnread] = useState(() => initialPayload?.unread || 0);
  const [filter, setFilter] = useState("");
  const [toast, setToast] = useState("");
  const seenIds = useRef(new Set());
  const loadRef = useRef(null);
  const inFlightRef = useRef(false);
  const lastRefreshAtRef = useRef(0);
  const mutationTimerRef = useRef(0);
  const toastTimerRef = useRef(0);

  const load = useCallback(async ({ silent = false } = {}) => {
    const response = await api.get("/notifications", { params: { limit: 20, unread: filter === "unread" ? "true" : undefined } });
    const nextItems = response.data.data || [];
    setItems(nextItems);
    setUnread(response.data.unread || 0);
    return nextItems;
  }, [filter]);

  loadRef.current = load;

  const refreshNotifications = useCallback(async ({ force = false } = {}) => {
    if (inFlightRef.current) return [];
    const elapsed = Date.now() - lastRefreshAtRef.current;
    if (!force && elapsed < NOTIFICATION_REFRESH_COOLDOWN_MS) return [];
    inFlightRef.current = true;
    lastRefreshAtRef.current = Date.now();
    try {
      const previous = seenIds.current;
      const nextItems = await loadRef.current?.({ silent: true }).catch(() => []) || [];
      const fresh = nextItems.find((item) => !previous.has(item.id));
      nextItems.forEach((item) => previous.add(item.id));
      if (fresh && !fresh.read) {
        setToast(fresh.title || "New notification");
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = window.setTimeout(() => setToast(""), 3500);
      }
      return nextItems;
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    const cached = getCachedGetData("/notifications", { limit: 20, unread: filter === "unread" ? "true" : undefined });
    if (cached?.data) {
      setItems(cached.data);
      setUnread(cached.unread || 0);
      cached.data.forEach((item) => seenIds.current.add(item.id));
    } else {
      refreshNotifications({ force: true }).then((nextItems) => nextItems.forEach((item) => seenIds.current.add(item.id))).catch(() => {});
    }
  }, [filter, refreshNotifications]);

  useEffect(() => {
    const onMutation = (event) => {
      if (!mutationCanAffectNotifications(event?.detail || {})) return;
      window.clearTimeout(mutationTimerRef.current);
      mutationTimerRef.current = window.setTimeout(() => {
        refreshNotifications({ force: false }).catch(() => {});
      }, NOTIFICATION_REFRESH_DEBOUNCE_MS);
    };
    window.addEventListener("cls:data-mutated", onMutation);
    return () => {
      window.clearTimeout(toastTimerRef.current);
      window.clearTimeout(mutationTimerRef.current);
      window.removeEventListener("cls:data-mutated", onMutation);
    };
  }, [refreshNotifications]);

  useEffect(() => {
    if (!open) return undefined;
    refreshNotifications({ force: true }).catch(() => {});
    return undefined;
  }, [open, refreshNotifications]);

  const markRead = async (id) => {
    await api.patch(`/notifications/${id}/read`);
    setItems((current) => current.map((item) => item.id === id ? { ...item, read: true, readAt: new Date().toISOString() } : item));
    setUnread((current) => Math.max(0, current - 1));
  };

  return (
    <div className="relative">
      {toast ? <div className="fixed right-4 top-20 z-[60] rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-[#0d47a1] shadow-sm">{toast}</div> : null}
      <button onClick={() => setOpen((value) => !value)} className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-[#0d47a1] hover:bg-slate-50">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 scale-100 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white transition-transform duration-200 ease-out">{unread}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-[min(92vw,400px)] rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">Notifications</h3>
              <p className="text-xs text-slate-500">WhatsApp-first operational alerts</p>
            </div>
            <button onClick={() => setOpen(false)} className="rounded-xl p-2 hover:bg-[#f5f7fb]"><X className="h-4 w-4" /></button>
          </div>

          <div className="mt-4 flex gap-2">
            <button onClick={() => setFilter("")} className={`rounded-full px-3 py-1.5 text-xs font-medium ${filter === "" ? "bg-[#0d47a1] text-white" : "bg-slate-100 text-slate-600"}`}>All</button>
            <button onClick={() => setFilter("unread")} className={`rounded-full px-3 py-1.5 text-xs font-medium ${filter === "unread" ? "bg-[#0d47a1] text-white" : "bg-slate-100 text-slate-600"}`}>Unread</button>
          </div>

          <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto">
            {!items.length && <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No notifications yet.</p>}
            {items.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                    {item.caseId && <p className="mt-1 text-xs font-semibold text-[#0d47a1]">{item.caseId}</p>}
                    <p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-600">{item.message}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-[10px] font-medium ${priorityClass(item.priority)}`}>{item.priority || "normal"}</span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[#536173]">
                  <span>{formatDate(item.createdAt)}</span>
                  {!item.read && <button onClick={() => markRead(item.id)} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 font-medium text-[#0d47a1]"><CheckCheck className="h-3.5 w-3.5" /> Mark read</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
