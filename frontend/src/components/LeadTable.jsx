import { StatusBadge } from "./StatusBadge.jsx";
import { OperationalTable } from "./OperationalTable.jsx";
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
          { key: "status", label: "Current Status", render: (lead) => <StatusBadge status={lead.status} lead={lead} /> },
          { key: "documents", label: "Docs", render: (lead) => `${lead.documents}/8` },
          { key: "updated", label: "Updated", render: (lead) => lead.updated },
        ]}
      />
    );
  }
  return <OperationalTable headers={["Case", "Customer", "Vehicle", "Bank Partner", "Current Status", "Docs", "Updated"]} rows={leads.map((lead) => ({
    key: lead.id,
    cells: [lead.caseId || lead.id, lead.customer, lead.car, lead.bank, <StatusBadge key="status" status={lead.status} lead={lead} />, `${lead.documents}/8`, lead.updated],
  }))} loading={false} />;
}
