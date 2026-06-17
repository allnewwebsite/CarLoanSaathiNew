import { BarChart3, Building2, ClipboardCheck, Landmark, Shield, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { StatusBadge } from "../../../components/StatusBadge.jsx";
import { LEAD_STATUSES } from "../../../constants/status.js";
import { DataTable, MetricCard } from "./SuperAdminParts.jsx";
import {
  approvalRatio,
  formatDate,
  leadStatus,
  superAdminMoney as money,
} from "./superAdmin.helpers.js";

export function SuperAdminDashboardOverview({ data }) {
  const navigate = useNavigate();
  const activeDealerships = data.pendingDealershipApprovals.filter((request) => request.status === "approved" && (request.accountType || request.type || "dealership") === "dealership").length || data.dealerships.filter((item) => item.active !== false).length;
  const activeBranches = data.branches.filter((item) => item.active !== false).length || data.branchManagers.length;
  const activeExecutives = data.loanExecutives.filter((item) => item.active !== false && item.status !== "inactive").length;
  const approved = data.leads.filter((lead) => leadStatus(lead) === LEAD_STATUSES.APPROVED).length;
  const rejected = data.leads.filter((lead) => leadStatus(lead) === LEAD_STATUSES.REJECTED).length;
  const disbursedAmount = data.leads.filter((lead) => leadStatus(lead) === LEAD_STATUSES.DISBURSED).reduce((sum, lead) => sum + Number(lead.disbursedAmount || lead.loanAmount || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const rows = data.auditLogs.slice(0, 10).map((event) => ({
    key: event.id || event.timestamp,
    cells: [
      formatDate(event.createdAt || event.timestamp),
      event.actionType || "System activity",
      event.meta?.dealershipName || event.meta?.bankName || "-",
      event.meta?.branchId || event.branchId || "-",
      event.actorId || event.actorEmail || "-",
      event.newValue ? <StatusBadge status={event.newValue} /> : "-",
      <button key="view" className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View</button>,
    ],
  }));

  return (
    <section className="space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Super Admin</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Master ecosystem control</h1>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Total Leads" value={data.analytics.totalLeads || data.leads.length} icon={BarChart3} onClick={() => navigate("/admin/leads")} />
        <MetricCard label="Active Dealerships" value={activeDealerships} icon={Building2} onClick={() => navigate("/admin/dealerships")} />
        <MetricCard label="Active Branches" value={activeBranches} icon={Landmark} onClick={() => navigate("/admin/branches")} />
        <MetricCard label="Active Executives" value={activeExecutives} icon={Users} onClick={() => navigate("/admin/executives")} />
        <MetricCard label="Approved Cases" value={approved} icon={ClipboardCheck} onClick={() => navigate("/admin/leads?status=APPROVED")} />
        <MetricCard label="Rejected Cases" value={rejected} icon={Shield} onClick={() => navigate("/admin/leads?status=REJECTED")} />
        <MetricCard label="Disbursed Amount" value={`Rs. ${money.format(disbursedAmount)}`} icon={Landmark} onClick={() => navigate("/admin/leads?status=DISBURSED")} />
        <MetricCard label="Daily Lead Volume" value={data.leads.filter((lead) => (lead.createdAt || "").startsWith(today)).length} icon={BarChart3} onClick={() => navigate("/admin/leads")} />
        <MetricCard label="Monthly Approval Ratio" value={approvalRatio(data.leads)} icon={ClipboardCheck} onClick={() => navigate("/admin/analytics")} />
      </div>
      <DataTable title="Recent System Activity" headers={["Time", "Event", "Dealership", "Branch", "Executive", "Status", "Actions"]} rows={rows} loading={data.loading} />
    </section>
  );
}
