export const initialDealerLeadForm = {
  fullName: "",
  mobile: "",
  email: "",
  city: "",
  selectedBrand: "",
  selectedModel: "",
  carPrice: "",
  loanAmount: "",
  employmentType: "",
  ifscCode: "",
  salespersonId: "",
  remarks: "",
};

export function normalizeBrandRows(data) {
  const brands = Array.isArray(data) ? data : [];
  return brands
    .map((brand) => ({
      name: brand.name || brand.slug || "",
      slug: brand.slug || "",
    }))
    .filter((brand) => brand.name && brand.slug);
}

export function normalizeModelRows(data) {
  const carsForBrand = Array.isArray(data) ? data : [];
  return carsForBrand.map((model) => model.name || model.model || "").filter(Boolean);
}

export function validateDealerLeadForm(formData) {
  const errors = [];

  if (!formData.fullName || formData.fullName.trim().length < 2) {
    errors.push("Customer name must be at least 2 characters");
  }
  if (!formData.mobile || !/^[6-9]\d{9}$/.test(formData.mobile)) {
    errors.push("Invalid mobile number");
  }
  if (!formData.city || formData.city.trim().length < 2) {
    errors.push("City is required");
  }
  if (!formData.selectedBrand) {
    errors.push("Car brand is required");
  }
  if (!formData.selectedModel) {
    errors.push("Car model is required");
  }
  if (!formData.carPrice || parseFloat(formData.carPrice) <= 0) {
    errors.push("Car price must be greater than 0");
  }
  if (!formData.loanAmount || parseFloat(formData.loanAmount) <= 0) {
    errors.push("Loan amount must be greater than 0");
  }
  if (parseFloat(formData.loanAmount) > parseFloat(formData.carPrice)) {
    errors.push("Loan amount cannot exceed car price");
  }
  if (!formData.employmentType) {
    errors.push("Employment type is required");
  }
  if (!formData.ifscCode) {
    errors.push("Bank branch selection is required");
  }
  if (!formData.salespersonId) {
    errors.push("Salesperson is required");
  }
  if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
    errors.push("Invalid email address");
  }

  return errors;
}

export function buildDealerLeadPayload(formData, banks) {
  const selectedBank = banks.find((bank) => bank.ifscCode === formData.ifscCode);
  if (!selectedBank) {
    throw new Error("Selected bank not found");
  }

  return {
    ...formData,
    bankId: selectedBank.bankId,
    bankName: selectedBank.bankName,
    branchName: selectedBank.branchName,
    carPrice: parseFloat(formData.carPrice),
    loanAmount: parseFloat(formData.loanAmount),
  };
}

export function dealerLeadCreateErrorMessage(error) {
  if (error.response?.data?.code === "BRANCH_NOT_TIEDUP") {
    return "Selected bank branch is not available for your dealership. Please select from your tied-up banks only.";
  }
  if (error.response?.data?.code === "IFSC_CODE_REQUIRED") {
    return "Bank branch selection is required";
  }
  return error.response?.data?.message || "Failed to create lead";
}
