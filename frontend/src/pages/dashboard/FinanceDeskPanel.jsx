import { usePageLatency } from "../../services/frontendLatency.js";
import { AddLeadOnlyScreen } from "./finance/AddLeadOnlyScreen.jsx";
import { BankTieUpsScreen } from "./finance/BankTieUpsScreen.jsx";
import { FinanceManagerManagementScreen, SalespersonManagementScreen } from "./finance/FinanceStaffManagementScreens.jsx";
import { ActiveMembersScreen, AllCasesScreen, ArchiveCasesScreen, StatusScreen, TotalLeadsScreen } from "./finance/FinanceLeadListScreens.jsx";
import { StaffManagementScreen } from "./finance/StaffManagementScreen.jsx";

export function FinanceDeskPanel({ mode = "total" }) {
  usePageLatency("FinanceDesk", { mode });
  if (mode === "add") return <AddLeadOnlyScreen />;
  if (mode === "bank-tieups") return <BankTieUpsScreen />;
  if (mode === "staff") return <StaffManagementScreen />;
  if (mode === "finance-managers") return <FinanceManagerManagementScreen />;
  if (mode === "salespersons") return <SalespersonManagementScreen />;
  if (mode === "active-members" || mode === "active-salespersons") return <ActiveMembersScreen />;
  if (mode === "cases") return <AllCasesScreen />;
  if (mode === "status") return <StatusScreen />;
  if (mode === "rejected" || mode === "disbursed") return <ArchiveCasesScreen kind={mode} />;
  return <TotalLeadsScreen />;
}
