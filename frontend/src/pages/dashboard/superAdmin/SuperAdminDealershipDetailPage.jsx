import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DetailPageSkeleton } from "../../../components/ui/Loading.jsx";
import { api } from "../../../services/api.js";
import { DataTable, PageTitle } from "./SuperAdminParts.jsx";
import { AdminSubscriptionPanel } from "./SuperAdminSubscriptionPanel.jsx";
import { display, formatDate } from "./superAdmin.helpers.js";

function InfoSection({ title, rows }) {
  return <section className="rounded-lg border border-slate-200 bg-white p-4"><h2 className="font-semibold text-slate-900">{title}</h2><div className="mt-3 grid gap-2">{rows.map(([label, value]) => <div key={label} className="grid grid-cols-[140px_1fr] gap-3 rounded-md bg-slate-50 px-3 py-2 text-sm"><span className="text-slate-500">{label}</span><span className="font-medium text-slate-900">{display(value)}</span></div>)}</div></section>;
}

export function SuperAdminDealershipDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api.get(`/admin/dealerships/${encodeURIComponent(id)}`)
      .then((response) => { if (active) setData(response.data); })
      .catch((requestError) => { if (active) setError(requestError.response?.data?.message || "Unable to load dealership details."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  if (loading) return <DetailPageSkeleton />;
  if (!data?.dealership) return <section className="rounded-lg border border-red-200 bg-white p-5"><h1 className="font-semibold text-slate-900">Approved dealership unavailable</h1><p className="mt-2 text-sm text-slate-600">{error}</p><Link to="/admin/dealerships" className="mt-4 inline-flex rounded-md bg-[#0d47a1] px-3 py-2 text-sm font-medium text-white">Back to Approved Dealerships</Link></section>;

  const dealer = data.dealership;
  const finance = data.financeDesks?.[0] || data.approval?.financeDesk || {};
  const owner = data.approval?.owner || {};
  const location = dealer.location || dealer.dealerLocation || dealer.city;
  return <section className="space-y-5">
    <PageTitle mode="dealership details" />
    <div className="grid gap-4 lg:grid-cols-2">
      <InfoSection title="Dealership Information" rows={[["Dealership", dealer.dealershipName || dealer.dealerName], ["Brand", dealer.dealershipBrand || dealer.dealerBrand], ["GSTIN", dealer.gstinNumber || dealer.gstin], ["Status", dealer.status || dealer.dealerStatus]]} />
      <InfoSection title="Business Details" rows={[["Plan", dealer.selectedPlan], ["Monthly Capacity", dealer.monthlySalesCapacity || dealer.monthlyCarSalesCapacity], ["Approved At", formatDate(dealer.approvedAt)], ["Approved By", dealer.approvedBy]]} />
      <InfoSection title="Location" rows={[["Address", dealer.address || data.approval?.dealership?.address], ["City / Location", location], ["State", dealer.state || dealer.dealerState]]} />
      <InfoSection title="Owner" rows={[["Name", owner.fullName || dealer.ownerName], ["Email", owner.email], ["Mobile", owner.mobile || dealer.ownerMobile]]} />
      <InfoSection title="Finance Desk" rows={[["Name", finance.fullName || finance.name], ["Email", finance.officialEmail || finance.email || dealer.loginEmail], ["Mobile", finance.mobile], ["Status", finance.status || (finance.active === false ? "inactive" : "active")]]} />
      <InfoSection title="Approval & Audit" rows={[["Approval Status", data.approval?.status || dealer.status], ["Approval ID", data.approval?.id], ["Created", formatDate(dealer.createdAt)], ["Updated", formatDate(dealer.updatedAt)]]} />
    </div>
    <AdminSubscriptionPanel dealershipId={data.canonicalId} />
    <DataTable title="Members" headers={["Name", "Role", "Email", "Mobile", "Status"]} rows={(data.members || []).map((member) => ({ key: member.id, cells: [display(member.fullName || member.name), display(member.role), display(member.email), display(member.mobile), display(member.status || (member.active === false ? "Inactive" : "Active"))] }))} loading={false} />
    <DataTable title="Banks" headers={["Bank", "Branch", "IFSC", "Location", "Added"]} rows={(data.banks || []).map((bank) => ({ key: bank.id, cells: [display(bank.bankName), display(bank.branchName), display(bank.ifscCode), display(bank.city), formatDate(bank.addedAt)] }))} loading={false} />
    <DataTable title="Approval Audit" headers={["Previous Status", "New Status", "Actor", "Timestamp"]} rows={(data.audit || []).map((entry) => ({ key: entry.id, cells: [display(entry.previousStatus), display(entry.newStatus), display(entry.approvedBy || entry.rejectedBy), formatDate(entry.createdAt || entry.approvedAt)] }))} loading={false} />
  </section>;
}
