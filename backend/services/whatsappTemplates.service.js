function formatAmount(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "-";
  return `Rs. ${new Intl.NumberFormat("en-IN").format(numeric)}`;
}

export function buildWhatsAppMessage(type, payload = {}) {
  const customer = payload.customerName || payload.fullName || "Customer";
  const leadId = payload.caseId || payload.leadId || payload.id || "-";
  const loanAmount = payload.loanAmount ? formatAmount(payload.loanAmount) : "-";

  const templates = {
    LEAD_ASSIGNED: [
      "CarLoanSaathi Lead Assigned",
      "",
      `Case ID: ${leadId}`,
      `Customer: ${customer}`,
      `Dealer: ${payload.dealershipName || payload.dealer || "-"}`,
      `Bank Branch: ${payload.bankName || "-"} ${payload.branchLocation ? `- ${payload.branchLocation}` : ""}`,
      `Loan Amount: ${loanAmount}`,
      "",
      "Please review this case in the dashboard.",
    ],
    DOCUMENTS_REQUIRED: [
      "CarLoanSaathi Documents Required",
      "",
      `Case ID: ${leadId}`,
      `Customer: ${customer}`,
      `Required: ${(payload.documents || []).join(", ") || "Pending documents"}`,
      "",
      "Please coordinate with the customer and upload documents.",
    ],
    STATUS_UPDATED: [
      "CarLoanSaathi Status Updated",
      "",
      `Case ID: ${leadId}`,
      `Customer: ${customer}`,
      `Current Status: ${payload.statusLabel || payload.status || "-"}`,
      "",
      "Please check the dashboard for details.",
    ],
    DOCUMENTS_UPLOADED: [
      "CarLoanSaathi Documents Uploaded",
      "",
      `Case ID: ${leadId}`,
      `Customer: ${customer}`,
      `Uploaded: ${(payload.documents || []).join(", ") || "Document"}`,
      "",
      "Please review the uploaded document.",
    ],
    "new-lead-assigned": [
      "New Lead Assigned",
      "",
      `Customer: ${customer}`,
      `Dealer: ${payload.dealershipName || payload.dealer || "-"}`,
      `Bank: ${payload.bankName || payload.bankPartner || payload.preferredBank || "-"}`,
      `Loan Amount: ${loanAmount}`,
      "",
      "Please review this case in the dashboard.",
    ],
    "executive-reassigned": ["Lead Reassigned", "", `Lead ID: ${leadId}`, `Executive: ${payload.executiveName || "-"}`, "Please review this case in the dashboard."],
    "pending-documents": ["Pending Document Alert", "", `Lead ID: ${leadId}`, `Customer: ${customer}`, "", "Required:", ...((payload.documents || []).map((doc) => `- ${doc}`))],
    approval: ["Loan Approved", "", `Customer: ${customer}`, `Bank: ${payload.bankName || payload.bankPartner || "-"}`, `Sanction Amount: ${payload.sanctionAmount ? formatAmount(payload.sanctionAmount) : loanAmount}`],
    rejection: ["Loan Rejected", "", `Lead ID: ${leadId}`, `Customer: ${customer}`, `Reason: ${payload.reason || payload.rejectionReason || "-"}`],
    disbursement: ["Loan Disbursed", "", `Lead ID: ${leadId}`, `Customer: ${customer}`, `Amount: ${payload.disbursedAmount ? formatAmount(payload.disbursedAmount) : loanAmount}`],
    escalation: ["Escalation Alert", "", `Lead ID: ${leadId}`, payload.message || "Action required by manager."],
    "daily-summary": ["Daily Summary", "", `Total Leads: ${payload.totalLeads ?? 0}`, `Approved: ${payload.approved ?? 0}`, `Pending: ${payload.pending ?? 0}`, `Disbursed: ${payload.disbursed ?? 0}`],
  };

  return (templates[type] || [payload.title || "CarLoanSaathi Update", "", payload.message || "Action required."])
    .filter((line) => line !== undefined)
    .join("\n");
}
