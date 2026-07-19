import { memo } from "react";
import { OperationalTable } from "../../../components/OperationalTable.jsx";
import { SUPER_ADMIN_PAGE_SIZE as pageSize } from "./superAdmin.helpers.js";

export const MetricCard = memo(function MetricCard({ label, value, icon: Icon, onClick }) {
  return (
    <button onClick={onClick} className="rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-[#0d47a1]/40">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
          <p className="mt-2 text-xl font-semibold text-slate-900">{value}</p>
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-50 text-[#0d47a1]">
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </button>
  );
});

export function DataTable({ title, headers, rows, loading, page, total, onPage, emptyMessage }) {
  return <OperationalTable title={title} headers={headers} rows={rows} loading={loading} page={page} total={total} onPage={onPage} pageSize={pageSize} emptyMessage={emptyMessage} />;
}

export function PageTitle({ mode }) {
  const title = {
    dealerships: "Approved Dealerships",
    "approval-dealerships": "Pending Dealerships",
    banks: "Approved Banks",
    "approval-banks": "Pending Approval Banks",
    leads: "Total Leads",
  }[mode] || `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
  return <div><p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">Super Admin</p><h1 className="mt-1 text-xl font-semibold text-slate-900">{title}</h1></div>;
}
