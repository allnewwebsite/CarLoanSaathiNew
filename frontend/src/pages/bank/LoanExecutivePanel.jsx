import { usePageLatency } from "../../services/frontendLatency.js";
import { LoanExecutiveLeadDetailPage } from "./LoanExecutiveLeadDetailPage.jsx";
import { LoanExecutiveLeadListPage } from "./LoanExecutiveLeadListPage.jsx";

export function LoanExecutivePanel({ mode = "leads" }) {
  usePageLatency("LoanExecutive", { mode });
  return <LoanExecutiveLeadListPage mode={mode} />;
}

export { LoanExecutiveLeadDetailPage };
