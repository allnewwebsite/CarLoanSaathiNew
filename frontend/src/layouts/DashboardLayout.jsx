import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Building2, ClipboardCheck, ClipboardList, FileClock, FileText, Landmark, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings, Shield, Users, X } from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { NotificationCenter } from "../components/NotificationCenter.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const navByRole = {
  "gm-sm": [
    { label: "Total Leads", to: "/gm/total-leads", icon: ClipboardList },
    { label: "All Salespersons", to: "/gm/salespersons", icon: Users },
    { label: "Status", to: "/gm/status", icon: FileClock },
    { label: "All Cases", to: "/gm/cases", icon: FileText },
  ],
  "finance-desk": [
    { label: "Total Leads", to: "/finance/total-leads", icon: ClipboardList },
    { label: "Add Lead", to: "/finance/add-lead", icon: ClipboardCheck },
    { label: "Add / Remove Salesperson", to: "/finance/salespersons", icon: Users },
    { label: "Active Salespersons", to: "/finance/active-salespersons", icon: Users },
    { label: "All Cases", to: "/finance/cases", icon: FileText },
    { label: "Status", to: "/finance/status", icon: FileClock },
  ],
  "bank-manager": [
    { label: "Total Leads", to: "/bank-manager/leads", icon: ClipboardList },
    { label: "Manage Executive", to: "/bank-manager/manage-executive", icon: Users },
    { label: "All Executives", to: "/bank-manager/executives", icon: ClipboardCheck },
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
  ],
};

const SIDEBAR_STORAGE_KEY = "cls_sidebar_collapsed";

function readSidebarState() {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function DashboardLayout() {
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
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  const handleLogout = useCallback(() => {
    logout();
    navigate("/");
  }, [logout, navigate]);

  const nav = useMemo(() => navByRole[user?.role] || [], [user?.role]);
  const currentTarget = `${location.pathname}${location.search}`;
  const isNavActive = useCallback((to) => (to.includes("?") ? currentTarget === to : location.pathname === to && !location.search), [currentTarget, location.pathname, location.search]);
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-slate-50">
      {mobileOpen ? <button aria-label="Close sidebar overlay" className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" onClick={() => setMobileOpen(false)} /> : null}
      <aside className={`fixed inset-y-0 left-0 z-40 flex border-r border-slate-200 bg-white px-3 py-4 transition-[width,transform] duration-200 ease-out lg:flex-col ${collapsed ? "lg:w-20" : "lg:w-64"} ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"} w-64 flex-col`}>
        <div className="flex shrink-0 items-center gap-2">
          <NavLink to="/" className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg bg-slate-50 p-3 text-base font-semibold ${collapsed ? "lg:justify-center" : ""}`} title="CarLoanSaathi">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0d47a1] text-sm text-white">CL</span>
          <span className={`truncate transition-opacity ${collapsed ? "lg:hidden" : ""}`}><span className="text-[#08736d]">CarLoan</span><span className="text-[#d86508]">Saathi</span></span>
          </NavLink>
          <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close sidebar" className="rounded-md border border-slate-200 p-2 text-slate-600 lg:hidden">
            <X className="h-4 w-4" />
          </button>
        </div>
        <button type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} className={`mt-4 hidden h-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 lg:flex ${collapsed ? "w-full" : "w-9"}`}>
          <ToggleIcon className="h-4 w-4" />
        </button>
        <div className="mt-6 min-h-0 flex-1 space-y-1 overflow-y-auto pb-3">
          {nav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} title={collapsed ? item.label : undefined} className={() => `flex min-h-10 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition ${collapsed ? "lg:justify-center lg:px-2" : ""} ${isNavActive(item.to) ? "bg-[#0d47a1] text-white" : "text-slate-600 hover:bg-slate-50 hover:text-[#0d47a1]"}`}>
                <Icon className="h-5 w-5 shrink-0" /> <span className={`truncate ${collapsed ? "lg:hidden" : ""}`}>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
        <div className={`shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-3 ${collapsed ? "lg:px-2" : ""}`}>
          <p className={`text-xs font-medium uppercase tracking-[0.12em] text-slate-500 ${collapsed ? "lg:hidden" : ""}`}>Session</p>
          <p className={`hidden text-center text-xs font-semibold text-slate-500 ${collapsed ? "lg:block" : ""}`}>{user?.email?.slice(0, 1)?.toUpperCase() || "U"}</p>
          <p className={`mt-1 break-words text-sm font-medium leading-5 text-slate-900 ${collapsed ? "lg:hidden" : ""}`}>{user?.email}</p>
        </div>
      </aside>
      <main className={`min-w-0 transition-[padding] duration-200 ease-out ${collapsed ? "lg:pl-20" : "lg:pl-64"}`}>
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
          <div className="flex min-h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <button type="button" onClick={() => setMobileOpen(true)} aria-label="Open sidebar" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 lg:hidden">
                <Menu className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} className="hidden h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 lg:inline-flex">
                <ToggleIcon className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{user?.roleLabel || "Workspace"}</p>
                <h1 className="truncate text-lg font-semibold text-slate-900">Operating Dashboard</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <NotificationCenter />
              <button onClick={handleLogout} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          </div>
        </header>
        <div className="border-b border-slate-200 bg-white px-4 py-2 lg:hidden">
          <div className="flex gap-2 overflow-x-auto">
            {nav.map((item) => (
              <NavLink key={item.to} to={item.to} className={() => `whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium ${isNavActive(item.to) ? "bg-[#0d47a1] text-white" : "bg-slate-100 text-slate-600"}`}>
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
        <div className="w-full max-w-full overflow-x-hidden px-4 py-5 sm:px-6 lg:px-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
