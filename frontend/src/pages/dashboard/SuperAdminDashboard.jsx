import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LEAD_TABLE_LABELS } from "../../constants/leadTableLabels.js";
import { LifecycleArchiveHeader, lifecycleArchiveCopy } from "../../components/LifecycleArchiveHeader.jsx";
import { useDebouncedValue } from "../../hooks/useDebouncedValue.js";
import { api } from "../../services/api.js";
import { usePageLatency } from "../../services/frontendLatency.js";
import { DataTable, PageTitle } from "./superAdmin/SuperAdminParts.jsx";
import { Filters, usePagedRows } from "./superAdmin/SuperAdminListParts.jsx";
export { SuperAdminApprovalDetailPage } from "./superAdmin/SuperAdminApprovalDetailPage.jsx";
export { SuperAdminDealershipDetailPage } from "./superAdmin/SuperAdminDealershipDetailPage.jsx";
export { SuperAdminLeadDetailPage } from "./superAdmin/SuperAdminLeadDetailPage.jsx";
import { useAdminPanelData } from "./superAdmin/useAdminPanelData.js";
import {
  assignmentDisplay,
  bankCapacityDisplay,
  bankIfscDisplay,
  caseId,
  display,
  downloadCsv,
  enterpriseLeadStatus,
  formatDate,
  generatedAt,
  superAdminMoney as money,
  SUPER_ADMIN_PAGE_SIZE as pageSize,
} from "./superAdmin/superAdmin.helpers.js";

