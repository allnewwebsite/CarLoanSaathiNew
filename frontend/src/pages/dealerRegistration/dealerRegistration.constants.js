export const salesCapacity = ["10+", "25+", "50+", "70+", "100+", "200+"];

export const documentFields = ["GST Certificate", "Dealership License", "Office Exterior Photo", "Office Interior Photo"];

export const documentConfig = {
  "GST Certificate": { type: "gst-certificate", folder: "gst" },
  "Dealership License": { type: "dealership-license", folder: "license" },
  "Office Exterior Photo": { type: "office-exterior", folder: "office-exterior" },
  "Office Interior Photo": { type: "office-interior", folder: "office-interior" },
};

export const allowedDocumentTypes = ["application/pdf", "image/jpeg", "image/png"];
export const maxDocumentSize = 10 * 1024 * 1024;

export const benefitCards = [
  "Multi-bank finance processing",
  "Faster loan approvals",
  "Real-time case tracking",
  "Finance desk management",
  "Location-based lead routing",
  "Salesperson performance visibility",
  "Secure document workflow",
  "Bank workflow visibility",
];

export const workflow = ["Customer", "Salesperson", "Finance Desk", "CarLoanSaathi", "Bank", "Approval", "Disbursement"];

export const initialForm = {
  dealershipName: "",
  dealershipBrand: "",
  authorizedDealerCode: "",
  gstinNumber: "",
  officialDealershipMobile: "",
  state: "Haryana",
  city: "",
  pincode: "",
  address: "",
  landmark: "",
  monthlyCarSalesCapacity: "",
  loginEmail: "",
};
