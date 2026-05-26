import jwt from "jsonwebtoken";
import { firebaseAdmin } from "../firebase/admin.js";
import { getRecord } from "../services/firestore.service.js";

async function dealerAccountIsActive(user) {
  if (!["finance-desk", "gm-sm"].includes(user?.role)) return true;
  const email = String(user.email || user.uid || "").trim().toLowerCase();
  const dealershipId = String(user.dealershipId || email).trim().toLowerCase();
  const account = await getRecord("users", email);
  if (user?.role === "super-admin") {
    return Boolean(account && account.role === "super-admin" && account.approved === true && account.active !== false);
  }
  const dealership = await getRecord("dealerships", dealershipId) || await getRecord("approvedDealerships", dealershipId);
  return Boolean(
    account
    && account.approved === true
    && account.active === true
    && account.accountApproved === true
    && account.accountActive === true
    && dealership
    && dealership.active !== false
    && dealership.accountActive !== false
    && !["pending", "rejected", "suspended", "deleted", "inactive"].includes(String(dealership.status || "").toLowerCase())
  );
}

async function verifiedAccountFromEmail(email) {
  const account = await getRecord("users", email);
  if (!account) {
    const error = new Error("Account is not approved");
    error.status = 403;
    error.code = "ACCOUNT_NOT_APPROVED";
    throw error;
  }
  const active = account.approved === true
    && Boolean(account.role)
    && account.active !== false
    && account.accountActive !== false
    && !["pending", "rejected", "suspended", "deleted", "inactive"].includes(String(account.accountStatus || account.status || "").toLowerCase());
  if (!active) {
    const error = new Error("Account is inactive or pending approval");
    error.status = 403;
    error.code = "ACCOUNT_INACTIVE";
    throw error;
  }
  return account;
}

async function firebaseEmailVerified(email) {
  if (!firebaseAdmin || !email) return true;
  try {
    const firebaseUser = await firebaseAdmin.auth().getUserByEmail(email);
    return firebaseUser.emailVerified === true;
  } catch {
    return false;
  }
}

export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: "Authentication token is required" });

    if (firebaseAdmin) {
      try {
        const decoded = await firebaseAdmin.auth().verifyIdToken(token);
        const email = String(decoded.email || "").trim().toLowerCase();
        if (!email) return res.status(401).json({ message: "Authenticated account email is required" });
        if (decoded.email_verified !== true) return res.status(403).json({ message: "Please verify your email address before logging in.", code: "EMAIL_NOT_VERIFIED" });
        const account = await verifiedAccountFromEmail(email);
        req.user = {
          uid: account.uid || decoded.uid || email,
          email,
          role: account.role,
          dealershipId: account.dealershipId || null,
          bankId: account.bankId || null,
          branchId: account.branchId || null,
          approved: account.approved === true,
          active: account.active !== false,
          accountApproved: account.accountApproved === true,
          accountActive: account.accountActive !== false,
        };
        return next();
      } catch {
        // Fall through to JWT for service-issued tokens.
      }
    }

    const tokenUser = jwt.verify(token, process.env.JWT_SECRET || "development-secret");
    const email = String(tokenUser.email || tokenUser.uid || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ message: "Invalid session" });
    const account = await verifiedAccountFromEmail(email);
    if (!(await firebaseEmailVerified(email))) {
      return res.status(403).json({ message: "Please verify your email address before logging in.", code: "EMAIL_NOT_VERIFIED" });
    }
    req.user = {
      uid: account.uid || email,
      email,
      role: account.role,
      dealershipId: account.dealershipId || null,
      bankId: account.bankId || null,
      branchId: account.branchId || null,
      approved: account.approved === true,
      active: account.active !== false,
      accountApproved: account.accountApproved === true || account.role === "super-admin",
      accountActive: account.accountActive !== false,
      emailVerified: true,
    };
    if (!(await dealerAccountIsActive(req.user))) {
      return res.status(403).json({ message: "Dealer account is inactive or deleted", code: "DEALER_ACCOUNT_INACTIVE" });
    }
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}
