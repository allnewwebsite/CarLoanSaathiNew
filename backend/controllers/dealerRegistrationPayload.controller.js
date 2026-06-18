import {
  optionalEmail,
  optionalText,
  required,
  requiredGstin,
} from "./dealerShared.controller.js";

export function buildDealerOnboardingPayload({ body, loginEmail, state, city, dealershipBrand, selectedPlan, now }) {
  const dealership = {
    dealershipName: required(body.dealershipName, "Dealership name"),
    dealershipBrand,
    authorizedDealerCode: required(body.authorizedDealerCode, "Authorized dealer code"),
    gstinNumber: requiredGstin(body.gstinNumber || body.gstin || body.gstNumber),
    officialDealershipMobile: required(body.officialDealershipMobile, "Official dealership mobile"),
    state,
    city,
    location: city,
    pincode: required(body.pincode, "Pincode"),
    address: required(body.address, "Full dealership address"),
    landmark: String(body.landmark || "").trim(),
    monthlyCarSalesCapacity: required(body.monthlyCarSalesCapacity, "Monthly car sales capacity"),
    ...(optionalText(body.expectedMonthlyLoanApplications) ? { expectedMonthlyLoanApplications: optionalText(body.expectedMonthlyLoanApplications) } : {}),
    status: "Pending Approval",
    dealerId: loginEmail,
    dealerName: required(body.dealershipName, "Dealership name"),
    dealerBrand: dealershipBrand,
    dealerState: state,
    dealerLocation: city,
    dealerStatus: "pending",
    monthlySalesCapacity: required(body.monthlyCarSalesCapacity, "Monthly car sales capacity"),
    active: false,
    accountActive: false,
    approved: false,
    loginEmail,
    primaryGoogleEmail: loginEmail,
    createdAt: now,
    selectedPlan,
  };

  const documents = Array.isArray(body.documents) ? body.documents : [];
  const generalManager = [body.gmName, body.gmMobile, body.gmEmail].some((value) => optionalText(value))
    ? {
        name: optionalText(body.gmName),
        mobile: optionalText(body.gmMobile),
        email: optionalEmail(body.gmEmail),
      }
    : null;
  const financeDesk = [body.financeHeadName, body.financeHeadMobile, body.financeDeskEmail, body.financeTeamSize].some((value) => optionalText(value))
    ? {
        headName: optionalText(body.financeHeadName),
        headMobile: optionalText(body.financeHeadMobile),
        officialEmail: optionalEmail(body.financeDeskEmail) || loginEmail,
        teamSize: optionalText(body.financeTeamSize),
      }
    : null;
  const owner = {
    fullName: optionalText(body.ownerFullName) || dealership.dealershipName,
    mobile: optionalText(body.ownerMobile) || dealership.officialDealershipMobile,
    email: optionalEmail(body.ownerEmail) || loginEmail,
  };

  return {
    documents,
    dealership,
    owner,
    registrationPayload: {
      type: "dealership",
      status: "Pending Approval",
      state,
      city,
      location: city,
      dealershipName: dealership.dealershipName,
      dealershipBrand: dealership.dealershipBrand,
      gstinNumber: dealership.gstinNumber,
      loginEmail,
      submittedAt: now,
      documents,
      dealership,
      owner,
      ...(generalManager ? { generalManager } : {}),
      ...(financeDesk ? { financeDesk } : {}),
      verification: {
        dealershipVerified: false,
      },
      selectedPlan,
    },
  };
}
