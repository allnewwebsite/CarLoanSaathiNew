import { useEffect, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../services/api.js";
import { db } from "../services/firebaseDb.js";

function formatDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function priorityClass(priority) {
  if (priority === "high") return "bg-red-50 text-red-700 border-red-100";
  return "bg-blue-50 text-[#0d47a1] border-blue-100";
}

export function NotificationCenter() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [filter, setFilter] = useState("");

  const load = async () => {
    const response = await api.get("/notifications", { params: { limit: 20, unread: filter === "unread" ? "true" : undefined } });
    setItems(response.data.data || []);
    setUnread(response.data.unread || 0);
  };

  useEffect(() => {
    load().catch(() => {});
  }, [filter]);

  useEffect(() => {
    if (!user?.role) return undefined;
    const constraints = [];
    if (user.role === "super-admin") {
      constraints.push(orderBy("createdAt", "desc"));
    } else if (["finance-desk", "gm-sm"].includes(user.role) && user.dealershipId) {
      constraints.push(where("dealershipId", "==", user.dealershipId), orderBy("createdAt", "desc"));
    } else if (user.role === "bank-manager" && user.bankId) {
      constraints.push(where("bankId", "==", user.bankId), orderBy("createdAt", "desc"));
    } else {
      constraints.push(where("recipientId", "==", user.email), orderBy("createdAt", "desc"));
    }
    constraints.push(limit(20));
    const unsubscribe = onSnapshot(query(collection(db, "notifications"), ...constraints), (snapshot) => {
      const nextItems = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      const filtered = filter === "unread" ? nextItems.filter((item) => !item.read) : nextItems;
      setItems(filtered);
      setUnread(nextItems.filter((item) => !item.read).length);
    }, () => {
      load().catch(() => {});
    });
    return unsubscribe;
  }, [filter, user?.role, user?.email, user?.dealershipId, user?.bankId]);

  const markRead = async (id) => {
    await api.patch(`/notifications/${id}/read`);
    await load();
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen((value) => !value)} className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-[#0d47a1] hover:bg-slate-50">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">{unread}</span>}
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
