export const DEAD_CASE_REASONS = Object.freeze([
  "Customer Not Interested",
  "Customer Unreachable",
  "Duplicate Lead",
  "Rejected By Customer",
  "Rejected By Bank",
  "Vehicle Purchase Cancelled",
  "Documentation Issue",
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
