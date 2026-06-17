import { useParams } from "react-router-dom";
import { DetailPageSkeleton } from "../../../components/ui/Loading.jsx";
import { StatusBadge } from "../../../components/StatusBadge.jsx";
import { LEAD_TABLE_LABELS } from "../../../constants/leadTableLabels.js";
import { DataTable, PageTitle } from "./SuperAdminParts.jsx";
import { AdminSubscriptionPanel } from "./SuperAdminSubscriptionPanel.jsx";
import { useAdminEcosystem } from "./superAdmin.hooks.js";
import { approvalRatio, display, formatDate, superAdminMoney as money } from "./superAdmin.helpers.js";

export function SuperAdminDealershipDetailPage() {
  const { id } = useParams();
  const data = useAdminEcosystem();
  const dealer = data.pendingDealershipApprovals.find((item) => item.id === id)
    || data.onboardingRequests.find((item) => item.id === id)
    || data.dealerships.find((item) => item.id === id || item.loginEmail === id);

  if (data.loading && !dealer) return <DetailPageSkeleton />;
  if (!dealer) return <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-500">Dealership not found.</section>;

  const email = dealer.loginEmail || dealer.id;
  const leads = data.leads.filter((lead) => [lead.dealerEmail, lead.dealershipEmail, lead.createdBy].includes(email));

  return (
    <section className="space-y-5">
      <PageTitle mode="dealership details" />
      <div className="grid gap-3 md:grid-cols-4">
        {[["Dealership", dealer.dealershipName], ["Brand", dealer.dealershipBrand], ["GSTIN", dealer.gstinNumber || dealer.dealership?.gstinNumber], ["City", dealer.city], ["Login Email", dealer.loginEmail || dealer.email || email], ["Salesperson Count", dealer.salespersonCount || "-"], ["Total Leads", leads.length], ["Approval Ratio", approvalRatio(leads)], ["Status", dealer.status]].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-4"><p className="text-xs uppercase text-slate-500">{label}</p><p className="mt-1 font-medium text-slate-900">{display(value)}</p></div>)}
      </div>
      <AdminSubscriptionPanel dealershipId={dealer.loginEmail || dealer.email || email} />
      <DataTable title="Dealership Leads" headers={["Customer", "Bank", "Amount", LEAD_TABLE_LABELS.currentStatus, "Updated"]} rows={leads.slice(0, 10).map((lead) => ({ key: lead.id, cells: [display(lead.fullName || lead.customerName), display(lead.assignedBankName || lead.bankPartner || lead.assignedPartnerId), `Rs. ${money.format(Number(lead.loanAmount || 0))}`, <StatusBadge key="status" lead={lead} />, formatDate(lead.updatedAt || lead.createdAt)] }))} loading={false} />
    </section>
  );
}
