export const ROLES = {
  SUPER_ADMIN: "super-admin",
  GM: "gm",
  FINANCE_DESK: "finance-desk",
  BANK_MANAGER: "bank-manager",
  LOAN_EXECUTIVE: "loan-executive",
};

export const LEAD_STATUSES = ["NEW", "ASSIGNED", "ACCEPTED", "UNDER_REVIEW", "DOCS_PENDING", "APPROVED", "REJECTED", "DISBURSED", "CLOSED"];

export const ADMIN_LEAD_STATUSES = LEAD_STATUSES;

export const OTHER_CUSTOMER_DOCUMENT = "Other Document";

export const STANDARD_CUSTOMER_DOCUMENTS = [
  "Aadhaar",
  "PAN",
  "Salary Slip",
  "ITR",
  "Bank Statement",
  "Electricity Bill",
  "Rent Agreement",
  "Form 16",
];

export const CUSTOMER_DOCUMENTS = [...STANDARD_CUSTOMER_DOCUMENTS, OTHER_CUSTOMER_DOCUMENT];
export const DOCUMENT_TYPES = CUSTOMER_DOCUMENTS;
