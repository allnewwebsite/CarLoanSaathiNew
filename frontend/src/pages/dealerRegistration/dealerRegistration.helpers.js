import { selectedOnboardingPlan } from "../../services/onboardingPlan.js";

export function validateDealerRegistrationForm({ form, bankStates, locationOptions, hasVerifiedEmail, dealerEmail }) {
  const requiredFields = [
    ["dealershipName", "Dealership Name"],
    ["dealershipBrand", "Dealership Brand"],
    ["authorizedDealerCode", "Authorized Dealer Code"],
    ["gstinNumber", "GSTIN Number"],
    ["officialDealershipMobile", "Official Dealership Mobile Number"],
    ["state", "State"],
    ["city", "Location"],
    ["pincode", "Pincode"],
    ["address", "Full Dealership Address"],
    ["monthlyCarSalesCapacity", "Monthly Car Sales Capacity"],
    ["loginEmail", "Official Login Email"],
  ];
  const missing = requiredFields.find(([field]) => !String(form[field] || "").trim());
  if (missing) return `${missing[1]} is required.`;
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(form.gstinNumber)) return "Enter a valid 15-character GSTIN number.";
  if (!bankStates.includes(form.state)) return "Please select a supported dealership state.";
  if (!locationOptions.includes(form.city)) return "Please select a supported dealership location.";
  if (!hasVerifiedEmail || !dealerEmail) return "Create an email/password account before submitting dealership registration.";
  return "";
}

export function uploadedDealerDocuments(documents) {
  return Object.entries(documents)
    .filter(([, item]) => item.status === "uploaded")
    .map(([type, item]) => ({
      type,
      documentType: item.documentType,
      fileName: item.file.name,
      size: item.file.size,
      fileUrl: item.fileUrl,
      storagePath: item.storagePath,
    }));
}

export function buildDealerRegistrationPayload({ form, registrationSession, dealerEmail, dealerUid, documents }) {
  return {
    ...form,
    registrationId: registrationSession.registrationId,
    loginEmail: dealerEmail,
    dealerUid,
    selectedPlan: registrationSession.selectedPlan || selectedOnboardingPlan(),
    documents: uploadedDealerDocuments(documents),
  };
}