function AdminListPage({ mode }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get("search") || "");
  const debouncedSearch = useDebouncedValue(search, 180);
  const [updatingId, setUpdatingId] = useState("");
  const pageData = useAdminPanelData(mode, debouncedSearch);
  const archived = mode === "rejected" || mode === "disbursed";
  const archiveCopy = archived ? lifecycleArchiveCopy(mode) : null;
  const refresh = pageData.load;

  const approveApplication = async (type, item) => {
    setUpdatingId(item.id);
    try {
      await api.post(`/admin/approvals/${type}/${item.id}/approve`);
      await refresh();
    } finally {
      setUpdatingId("");
    }
  };

  const rejectApplication = async (type, item) => {
    const reason = window.prompt("Enter rejection reason");
    if (!reason?.trim()) return;
    setUpdatingId(item.id);
    try {
      await api.post(`/admin/approvals/${type}/${item.id}/reject`, { reason });
      await refresh();
    } finally {
      setUpdatingId("");
    }
  };

  const suspendApplication = async (item) => {
    const reason = window.prompt("Enter suspension reason", "Suspended by Super Admin");
    if (!reason?.trim()) return;
    setUpdatingId(item.id);
    try {
      await api.post(`/admin/approvals/dealerships/${item.id}/suspend`, { reason });
      await refresh();
    } finally {
      setUpdatingId("");
    }
  };

  const suspendBankApplication = async (item) => {
    const reason = window.prompt("Enter suspension reason", "Suspended by Super Admin");
    if (!reason?.trim()) return;
    setUpdatingId(item.id);
    try {
      await api.post(`/admin/approvals/banks/${item.id}/suspend`, { reason });
      await refresh();
    } finally {
      setUpdatingId("");
    }
  };

  const deleteDealership = async (item) => {
    const label = item.dealershipName || item.name || item.loginEmail || item.id;
    const confirmed = window.confirm(`Delete ${label}? This will remove dealership account, users, approvals, and access records. Existing leads, documents, audit logs, and customer history will remain saved.`);
    if (!confirmed) return;
    setUpdatingId(item.id);
    try {
      await api.delete(`/admin/dealerships/${item.id}/permanent`);
      await refresh();
    } finally {
      setUpdatingId("");
    }
  };

  const deleteBank = async (item) => {
    const label = item.bankName || item.companyName || item.email || item.id;
    const confirmed = window.confirm(`Delete ${label}? This will remove the bank account, users, executives, and approval/profile records. Existing leads, documents, audit logs, and customer history will remain saved.`);
    if (!confirmed) return;
    setUpdatingId(item.id);
    try {
      await api.delete(`/admin/banks/${item.id}/permanent`);
      await refresh();
    } finally {
      setUpdatingId("");
    }
  };

  const config = useMemo(() => {
    const records = pageData.rows;
    if (mode === "dealerships") {
      return {
        title: "Approved Dealerships",
        headers: ["Dealership Name", "Brand", "Location", "Login Email", "Status", "Actions"],
        rows: records.map((item) => ({ key: item.id, cells: [display(item.dealershipName), display(item.dealershipBrand), display(item.city), display(item.loginEmail || item.email || item.id), display(item.accountActive === false ? "Disabled" : "Active"), <div key="actions" className="flex flex-wrap gap-2"><button onClick={() => navigate(`/admin/dealerships/${item.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View</button><button disabled={updatingId === item.id} onClick={() => deleteDealership(item)} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50">Delete</button></div>] })),
      };
    }
    if (mode === "approval-dealerships") {
      return {
        title: "Pending Dealerships",
        headers: ["Dealership Name", "Brand", "Location", "Selected Plan", "Login Email", "Registration Date", "Status", "Actions"],
        rows: records.map((item) => ({ key: item.id, cells: [display(item.dealershipName), display(item.dealershipBrand), display(item.city), display(item.selectedPlan || "TRIAL"), display(item.loginEmail || item.email), formatDate(item.submittedAt || item.createdAt), display(item.status), <div key="actions" className="flex flex-wrap gap-2"><button onClick={() => navigate(`/admin/approvals/dealerships/${item.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View</button><button disabled={updatingId === item.id} onClick={() => deleteDealership(item)} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50">Delete</button></div>] })),
      };
    }
    if (mode === "banks") {
      return {
        title: "Approved Banks",
        headers: ["Bank Name", "IFSC Code", "Bank Location", "Manager Name", "Manager Mobile", "Official Email", "Monthly Capacity", "Number Of Executives", "Approval Date", "Status", "Actions"],
        rows: records.map((item) => ({ key: item.id, cells: [display(item.bankName || item.companyName), display(item.ifsc), display(item.bankBranchLocation || item.branchLocation || item.city), display(item.managerName || item.contactPerson), display(item.mobile), display(item.email), bankCapacityDisplay(item), display(item.executiveCount), formatDate(item.approvedAt || item.updatedAt), display(item.accountActive === false ? "Disabled" : item.status), <div key="actions" className="flex flex-wrap gap-2"><button onClick={() => navigate(`/admin/approvals/banks/${item.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View</button><button disabled={updatingId === item.id} onClick={() => deleteBank(item)} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50">Delete</button></div>] })),
      };
    }
    if (mode === "approval-banks") {
      return {
        title: "Pending Approval Banks",
        headers: ["Bank Name", "IFSC Code", "Location", "Manager Name", "Manager Mobile", "Official Email", "Monthly Capacity", "Registration Date", "Status", "Actions"],
        rows: records.map((item) => ({ key: item.id, cells: [display(item.bankName || item.companyName), display(item.ifsc), display(item.bankBranchLocation || item.branchLocation || item.city), display(item.managerName || item.contactPerson), display(item.mobile), display(item.email), bankCapacityDisplay(item), formatDate(item.submittedAt || item.createdAt), display(item.status), <div key="actions" className="flex flex-wrap gap-2"><button onClick={() => navigate(`/admin/approvals/banks/${item.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View</button><button disabled={updatingId === item.id} onClick={() => deleteBank(item)} className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50">Delete</button></div>] })),
      };
    }
    return {
      title: archiveCopy?.title || "Total Leads",
      headers: ["Case ID", "Customer Name", "Mobile Number", "Customer City", "Car On-Road Price", "Required Loan Amount", "Dealership Name", "Dealer City", LEAD_TABLE_LABELS.generatedDate, "Assigned Bank Name", "Assigned Bank IFSC Code", LEAD_TABLE_LABELS.assignedExecutive, LEAD_TABLE_LABELS.executiveMobile, LEAD_TABLE_LABELS.currentStatus, LEAD_TABLE_LABELS.lastUpdated, "Documents"],
      rows: records.map((lead) => ({ key: lead.id, cells: [caseId(lead), display(lead.fullName || lead.customerName), display(lead.mobile), display(lead.city || lead.dealershipCity), `Rs. ${money.format(Number(lead.onRoadPrice || lead.carOnRoadPrice || lead.carPrice || 0))}`, `Rs. ${money.format(Number(lead.loanAmount || lead.requiredLoanAmount || 0))}`, assignmentDisplay(lead.dealershipName || lead.dealerName || lead.dealerEmail, "Pending"), display(lead.dealershipCity || lead.city), generatedAt(lead.createdAt), assignmentDisplay(lead.assignedBankName || lead.bankPartner || lead.assignedPartnerId), bankIfscDisplay(lead), assignmentDisplay(lead.assignedExecutiveName || lead.assignedExecutiveEmail), assignmentDisplay(lead.assignedExecutiveMobile || lead.executiveMobile), enterpriseLeadStatus(lead), formatDate(lead.updatedAt || lead.statusUpdatedAt || lead.createdAt), <button key="docs" onClick={() => navigate(`/admin/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View Documents</button>] })),
    };
  }, [archiveCopy?.title, mode, navigate, pageData.rows, updatingId]);

  const { page, pageRows, onPage } = usePagedRows(config.rows);
  return (
    <section className="space-y-4">
      {archived ? <LifecycleArchiveHeader kind={mode} search={search} onSearch={setSearch} /> : <><PageTitle mode={mode} /><Filters search={search} setSearch={setSearch} status="" setStatus={() => {}} options={[]} /></>}
      <DataTable title={config.title} headers={config.headers} rows={pageRows} loading={pageData.loading} page={page} total={config.rows.length} onPage={onPage} emptyMessage={archiveCopy?.empty} onExport={() => downloadCsv(config.title.toLowerCase().replace(/\s+/g, "-"), config.headers, config.rows.map((row) => row.cells.map((cell) => typeof cell === "string" || typeof cell === "number" ? cell : "")))} />
    </section>
  );
}

export function SuperAdminDashboard({ mode = "dashboard" }) {
  usePageLatency("SuperAdmin", { mode });
  if (mode === "dashboard") return <AdminListPage mode="leads" />;
  return <AdminListPage mode={mode} />;
}

