import { Activity, BarChart3, Building2, ClipboardCheck, ClipboardList, FileClock, FileText, FileX2, Landmark, Users } from "lucide-react";
import { prefetchGet } from "../services/api.js";

export const navByRole = {
  "gm": [
    { label: "Total Leads", to: "/gm/total-leads", icon: ClipboardList },
    { label: "Status", to: "/gm/status", icon: FileClock },
    { label: "All Salespersons", to: "/gm/salespersons", icon: Users },
    { label: "All Cases", to: "/gm/cases", icon: FileText },
    { label: "Dead Cases", to: "/gm/dead-cases", icon: FileX2 },
  ],
  "finance-desk": [
    { label: "Total Leads", to: "/finance/total-leads", icon: ClipboardList },
    { label: "Status", to: "/finance/status", icon: FileClock },
    { label: "Add Lead", to: "/finance/add-lead", icon: ClipboardCheck },
    { label: "Add GM", to: "/finance/manage-staff", icon: Users },
    { label: "Add Finance Manager", to: "/finance/finance-managers", icon: Users },
    { label: "Add / Remove Salesperson", to: "/finance/salespersons", icon: Users },
    { label: "Active Members", to: "/finance/active-members", icon: Users },
    { label: "All Cases", to: "/finance/cases", icon: FileText },
    { label: "Bank Tie-Ups", to: "/finance/bank-tieups", icon: Landmark },
    { label: "Dead Cases", to: "/finance/dead-cases", icon: FileX2 },
  ],
  "bank-manager": [
    { label: "Total Leads", to: "/bank-manager/leads", icon: ClipboardList },
    { label: "Status", to: "/bank-manager/status", icon: FileClock },
    { label: "Analytics", to: "/bank-manager/analytics", icon: BarChart3 },
    { label: "Manage Executive", to: "/bank-manager/manage-executive", icon: Users },
    { label: "All Executives", to: "/bank-manager/executives", icon: ClipboardCheck },
    { label: "All Dealerships", to: "/bank-manager/dealerships", icon: Building2 },
    { label: "Dead Cases", to: "/bank-manager/dead-cases", icon: FileX2 },
  ],
  "loan-executive": [
    { label: "Total Leads", to: "/loan-executive/leads", icon: ClipboardList },
    { label: "Status", to: "/loan-executive/status", icon: FileClock },
    { label: "Dead Cases", to: "/loan-executive/dead-cases", icon: FileX2 },
  ],
  "super-admin": [
    { label: "Approved Dealerships", to: "/admin/dealerships", icon: Building2 },
    { label: "Pending Dealerships", to: "/admin/approvals/dealerships", icon: ClipboardCheck },
    { label: "Approved Banks", to: "/admin/banks", icon: Landmark },
    { label: "Pending Approval Banks", to: "/admin/approvals/banks", icon: ClipboardCheck },
    { label: "Total Leads", to: "/admin/leads", icon: ClipboardList },
    { label: "Monitoring", to: "/admin/monitoring", icon: Activity },
  ],
};

const notificationPrefetch = { url: "/notifications", params: { limit: 20 } };

function withCommonPrefetch(specs = []) {
  const seen = new Set();
  return [...specs, notificationPrefetch].filter(({ url, params }) => {
    const key = `${url}|${JSON.stringify(params || {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function prefetchSpecsForRoute(to) {
  const path = String(to || "").split("?")[0];
  if (path === "/finance/dead-cases") return withCommonPrefetch([{ url: "/dealer/dead-cases", params: { page: 1, limit: 20 } }]);
  if (path === "/gm/dead-cases") return withCommonPrefetch([{ url: "/gm/dead-cases", params: { page: 1, limit: 20 } }]);
  if (path === "/bank-manager/dead-cases" || path === "/loan-executive/dead-cases") return withCommonPrefetch([{ url: "/bank/dead-cases", params: { page: 1, limit: 20 } }]);
  if (path === "/finance/active-members") return withCommonPrefetch([{ url: "/dealer/active-members" }]);
  if (path.startsWith("/finance")) return withCommonPrefetch([{ url: "/dashboard/fast" }]);
  if (path.startsWith("/gm")) return withCommonPrefetch([{ url: "/dashboard/fast" }]);
  if (path.startsWith("/bank-manager/dealerships")) return withCommonPrefetch([{ url: "/dashboard/fast" }, { url: "/bank/dealerships", params: { page: 1, limit: 10 } }]);
  if (path.startsWith("/bank-manager")) return withCommonPrefetch([{ url: "/dashboard/fast" }]);
  if (path.startsWith("/loan-executive")) return withCommonPrefetch([{ url: "/dashboard/fast" }]);
  if (path.startsWith("/admin")) return withCommonPrefetch([{ url: "/dashboard/fast" }]);
  return withCommonPrefetch([]);
}

export function prefetchDashboardRoute(to) {
  prefetchSpecsForRoute(to).forEach(({ url, params, options }) => {
    prefetchGet(url, params, options);
  });
}
