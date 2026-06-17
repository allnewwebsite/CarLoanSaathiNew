import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, BarChart3, Building2, ClipboardCheck, ClipboardList, FileClock, FileText, FileX2, Landmark, Menu, PanelLeftClose, PanelLeftOpen, Search, Users, X } from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { NotificationCenter } from "../components/NotificationCenter.jsx";
import { PortalUserMenu } from "../components/PortalUserMenu.jsx";
import { SubscriptionBanner } from "../components/PlanBillingModal.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { api, getCachedGetData, prefetchGet } from "../services/api.js";
import { markRouteChangeStart, useRenderDiagnostics } from "../services/frontendLatency.js";

const navByRole = {
  "gm": [
    { label: "Total Leads", to: "/gm/total-leads", icon: ClipboardList },
    { label: "All Salespersons", to: "/gm/salespersons", icon: Users },
    { label: "Status", to: "/gm/status", icon: FileClock },
    { label: "All Cases", to: "/gm/cases", icon: FileText },
  ],
  "finance-desk": [
    { label: "Total Leads", to: "/finance/total-leads", icon: ClipboardList },
    { label: "Add Lead", to: "/finance/add-lead", icon: ClipboardCheck },
    { label: "Add GM", to: "/finance/manage-staff", icon: Users },
    { label: "Add Finance Manager", to: "/finance/finance-managers", icon: Users },
    { label: "Add / Remove Salesperson", to: "/finance/salespersons", icon: Users },
    { label: "Active Salespersons", to: "/finance/active-salespersons", icon: Users },
    { label: "All Cases", to: "/finance/cases", icon: FileText },
    { label: "Status", to: "/finance/status", icon: FileClock },
    { label: "Dead Cases", to: "/finance/dead-cases", icon: FileX2 },
    { label: "Bank Tie-Ups", to: "/finance/bank-tieups", icon: Landmark },
  ],
  "bank-manager": [
    { label: "Total Leads", to: "/bank-manager/leads", icon: ClipboardList },
    { label: "Status", to: "/bank-manager/status", icon: FileClock },
    { label: "Analytics", to: "/bank-manager/analytics", icon: BarChart3 },
    { label: "Manage Executive", to: "/bank-manager/manage-executive", icon: Users },
    { label: "All Executives", to: "/bank-manager/executives", icon: ClipboardCheck },
    { label: "All Dealerships", to: "/bank-manager/dealerships", icon: Building2 },
  ],
  "loan-executive": [
    { label: "Total Leads", to: "/loan-executive/leads", icon: ClipboardList },
    { label: "Status", to: "/loan-executive/status", icon: FileClock },
  ],
  "super-admin": [
    { label: "Approved Dealerships", to: "/admin/dealerships", icon: Building2 },
    { label: "Pending Approval Dealerships", to: "/admin/approvals/dealerships", icon: ClipboardCheck },
    { label: "Approved Banks", to: "/admin/banks", icon: Landmark },
    { label: "Pending Approval Banks", to: "/admin/approvals/banks", icon: ClipboardCheck },
    { label: "Status", to: "/admin/status", icon: FileClock },
    { label: "Total Leads", to: "/admin/leads", icon: ClipboardList },
    { label: "Dead Cases", to: "/admin/dead-cases", icon: FileX2 },
    { label: "Monitoring", to: "/admin/monitoring", icon: Activity },
  ],
};

const SIDEBAR_STORAGE_KEY = "cls_sidebar_collapsed";
const notificationPrefetch = { url: "/notifications", params: { limit: 20 } };
const scheduleIdle = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 180));
const cancelIdle = window.cancelIdleCallback || window.clearTimeout;

