export function executiveInputFromBody(body = {}) {
  const name = String(body.name || body.executiveName || "").trim();
  const mobileDigits = String(body.mobile || "").replace(/\D/g, "");
  const mobile = mobileDigits.length === 12 && mobileDigits.startsWith("91") ? mobileDigits.slice(2) : mobileDigits;
  const email = String(body.email || body.officialEmail || "").trim().toLowerCase();
  return { name, mobile, email };
}

export function executiveInputError({ name, mobile, email } = {}) {
  if (!name || !mobile || !email) return "Executive name, mobile number, and official email are required";
  if (!/^\d{10}$/.test(mobile)) return "Mobile number must be 10 digits";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Valid official email is required";
  return "";
}

export function bankExecutiveRecord({ name, mobile, email, identity, partner, firebaseUser, temporaryPasswordHash, now }) {
  return {
    id: email,
    uid: firebaseUser.uid,
    name,
    fullName: name,
    email,
    officialEmail: email,
    mobile,
    bankPartnerId: identity.bankId,
    bankId: identity.bankId,
    bankName: identity.bankName,
    bankIfsc: identity.bankIfsc,
    ifsc: identity.bankIfsc,
    bankLocation: identity.bankLocation,
    bankBranchLocation: identity.bankLocation,
    branch: identity.bankLocation,
    branchCity: identity.bankLocation,
    city: identity.bankLocation,
    createdByManagerId: partner.email || partner.id,
    createdByManager: true,
    firstLoginRequired: true,
    temporaryPasswordRequired: true,
    temporaryPasswordHash,
    temporaryPasswordIssuedAt: now,
    passwordChangedAt: null,
    status: "active",
    active: true,
    approved: true,
    accountApproved: true,
    accountActive: true,
    createdAt: now,
  };
}

export function bankExecutiveCanonicalUser({ name, mobile, email, identity, partner, firebaseUser, temporaryPasswordHash, now, employeeId = "" }) {
  return {
    name,
    fullName: name,
    uid: firebaseUser.uid,
    email,
    officialEmail: email,
    mobile,
    role: "loan-executive",
    approved: true,
    active: true,
    accountApproved: true,
    accountActive: true,
    bankId: identity.bankId,
    bankName: identity.bankName,
    bankIfsc: identity.bankIfsc,
    branchId: identity.bankLocation,
    branch: identity.bankLocation,
    bankBranchLocation: identity.bankLocation,
    city: identity.bankLocation,
    employeeId,
    createdAt: now,
    firstLoginRequired: true,
    temporaryPasswordRequired: true,
    temporaryPasswordHash,
    temporaryPasswordIssuedAt: now,
    passwordChangedAt: null,
    createdByManager: true,
    createdByManagerId: partner.email || partner.id,
    status: "active",
  };
}
