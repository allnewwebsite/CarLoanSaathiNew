import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { NotificationCenter } from "../components/NotificationCenter.jsx";
import { PortalUserMenu } from "../components/PortalUserMenu.jsx";
import { SubscriptionBanner } from "../components/PlanBillingModal.jsx";
import { BrandLogo } from "../components/BrandLogo.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { markRouteChangeStart, useRenderDiagnostics } from "../services/frontendLatency.js";
import { navByRole, prefetchDashboardRoute } from "./DashboardLayout.config.js";

const SIDEBAR_STORAGE_KEY = "cls_sidebar_collapsed";
const scheduleIdle = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 180));
const cancelIdle = window.cancelIdleCallback || window.clearTimeout;

function isLifecycleArchivePath(pathname = "") {
  return /\/(rejected|disbursed)\/?$/.test(String(pathname));
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
  const [moreOpen, setMoreOpen] = useState(() => isLifecycleArchivePath(window.location.pathname));

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
    setMoreOpen(isLifecycleArchivePath(location.pathname));
  }, [location.pathname]);

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
  const isNavActive = useCallback((to) => (to.includes("?") ? currentTarget === to : location.pathname === to), [currentTarget, location.pathname]);

  useEffect(() => {
    const handles = [];
    nav.flatMap((item) => item.children || [item]).forEach((item, index) => {
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
          <BrandLogo className="h-9 w-9 rounded-lg bg-white transition-transform duration-200 ease-out group-hover:scale-105" />
          <span className={`truncate whitespace-nowrap transition-[opacity,transform,width] duration-200 ease-out ${collapsed ? "lg:w-0 lg:-translate-x-1 lg:opacity-0" : "lg:w-auto lg:translate-x-0 lg:opacity-100"}`}><span className="text-[#08736d]">CarLoan</span><span className="text-[#d86508]">Saathi</span></span>
          </NavLink>
          <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close sidebar" className="rounded-md border border-slate-200 p-2 text-slate-600 lg:hidden">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-6 min-h-0 flex-1 space-y-1 overflow-y-auto pb-3">
          {nav.map((item) => {
            const Icon = item.icon;
            if (item.children?.length) {
              return (
                <div key={item.label}>
                  <button type="button" onClick={() => { if (collapsed) setCollapsed(false); setMoreOpen((value) => !value); }} aria-expanded={moreOpen} className="group flex min-h-10 w-full items-center gap-3 overflow-hidden rounded-md px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-[#0d47a1]">
                    <Icon className="h-5 w-5 shrink-0" />
                    <span className={`min-w-0 flex-1 truncate text-left ${collapsed ? "lg:hidden" : ""}`}>{item.label}</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${moreOpen ? "rotate-180" : ""} ${collapsed ? "lg:hidden" : ""}`} />
                  </button>
                  {moreOpen && !collapsed ? <div className="ml-5 space-y-1 border-l border-slate-200 pl-2">
                    {item.children.map((child) => {
                      const ChildIcon = child.icon;
                      return <NavLink key={child.to} to={child.to} onClick={() => setMobileOpen(false)} className={() => `flex min-h-9 items-center gap-2 rounded-md px-3 py-2 text-sm ${isNavActive(child.to) ? "bg-blue-50 font-semibold text-[#0d47a1]" : "text-slate-600 hover:bg-slate-50 hover:text-[#0d47a1]"}`}><ChildIcon className="h-4 w-4" />{child.label}</NavLink>;
                    })}
                  </div> : null}
                </div>
              );
            }
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
              <NotificationCenter />
              <PortalUserMenu user={user} onLogout={handleLogout} />
            </div>
          </div>
        </header>
        <div className={`border-b border-slate-200 bg-white px-4 py-2 lg:hidden ${loanExecutiveMobile ? "hidden" : ""}`}>
          <div className="flex gap-2 overflow-x-auto">
            {nav.flatMap((item) => item.children || [item]).map((item) => (
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
