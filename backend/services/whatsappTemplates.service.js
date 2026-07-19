function formatAmount(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "-";
  return `Rs. ${new Intl.NumberFormat("en-IN").format(numeric)}`;
}

export function buildWhatsAppMessage(type, payload = {}) {
  const leadId = payload.caseId || payload.leadId || payload.id || "-";
  const customer = payload.customerName || payload.fullName || "Customer";
  const loanAmount = payload.loanAmount ? formatAmount(payload.loanAmount) : "-";
  const concise = (heading, action = "Please login to review the case.") => [
    "CarLoanSaathi",
    "",
    heading,
    "",
    `Case ID: ${leadId}`,
    ...(action ? ["", action] : []),
  ];

  const templates = {
    LEAD_ASSIGNED: concise("New Case Assigned", "Please login to process the case."),
    DOCUMENTS_REQUIRED: concise("Customer Documents Requested", "Please login to upload the documents."),
    STATUS_UPDATED: concise("Case Status Updated"),
    DOCUMENTS_UPLOADED: concise("Customer Documents Uploaded", "Please login to review the documents."),
    "new-lead-assigned": concise("New Case Assigned", "Please login to process the case."),
    "executive-reassigned": concise("Case Reassigned", "Please login to process the case."),
    "pending-documents": concise("Customer Documents Requested", "Please login to upload the documents."),
    approval: ["Loan Approved", "", `Customer: ${customer}`, `Bank: ${payload.bankName || payload.bankPartner || "-"}`, `Sanction Amount: ${payload.sanctionAmount ? formatAmount(payload.sanctionAmount) : loanAmount}`],
    rejection: concise("Case Rejected", null),
    disbursement: concise("Loan Disbursed Successfully", null),
    escalation: ["Escalation Alert", "", `Lead ID: ${leadId}`, payload.message || "Action required by manager."],
    "daily-summary": ["Daily Summary", "", `Total Leads: ${payload.totalLeads ?? 0}`, `Approved: ${payload.approved ?? 0}`, `Pending: ${payload.pending ?? 0}`, `Disbursed: ${payload.disbursed ?? 0}`],
  };

  return (templates[type] || [payload.title || "CarLoanSaathi Update", "", payload.message || "Action required."])
    .filter((line) => line !== undefined)
    .join("\n");
}
