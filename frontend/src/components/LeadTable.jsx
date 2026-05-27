import { StatusBadge } from "./StatusBadge.jsx";
import { VirtualTable } from "./VirtualTable.jsx";

export function LeadTable({ leads }) {
  if (leads.length > 25) {
    return (
      <VirtualTable
        rows={leads}
        columns={[
          { key: "case", label: "Case", render: (lead) => lead.caseId || lead.id },
          { key: "customer", label: "Customer", render: (lead) => lead.customer },
          { key: "car", label: "Vehicle", render: (lead) => lead.car },
          { key: "bank", label: "Bank Partner", render: (lead) => lead.bank },
          { key: "status", label: "Status", render: (lead) => <StatusBadge status={lead.status} /> },
          { key: "documents", label: "Docs", render: (lead) => `${lead.documents}/8` },
          { key: "updated", label: "Updated", render: (lead) => lead.updated },
        ]}
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-line text-sm">
          <thead className="bg-surface text-left text-xs font-semibold uppercase text-muted">
            <tr>
              <th className="px-4 py-3">Case</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Vehicle</th>
              <th className="px-4 py-3">Bank Partner</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Docs</th>
              <th className="px-4 py-3">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {leads.map((lead) => (
              <tr key={lead.id} className="hover:bg-surface">
                <td className="whitespace-nowrap px-4 py-4 font-semibold text-ink">{lead.caseId || lead.id}</td>
                <td className="whitespace-nowrap px-4 py-4">{lead.customer}</td>
                <td className="whitespace-nowrap px-4 py-4 text-muted">{lead.car}</td>
                <td className="whitespace-nowrap px-4 py-4 text-muted">{lead.bank}</td>
                <td className="whitespace-nowrap px-4 py-4"><StatusBadge status={lead.status} /></td>
                <td className="whitespace-nowrap px-4 py-4 text-muted">{lead.documents}/8</td>
                <td className="whitespace-nowrap px-4 py-4 text-muted">{lead.updated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
