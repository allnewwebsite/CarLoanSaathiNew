import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { LEAD_TABLE_LABELS } from "../../constants/leadTableLabels.js";
import { BankManagerTable as Table, DetailState, MetricCard, PageTitle } from "./BankManagerPanelParts.jsx";
import { useBankAnalytics } from "./bankManager.hooks.js";
import { dateTime, display, leadStatusLabel, moneyValue, numberValue } from "./bankManager.helpers.js";

export function AnalyticsPage() {
  const navigate = useNavigate();
  const { data, loading, error, load } = useBankAnalytics();
  const emptyLoading = loading && !data;

  const branchRows = useMemo(() => (data?.branchMetrics || []).map((item) => ({
    key: item.branch,
    cells: [
      display(item.branch),
      numberValue(item.assignedLeads),
      numberValue(item.activeLeads),
      numberValue(item.pendingDocuments),
      numberValue(item.approvedLeads),
      numberValue(item.rejectedLeads),
      numberValue(item.disbursedLeads),
    ],
  })), [data?.branchMetrics]);
  const recentRows = useMemo(() => (data?.recentCases || []).map((lead) => ({
    key: lead.id,
    cells: [
      lead.caseId,
      display(lead.customerName),
      display(lead.executiveName),
      display(lead.branch),
      leadStatusLabel(lead),
      dateTime(lead.updatedAt),
      <button key="view" onClick={() => navigate(`/bank-manager/leads/${lead.id}`)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700">View</button>,
    ],
  })), [data?.recentCases, navigate]);

  return (
    <section className="space-y-5">
      <PageTitle title="Analytics" />
      {error ? <DetailState title="Analytics unavailable" message={error} onRetry={() => load()} tone="red" /> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Assigned Leads" value={emptyLoading ? "-" : numberValue(data?.assignedLeads)} subtext={data?.branch || data?.bankName || "Current branch scope"} />
        <MetricCard label="Active Cases" value={emptyLoading ? "-" : numberValue(data?.pendingLeads)} subtext={`${numberValue(data?.pendingDocuments)} pending document cases`} />
        <MetricCard label="Disbursed Amount" value={emptyLoading ? "-" : moneyValue(data?.disbursedAmount)} subtext={`${numberValue(data?.disbursedLeads)} disbursed cases`} />
        <MetricCard label="Approved" value={emptyLoading ? "-" : numberValue(data?.approvedLeads)} subtext={`${numberValue(data?.conversionRate)}% conversion`} />
        <MetricCard label="Rejected" value={emptyLoading ? "-" : numberValue(data?.rejectedLeads)} subtext={`${numberValue(data?.rejectionRate)}% rejection`} />
        <MetricCard label="Branches" value={emptyLoading ? "-" : numberValue(data?.branches ?? data?.branchMetrics?.length)} subtext="Branch-level workload" />
      </div>
      <Table title="Branch Performance" headers={["Branch", "Assigned", "Active", "Pending Docs", "Approved", "Rejected", "Disbursed"]} rows={branchRows} loading={emptyLoading} />
      <Table title="Recent Case Activity" headers={["Case ID", "Customer", LEAD_TABLE_LABELS.assignedExecutive, "Branch", LEAD_TABLE_LABELS.currentStatus, "Updated", "Action"]} rows={recentRows} loading={emptyLoading} />
    </section>
  );
}
