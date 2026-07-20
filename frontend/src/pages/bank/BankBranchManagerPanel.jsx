import { usePageLatency } from "../../services/frontendLatency.js";
import { BankDealershipDisbursedPage, BankDealershipsPage } from "./BankDealershipPages.jsx";
import { ManageExecutivePage } from "./BankExecutiveManagementPage.jsx";
import { AllExecutivesPage, ExecutiveCasesPage } from "./BankExecutivesPage.jsx";
import { ArchiveCasesPage, StatusPage, TotalLeadsPage } from "./BankLeadListPages.jsx";

export function BankBranchManagerPanel({ mode = "leads" }) {
  usePageLatency("BankManager", { mode });
  if (mode === "status") return <StatusPage />;
  if (mode === "rejected" || mode === "disbursed") return <ArchiveCasesPage kind={mode} />;
  if (mode === "manage-executive") return <ManageExecutivePage />;
  if (mode === "executives") return <AllExecutivesPage />;
  if (mode === "executive-cases") return <ExecutiveCasesPage />;
  if (mode === "dealerships") return <BankDealershipsPage />;
  if (mode === "dealership-disbursed") return <BankDealershipDisbursedPage />;
  return <TotalLeadsPage />;
}
