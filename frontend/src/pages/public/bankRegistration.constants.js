export const banks = [
  "State Bank of India (SBI)",
  "HDFC Bank",
  "ICICI Bank",
  "Axis Bank",
  "Kotak Mahindra Bank",
  "IndusInd Bank",
  "Punjab National Bank (PNB)",
  "Bank of Baroda",
  "Canara Bank",
  "Union Bank of India",
  "Bank of India",
  "Indian Bank",
  "Central Bank of India",
  "Bank of Maharashtra",
  "Indian Overseas Bank",
  "UCO Bank",
  "Punjab & Sind Bank",
  "IDFC FIRST Bank",
  "Federal Bank",
  "South Indian Bank",
  "Karnataka Bank",
  "Karur Vysya Bank",
  "Tamilnad Mercantile Bank",
  "RBL Bank",
  "DCB Bank",
  "CSB Bank",
  "AU Small Finance Bank",
  "Equitas Small Finance Bank",
  "Ujjivan Small Finance Bank",
  "Jana Small Finance Bank",
  "Suryoday Small Finance Bank",
  "ESAF Small Finance Bank",
  "Utkarsh Small Finance Bank",
  "Capital Small Finance Bank",
  "Yes Bank",
  "Other",
];

export const executiveCounts = ["1", "2", "3", "5", "10", "15", "20", "25+", "50+"];
export const benefits = ["Verified dealership leads", "Branch-wise assignment", "Executive dashboards", "Real-time approvals", "Faster disbursement"];
export const workflow = ["Bank Registration", "Super Admin Verification", "Branch Activation", "Executive Mapping", "Lead Assignment", "Loan Processing", "Disbursement"];

export const bankExecutiveWorkflow = ["Bank branch approval", "Branch manager creates executive", "Executive receives role-based access", "Assigned leads become visible"];

export const bankRegistrationStatusCopy = {
  "email-pending": {
    title: "Verify Your Email",
    body: "We sent a verification link to your bank email address. Verify it before completing branch registration.",
    badge: "Email Verification Pending",
    steps: [["Done", "Email account created"], ["Pending", "Email verification"], ["Next", "Complete branch registration"]],
  },
  rejected: {
    title: "Registration Rejected",
    body: "Your bank branch registration was rejected by CarLoanSaathi.",
    badge: "Rejected",
    steps: [["Done", "Email verified"], ["Done", "Branch reviewed"], ["Rejected", "Approval not granted"]],
  },
  suspended: {
    title: "Account Suspended",
    body: "Your bank branch account is suspended. Contact CarLoanSaathi support for next steps.",
    badge: "Suspended",
    steps: [["Done", "Email verified"], ["Done", "Account reviewed"], ["Suspended", "Portal access blocked"]],
  },
  pending: {
    title: "Registration submitted successfully",
    body: "Your bank branch registration is under CarLoanSaathi Super Admin verification. Login access will open automatically after approval.",
    badge: "Pending Super Admin Verification",
    steps: [["Done", "Email verified"], ["Done", "Branch details submitted"], ["Pending", "Super Admin verification"], ["Next", "Bank portal activation"]],
  },
  submitted: {
    title: "Registration submitted successfully",
    body: "Your bank branch registration is under CarLoanSaathi Super Admin verification. Login access will open automatically after approval.",
    badge: "Pending Super Admin Verification",
    steps: [["Done", "Email verified"], ["Done", "Branch details submitted"], ["Pending", "Super Admin verification"], ["Next", "Bank portal activation"]],
  },
};

export const documents = [
  { label: "Branch Authorization Letter", type: "authorization", folder: "authorization" },
  { label: "Address Proof", type: "address-proof", folder: "address-proof" },
  { label: "Manager Identity Card", type: "manager-id", folder: "manager-id" },
];

export const allowedTypes = ["application/pdf", "image/jpeg", "image/png"];
export const maxSize = 10 * 1024 * 1024;

export const initialForm = {
  bankName: "",
  ifsc: "",
  branchLocation: "",
  state: "Haryana",
  managerName: "",
  managerMobile: "",
  email: "",
  executiveCount: "",
  monthlyLoanCapacity: "",
};
