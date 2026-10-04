export type User = {
  id?: string;
  uid?: string;
  email: string;
  name?: string;
  role?: string;
  dealershipId?: string;
  dealershipName?: string;
  accountApproved?: boolean;
  accountActive?: boolean;
  dashboardAccessAllowed?: boolean;
};

export type Lead = {
  id: string;
  caseId?: string;
  fullName?: string;
  customerName?: string;
  mobile?: string;
  city?: string;
  selectedBrand?: string;
  carBrand?: string;
  carModel?: string;
  vehicleModel?: string;
  status?: string;
  pendingDocuments?: string[];
  pendingDocumentsRequested?: string[];
  pendingDocumentReason?: string;
  salespersonName?: string;
  bankName?: string;
  dealershipName?: string;
  documents?: DocumentRecord[];
  bankDocuments?: DocumentRecord[];
  [key: string]: unknown;
};

export type DocumentRecord = {
  id?: string;
  type?: string;
  documentType?: string;
  status?: string;
  file?: string;
  originalName?: string;
  createdAt?: string;
};

export type PickedFile = { uri: string; name: string; type: string; size?: number };

export const CANONICAL_DOCUMENT_TYPES = [
  "Aadhaar",
  "PAN",
  "Salary Slip",
  "ITR",
  "Bank Statement",
  "Electricity Bill",
  "Rent Agreement",
  "Form 16",
  "Other Document",
];

export function leadName(lead: Lead) {
  return String(lead.fullName || lead.customerName || "Unnamed customer").trim();
}

export function leadVehicle(lead: Lead) {
  return [lead.selectedBrand || lead.carBrand, lead.vehicleModel || lead.carModel].filter(Boolean).join(" ") || "Vehicle not provided";
}

export function documentName(document: DocumentRecord) {
  return String(document.type || document.documentType || document.file || "Document");
}

export function responseData<T>(payload: any): T {
  return (payload?.data ?? payload) as T;
}
