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
