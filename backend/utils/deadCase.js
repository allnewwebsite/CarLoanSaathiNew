export const DEAD_CASE_REASONS = Object.freeze([
  "Customer Not Interested",
  "Customer Not Reachable",
  "Customer Purchased Elsewhere",
  "Duplicate Case",
  "Loan Rejected Permanently",
  "Cancelled By Customer",
  "Wrong Information",
  "Documents Never Submitted",
  "Finance Desk Decision",
  "Other",
]);

export function isDeadCase(lead = {}) {
  return lead.isDeadCase === true;
}

export function assertLeadMutable(lead = {}, { role = "" } = {}) {
  if (!isDeadCase(lead)) return lead;
  if (role === "finance-desk") return lead;
  const error = new Error("Dead cases are read-only");
  error.status = 409;
  error.code = "DEAD_CASE_IMMUTABLE";
  throw error;
}