function withCommonPrefetch(specs = []) {
  const seen = new Set();
  return [...specs, notificationPrefetch].filter(({ url, params }) => {
    const key = `${url}|${JSON.stringify(params || {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function prefetchSpecsForRoute(to) {
  const path = String(to || "").split("?")[0];
  if (path.startsWith("/finance")) return withCommonPrefetch([{ url: "/dashboard/fast" }]);
  if (path.startsWith("/gm")) return withCommonPrefetch([{ url: "/dashboard/fast" }]);
  if (path.startsWith("/bank-manager/dealerships")) return withCommonPrefetch([{ url: "/dashboard/fast" }, { url: "/bank/dealerships", params: { page: 1, limit: 10 } }]);
  if (path.startsWith("/bank-manager")) return withCommonPrefetch([{ url: "/dashboard/fast" }]);

  if (path.startsWith("/loan-executive")) return withCommonPrefetch([
    { url: "/dashboard/fast" },
  ]);

  if (path.startsWith("/admin")) return withCommonPrefetch([{ url: "/dashboard/fast" }]);
  return withCommonPrefetch([]);
}

function prefetchDashboardRoute(to) {
  prefetchSpecsForRoute(to).forEach(({ url, params, options }) => {
    prefetchGet(url, params, options);
  });
}

function DashboardContentFallback() {
  return (
    <section className="space-y-4" aria-busy="true">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="h-7 w-52 animate-pulse rounded-md bg-slate-200" />
        <div className="h-9 w-28 animate-pulse rounded-md bg-slate-200" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-20 animate-pulse rounded-lg border border-slate-200 bg-white" />
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="grid grid-cols-4 gap-3 border-b border-slate-200 bg-slate-50 p-3">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-4 animate-pulse rounded bg-slate-200" />
          ))}
        </div>
        <div className="divide-y divide-slate-100 p-3">
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <div key={row} className="grid grid-cols-4 gap-3 py-2">
              {[0, 1, 2, 3].map((cell) => (
                <div key={cell} className="h-4 animate-pulse rounded bg-slate-200/80" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function leadPathForRole(role, leadId) {
  if (!leadId) return "";
  if (role === "finance-desk") return `/finance/leads/${encodeURIComponent(leadId)}`;
  if (role === "gm") return `/gm/leads/${encodeURIComponent(leadId)}`;
  if (role === "bank-manager") return `/bank-manager/leads/${encodeURIComponent(leadId)}`;
  if (role === "loan-executive") return `/loan-executive/leads/${encodeURIComponent(leadId)}`;
  if (role === "super-admin") return `/admin/leads/${encodeURIComponent(leadId)}`;
  return "";
}

function GlobalDashboardSearch({ user }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);
  const trimmed = query.trim();

  useEffect(() => {
    const onPointerDown = (event) => {
      if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    if (trimmed.length < 2) {
      setRows([]);
      setLoading(false);
      return undefined;
    }
    const params = { q: trimmed, limit: 8 };
    const cached = getCachedGetData("/dashboard/search", params);
    if (cached?.data) setRows(cached.data);
    setLoading(!cached?.data);
    const handle = window.setTimeout(async () => {
      try {
        const response = await api.get("/dashboard/search", { params, silent: true });
        setRows(response.data?.data || []);
        setOpen(true);
      } catch {
        setRows([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => window.clearTimeout(handle);
  }, [trimmed]);

  const choose = (row) => {
    const path = leadPathForRole(user?.role, row.leadId || row.id);
    if (!path) return;
    setOpen(false);
    setQuery("");
    navigate(path);
  };

  return (
    <div ref={boxRef} className="relative hidden min-w-[14rem] max-w-md flex-1 xl:block">
      <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 focus-within:border-[#0d47a1] focus-within:ring-2 focus-within:ring-blue-100">
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search case, customer, mobile"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
      </label>
      {open && trimmed.length >= 2 ? (
        <div className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {loading ? <p className="px-3 py-3 text-sm text-slate-500">Searching...</p> : null}
          {!loading && !rows.length ? <p className="px-3 py-3 text-sm text-slate-500">No matching cases.</p> : null}
          {rows.map((row) => (
            <button key={row.id || row.leadId} type="button" onClick={() => choose(row)} className="block w-full border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50">
              <span className="block text-sm font-semibold text-slate-900">{row.caseId || row.leadId}</span>
              <span className="mt-0.5 block truncate text-xs text-slate-500">{row.customerName || "Customer"} {row.mobile ? `- ${row.mobile}` : ""}</span>
              <span className="mt-0.5 block truncate text-xs text-slate-400">{row.bankName || row.executiveName || row.dealershipName || row.status || "Case"}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function readSidebarState() {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function DashboardLayout() {
  useRenderDiagnostics("DashboardLayout");
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readSidebarState);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
    } catch {
      // Sidebar preference is non-critical.
    }
  }, [collapsed]);

  useEffect(() => {
    markRouteChangeStart(`${location.pathname}${location.search}`);
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  const handleLogout = useCallback(() => {
    logout();
    navigate("/");
  }, [logout, navigate]);

  const nav = useMemo(() => navByRole[user?.role] || [], [user?.role]);
  const loanExecutiveMobile = user?.role === "loan-executive";
  const currentTarget = `${location.pathname}${location.search}`;
  const isNavActive = useCallback((to) => (to.includes("?") ? currentTarget === to : location.pathname === to && !location.search), [currentTarget, location.pathname, location.search]);

  useEffect(() => {
    const handles = [];
    nav.forEach((item, index) => {
      const timeoutHandle = window.setTimeout(() => {
      const idleHandle = scheduleIdle(() => prefetchDashboardRoute(item.to));
      handles.push(idleHandle);
      }, index * 120);
      handles.push(timeoutHandle);
    });
    return () => handles.forEach((handle) => {
      window.clearTimeout(handle);
      cancelIdle(handle);
    });
  }, [nav]);

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const headerEyebrow = user?.role === "bank-manager"
    ? `${user.bankName || "Bank Branch"} — ${user.bankIfsc || "IFSC Pending"}`
    : ["finance-desk", "gm"].includes(user?.role)
      ? `${user.dealershipName || "Dealership"} ${user.role === "finance-desk" ? "Finance Desk" : "GM"}`.toUpperCase()
      : user?.roleLabel || "Workspace";

  const dashboardTitle = user?.role === "bank-manager"
    ? "BANK MANAGER DASHBOARD"
    : user?.role === "finance-desk"
      ? "FINANCE DESK DASHBOARD"
      : user?.role === "gm"
        ? "GM DASHBOARD"
        : user?.role === "loan-executive"
          ? "LOAN EXECUTIVE DASHBOARD"
          : user?.role === "super-admin"
            ? "SUPER ADMIN DASHBOARD"
            : "OPERATING DASHBOARD";
  const mobilePageTitle = loanExecutiveMobile
    ? location.pathname.includes("/status")
      ? "Status"
      : location.pathname.includes("/leads/")
        ? "Lead Details"
        : "Total Leads"
    : dashboardTitle;
  const headerMetadata = user?.role === "bank-manager"
    ? [
        ["Bank Name", user.bankName || "Bank Branch"],
        ["IFSC Code", user.bankIfsc || "IFSC Pending"],
      ]
    : ["finance-desk", "gm"].includes(user?.role)
      ? [["Dealership", user.dealershipName || "Dealership"]]
      : [];

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-slate-50">
      {mobileOpen ? <button aria-label="Close sidebar overlay" className="fixed inset-0 z-30 bg-slate-900/30 opacity-100 transition-opacity duration-200 ease-out lg:hidden" onClick={() => setMobileOpen(false)} /> : null}
      <aside className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-200 bg-white px-3 py-4 shadow-xl shadow-slate-900/10 transition-[width,transform] duration-300 ease-[cubic-bezier(0.2,0,0,1)] will-change-transform lg:shadow-none ${loanExecutiveMobile ? "w-[min(82vw,18rem)]" : "w-64"} ${collapsed ? "lg:w-20" : "lg:w-64"} ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
        <div className="flex shrink-0 items-center gap-2">
          <NavLink to="/" className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg bg-slate-50 p-3 text-base font-semibold transition-[padding] duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${collapsed ? "lg:justify-center" : ""}`} title="CarLoanSaathi">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0d47a1] text-sm text-white transition-transform duration-200 ease-out group-hover:scale-105">CL</span>
          <span className={`truncate whitespace-nowrap transition-[opacity,transform,width] duration-200 ease-out ${collapsed ? "lg:w-0 lg:-translate-x-1 lg:opacity-0" : "lg:w-auto lg:translate-x-0 lg:opacity-100"}`}><span className="text-[#08736d]">CarLoan</span><span className="text-[#d86508]">Saathi</span></span>
          </NavLink>
          <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close sidebar" className="rounded-md border border-slate-200 p-2 text-slate-600 lg:hidden">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-6 min-h-0 flex-1 space-y-1 overflow-y-auto pb-3">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} onMouseEnter={() => prefetchDashboardRoute(item.to)} onFocus={() => prefetchDashboardRoute(item.to)} onPointerDown={() => prefetchDashboardRoute(item.to)} title={collapsed ? item.label : undefined} className={() => `group flex min-h-10 items-center gap-3 overflow-hidden rounded-md px-3 py-2.5 text-sm font-medium transition-[background-color,color,padding,transform] duration-200 ease-out ${collapsed ? "lg:justify-center lg:px-2" : ""} ${isNavActive(item.to) ? "bg-[#0d47a1] text-white" : "text-slate-600 hover:bg-slate-50 hover:text-[#0d47a1]"}`}>
                <Icon className="h-5 w-5 shrink-0 transition-transform duration-200 ease-out group-hover:scale-105" /> <span className={`truncate whitespace-nowrap transition-[opacity,transform,width] duration-200 ease-out ${collapsed ? "lg:w-0 lg:-translate-x-1 lg:opacity-0" : "lg:w-auto lg:translate-x-0 lg:opacity-100"}`}>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
        <div className="shrink-0 space-y-3">
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`hidden h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition-[background-color,color,transform,width,padding] duration-200 ease-out hover:bg-slate-50 hover:text-[#0d47a1] focus:outline-none focus:ring-2 focus:ring-[#0d47a1]/25 lg:inline-flex ${collapsed ? "lg:w-full lg:justify-center lg:px-2" : "lg:w-fit"}`}
          >
            <ToggleIcon className="h-4 w-4 shrink-0" />
            <span className={`whitespace-nowrap transition-[opacity,transform,width] duration-200 ease-out ${collapsed ? "lg:w-0 lg:-translate-x-1 lg:opacity-0" : "lg:w-auto lg:translate-x-0 lg:opacity-100"}`}>
              Collapse
            </span>
          </button>
          <div className={`overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-3 transition-[padding] duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${loanExecutiveMobile ? "hidden lg:block" : ""} ${collapsed ? "lg:px-2" : ""}`}>
            <p className={`text-xs font-medium uppercase tracking-[0.12em] text-slate-500 ${collapsed ? "lg:hidden" : ""}`}>Session</p>
            <p className={`hidden text-center text-xs font-semibold text-slate-500 ${collapsed ? "lg:block" : ""}`}>{user?.email?.slice(0, 1)?.toUpperCase() || "U"}</p>
            <p className={`mt-1 break-words text-sm font-medium leading-5 text-slate-900 transition-[max-height,opacity,transform] duration-200 ease-out ${collapsed ? "lg:max-h-0 lg:-translate-x-1 lg:opacity-0" : "lg:max-h-20 lg:translate-x-0 lg:opacity-100"}`}>{user?.email}</p>
          </div>
        </div>
      </aside>
      <main className={`min-w-0 transition-[padding] duration-300 ease-[cubic-bezier(0.2,0,0,1)] ${collapsed ? "lg:pl-20" : "lg:pl-64"}`}>
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
          <div className={`flex items-center justify-between gap-3 px-3 sm:gap-4 sm:px-6 lg:px-6 ${loanExecutiveMobile ? "min-h-14 py-2 lg:min-h-[4.5rem] lg:py-3" : "min-h-[4.5rem] py-3"}`}>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open sidebar" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 lg:hidden">
                <Menu className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-base font-semibold tracking-[0.01em] text-slate-950 sm:text-xl">
                  <span className={loanExecutiveMobile ? "lg:hidden" : "hidden"}>{mobilePageTitle}</span>
                  <span className={loanExecutiveMobile ? "hidden lg:inline" : ""}>{dashboardTitle}</span>
                </h1>
                {headerMetadata.length ? (
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                    {headerMetadata.map(([label, value]) => (
                      <span key={label} className="inline-flex max-w-full min-w-0 items-center gap-1">
                        <span className="font-medium text-slate-500">{label}:</span>
                        <span className="truncate font-semibold text-slate-700">{value}</span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <GlobalDashboardSearch user={user} />
              <NotificationCenter />
              <PortalUserMenu user={user} onLogout={handleLogout} />
            </div>
          </div>
        </header>
        <div className={`border-b border-slate-200 bg-white px-4 py-2 lg:hidden ${loanExecutiveMobile ? "hidden" : ""}`}>
          <div className="flex gap-2 overflow-x-auto">
            {nav.map((item) => (
              <NavLink key={item.to} to={item.to} onTouchStart={() => prefetchDashboardRoute(item.to)} onFocus={() => prefetchDashboardRoute(item.to)} className={() => `whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium ${isNavActive(item.to) ? "bg-[#0d47a1] text-white" : "bg-slate-100 text-slate-600"}`}>
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
        <div className={`w-full max-w-full overflow-x-hidden sm:px-6 lg:px-6 ${loanExecutiveMobile ? "px-3 py-3 sm:py-4 lg:py-5" : "px-4 py-5"}`}>
          <SubscriptionBanner user={user} />
          <Suspense fallback={<DashboardContentFallback />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
