import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCheck, ExternalLink, X } from "lucide-react";
import { api, getCachedGetData, patchCachedGetData } from "../services/api.js";
import { logNotificationRefresh, useRenderDiagnostics } from "../services/frontendLatency.js";

const NOTIFICATION_REFRESH_COOLDOWN_MS = 10000;
const NOTIFICATION_PANEL_FRESH_MS = 30000;

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "Just now";
  if (diffMs < hour) {
    const minutes = Math.max(1, Math.floor(diffMs / minute));
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (diffMs < day) {
    const hours = Math.max(1, Math.floor(diffMs / hour));
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (diffMs < 2 * day) return "Yesterday";
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function priorityClass(priority) {
  if (priority === "critical" || priority === "high") return "bg-red-50 text-red-700 border-red-100";
  if (priority === "medium") return "bg-amber-50 text-amber-700 border-amber-100";
  if (priority === "success") return "bg-emerald-50 text-emerald-700 border-emerald-100";
  return "bg-blue-50 text-[#0d47a1] border-blue-100";
}

function desktopPermissionState() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return window.Notification.permission;
}

function desktopBody(notification) {
  return [notification?.caseId, notification?.message].filter(Boolean).join("\n");
}

function rowsFromPayload(payload) {
  return Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
}

function patchNotificationPayload(payload, notification, params = null) {
  if (!notification?.id || !payload || typeof payload !== "object") return payload;
  const unreadOnly = String(params?.unread || "") === "true";
  const currentRows = rowsFromPayload(payload);
  const existing = currentRows.find((item) => item.id === notification.id);
  const nextItem = { ...(existing || {}), ...notification, read: notification.read === true };
  const nextRows = unreadOnly && nextItem.read
    ? currentRows.filter((item) => item.id !== notification.id)
    : unreadOnly && !existing && nextItem.read
      ? currentRows
      : existing
    ? currentRows.map((item) => item.id === notification.id ? nextItem : item)
    : [nextItem, ...currentRows].slice(0, 20);
  const unread = nextRows.filter((item) => item.read !== true).length;
  return Array.isArray(payload) ? nextRows : { ...payload, data: nextRows, unread };
}

function markAllPayloadRead(payload, params = null) {
  if (!payload || typeof payload !== "object") return payload;
  const unreadOnly = String(params?.unread || "") === "true";
  const currentRows = rowsFromPayload(payload);
  const nextRows = unreadOnly ? [] : currentRows.map((item) => ({ ...item, read: true, readAt: item.readAt || new Date().toISOString() }));
  return Array.isArray(payload) ? nextRows : { ...payload, data: nextRows, unread: 0 };
}

export function NotificationCenter() {
  useRenderDiagnostics("NotificationCenter", { open: false });
  const initialPayload = getCachedGetData("/notifications", { limit: 20 });
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(() => initialPayload?.data || []);
  const [unread, setUnread] = useState(() => initialPayload?.unread || 0);
  const [filter, setFilter] = useState("");
  const [toast, setToast] = useState("");
  const [desktopPermission, setDesktopPermission] = useState(() => desktopPermissionState());
  const seenIds = useRef(new Set());
  const loadRef = useRef(null);
  const inFlightRef = useRef(false);
  const lastRefreshAtRef = useRef(0);
  const lastLocalPatchAtRef = useRef(initialPayload?.data?.length ? Date.now() : 0);
  const toastTimerRef = useRef(0);

  const load = useCallback(async ({ silent = false } = {}) => {
    logNotificationRefresh({ component: "NotificationCenter", refreshTriggered: true, eventType: "load", silent, filter });
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

  const flashToast = useCallback((message) => {
    setToast(message);
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 3500);
  }, []);

  const showDesktopNotification = useCallback((notification) => {
    if (desktopPermission !== "granted" || typeof window === "undefined" || !("Notification" in window)) return;
    const alert = new window.Notification(notification.title || "New notification", {
      body: desktopBody(notification),
      icon: "/favicon.ico",
      tag: notification.id || `${notification.type || "notification"}-${notification.createdAt || Date.now()}`,
    });
    alert.onclick = () => {
      window.focus();
      if (notification.actionUrl) window.location.assign(notification.actionUrl);
      alert.close();
    };
  }, [desktopPermission]);

  const enableDesktopAlerts = async () => {
    if (desktopPermission === "unsupported" || typeof window === "undefined" || !("Notification" in window)) {
      flashToast("Desktop alerts are not supported in this browser");
      return;
    }
    if (desktopPermission === "granted") {
      flashToast("Desktop alerts are already enabled");
      return;
    }
    const permission = await window.Notification.requestPermission();
    setDesktopPermission(permission);
    if (permission === "granted") {
      flashToast("Desktop alerts enabled");
      const alert = new window.Notification("CarLoanSaathi alerts enabled", {
        body: "Realtime alerts will appear while this dashboard is open.",
        icon: "/favicon.ico",
        tag: "carloansaathi-alerts-enabled",
      });
      alert.onclick = () => {
        window.focus();
        alert.close();
      };
    } else {
      flashToast("Desktop alerts are blocked by browser settings");
    }
  };

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
    const onRealtime = (event) => {
      const eventType = event?.detail?.eventType || event?.detail?.event || "";
      const notification = event?.detail?.notification;
      if (eventType === "NOTIFICATION_MARK_ALL_READ") {
        setItems((current) => filter === "unread" ? [] : current.map((item) => ({ ...item, read: true, readAt: item.readAt || new Date().toISOString() })));
        setUnread(0);
        patchCachedGetData("/notifications", markAllPayloadRead, { matchPrefix: true });
        lastLocalPatchAtRef.current = Date.now();
        return;
      }
      if (!notification?.id) return;
      seenIds.current.add(notification.id);
      let shouldIncrementUnread = false;
      let shouldDecrementUnread = false;
      setItems((current) => {
        const existing = current.find((item) => item.id === notification.id);
        shouldIncrementUnread = eventType === "NOTIFICATION_CREATED" && !existing && !notification.read;
        shouldDecrementUnread = (eventType === "NOTIFICATION_READ" || notification.read) && existing && existing.read !== true;
        if (filter === "unread" && notification.read) return current.filter((item) => item.id !== notification.id);
        const next = existing
          ? current.map((item) => item.id === notification.id ? { ...item, ...notification } : item)
          : [{ ...notification, read: notification.read === true }, ...current].slice(0, 20);
        return next;
      });
      patchCachedGetData("/notifications", (payload, params) => patchNotificationPayload(payload, notification, params), { matchPrefix: true });
      lastLocalPatchAtRef.current = Date.now();
      if (shouldIncrementUnread) {
        setUnread((current) => current + 1);
        flashToast(notification.title || "New notification");
        showDesktopNotification(notification);
      } else if (shouldDecrementUnread) {
        setUnread((current) => Math.max(0, current - 1));
      }
    };
    window.addEventListener("cls:realtime-event", onRealtime);
    return () => window.removeEventListener("cls:realtime-event", onRealtime);
  }, [filter, flashToast, showDesktopNotification]);

  useEffect(() => {
    return () => {
      window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    if (items.length && Date.now() - Math.max(lastLocalPatchAtRef.current, lastRefreshAtRef.current) < NOTIFICATION_PANEL_FRESH_MS) return undefined;
    logNotificationRefresh({ component: "NotificationCenter", refreshTriggered: true, eventType: "panel-open" });
    refreshNotifications({ force: true }).catch(() => {});
    return undefined;
  }, [items.length, open, refreshNotifications]);

  const markRead = async (id) => {
    await api.patch(`/notifications/${id}/read`);
    setItems((current) => filter === "unread"
      ? current.filter((item) => item.id !== id)
      : current.map((item) => item.id === id ? { ...item, read: true, readAt: new Date().toISOString() } : item));
    setUnread((current) => Math.max(0, current - 1));
    patchCachedGetData("/notifications", (payload, params) => patchNotificationPayload(payload, { id, read: true, readAt: new Date().toISOString() }, params), { matchPrefix: true });
  };

  const markAllRead = async () => {
    const response = await api.patch("/notifications/read-all");
    setItems((current) => filter === "unread" ? [] : current.map((item) => ({ ...item, read: true, readAt: item.readAt || new Date().toISOString() })));
    setUnread(response.data?.unread ?? 0);
    patchCachedGetData("/notifications", markAllPayloadRead, { matchPrefix: true });
  };

  const openAction = (url) => {
    if (!url) return;
    window.location.assign(url);
  };

  return (
    <div className="relative">
      {toast ? <div className="fixed right-4 top-20 z-[60] rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-[#0d47a1] shadow-sm">{toast}</div> : null}
      <button type="button" aria-label="Open notifications" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-[#0d47a1] hover:bg-slate-50">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 scale-100 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white transition-transform duration-200 ease-out">{unread}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-[min(92vw,400px)] rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-900">Notifications</h3>
              <p className="text-xs text-slate-500">Realtime browser alerts</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-xl p-2 hover:bg-[#f5f7fb]"><X className="h-4 w-4" /></button>
          </div>

          {desktopPermission === "default" ? (
            <button type="button" onClick={enableDesktopAlerts} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold text-[#0d47a1] hover:bg-blue-100">
              <Bell className="h-3.5 w-3.5" /> Enable desktop alerts
            </button>
          ) : null}
          {desktopPermission === "denied" ? (
            <p className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">Desktop alerts are blocked in browser settings.</p>
          ) : null}

          <div className="mt-4 flex items-center justify-between gap-2">
            <div className="flex gap-2">
              <button type="button" onClick={() => setFilter("")} className={`rounded-full px-3 py-1.5 text-xs font-medium ${filter === "" ? "bg-[#0d47a1] text-white" : "bg-slate-100 text-slate-600"}`}>All</button>
              <button type="button" onClick={() => setFilter("unread")} className={`rounded-full px-3 py-1.5 text-xs font-medium ${filter === "unread" ? "bg-[#0d47a1] text-white" : "bg-slate-100 text-slate-600"}`}>Unread</button>
            </div>
            <button type="button" onClick={markAllRead} disabled={unread <= 0} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50">
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
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
                  <div className="flex items-center gap-2">
                    {item.actionUrl ? <button type="button" onClick={() => openAction(item.actionUrl)} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 font-medium text-slate-600"><ExternalLink className="h-3.5 w-3.5" /> Open</button> : null}
                    {!item.read && <button type="button" onClick={() => markRead(item.id)} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 font-medium text-[#0d47a1]"><CheckCheck className="h-3.5 w-3.5" /> Mark read</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
