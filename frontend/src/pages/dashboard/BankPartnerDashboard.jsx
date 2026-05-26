import { Button } from "../../components/Button.jsx";
import { DocumentChecklist } from "../../components/DocumentChecklist.jsx";
import { LeadTable } from "../../components/LeadTable.jsx";
import { StatCard } from "../../components/StatCard.jsx";
import { leads } from "../../data/platformData.js";

export function BankPartnerDashboard() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Assigned leads" value="52" delta="+8" />
        <StatCard label="Pending verification" value="17" />
        <StatCard label="Approved today" value="9" delta="+3" />
        <StatCard label="Settlement pending" value="Rs. 64L" />
      </div>
      <section className="card p-5">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h2 className="text-lg font-semibold text-ink">Assigned leads</h2>
            <p className="mt-1 text-sm text-muted">Approve, reject, verify documents, and coordinate with dealerships.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost">Reject</Button>
            <Button variant="brand">Approve</Button>
          </div>
        </div>
        <div className="mt-5"><LeadTable leads={leads.filter((lead) => lead.status !== "Disbursed")} /></div>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-lg font-semibold text-ink">Document verification</h2>
          <div className="mt-4"><DocumentChecklist /></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Button variant="brand">Verify</Button>
            <Button variant="ghost">Reject</Button>
            <Button variant="subtle">Request correction</Button>
          </div>
        </section>
        <section className="card p-5">
          <h2 className="text-lg font-semibold text-ink">Settlement management</h2>
          <div className="mt-4 space-y-3">
            {["Dealer invoice matched", "Disbursement queued", "Payout confirmation pending"].map((item) => (
              <div key={item} className="rounded-lg border border-line p-3 text-sm font-semibold text-ink">{item}</div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
