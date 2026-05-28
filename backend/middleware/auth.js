import jwt from "jsonwebtoken";
import { jwtSecret } from "../config/env.js";
import { firebaseAdmin } from "../firebase/admin.js";
import { getRecord, updateRecord } from "../services/firestore.service.js";
import { observeAuthFailure } from "../services/observability.service.js";

function cookieValue(req, name) {
  const cookieHeader = String(req.headers.cookie || "");
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

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
  const locked = account?.lockedUntil && new Date(account.lockedUntil).getTime() > Date.now();
  const active = account.approved === true
    && Boolean(account.role)
    && !locked
    && account.active !== false
    && account.accountApproved !== false
    && account.accountActive !== false
    && !["pending", "rejected", "suspended", "deleted", "inactive", "disabled", "removed"].includes(String(account.accountStatus || account.status || "").toLowerCase());
  if (!active) {
    const error = new Error("Account is inactive or pending approval");
    error.status = locked ? 423 : 403;
    error.code = locked ? "ACCOUNT_LOCKED" : "ACCOUNT_INACTIVE";
    throw error;
  }
  return account;
}

function passwordChangeRequired(account = {}) {
  if (!["finance-desk", "gm-sm", "loan-executive"].includes(account.role)) return false;
  if (account.firstLoginRequired === true && !account.passwordChangedAt) return true;
  if (!account.passwordExpiresAt) return false;
  return new Date(account.passwordExpiresAt).getTime() <= Date.now();
}

function authUrlAllowedDuringPasswordChange(req) {
  return [
    "/api/auth/session",
    "/api/auth/session/refresh",
    "/api/auth/password/change-complete",
    "/api/auth/logout",
  ].some((path) => String(req.originalUrl || "").startsWith(path));
}

function passwordChangePathForRole(role) {
  if (role === "loan-executive") return "/loan-executive/change-password";
  if (role === "gm-sm") return "/gm/change-password";
  if (role === "finance-desk") return "/finance/change-password";
  return "/change-password";
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
    const bearerToken = header.startsWith("Bearer ") ? header.slice(7) : null;
    const cookieToken = cookieValue(req, "cls_session");
    const token = bearerToken || cookieToken;
    if (!token) {
      observeAuthFailure(req, "missing_token");
      return res.status(401).json({ message: "Authentication token is required" });
    }

    if (firebaseAdmin) {
      try {
        await firebaseAdmin.auth().verifyIdToken(token);
        observeAuthFailure(req, "jwt_required");
        return res.status(401).json({ message: "Backend session token is required", code: "JWT_REQUIRED" });
      } catch {
        // Fall through to JWT for service-issued tokens.
      }
    }

    const tokenUser = jwt.verify(token, jwtSecret());
    const email = String(tokenUser.email || tokenUser.uid || "").trim().toLowerCase();
    if (!email) {
      observeAuthFailure(req, "invalid_session_email");
      return res.status(401).json({ message: "Invalid session" });
    }
    let account;
    try {
      account = await verifiedAccountFromEmail(email);
    } catch (error) {
      observeAuthFailure(req, error.code || "account_not_active");
      return res.status(error.status || 403).json({ message: error.message, code: error.code || "ACCOUNT_INACTIVE" });
    }
    if (account.sessionRevokedAt && tokenUser.iat && new Date(account.sessionRevokedAt).getTime() > tokenUser.iat * 1000) {
      observeAuthFailure(req, "session_revoked");
      return res.status(401).json({ message: "Session revoked. Please login again.", code: "SESSION_REVOKED" });
    }
    if (tokenUser.role && tokenUser.role !== account.role) {
      observeAuthFailure(req, "session_role_changed");
      return res.status(401).json({ message: "Account role changed. Please login again.", code: "SESSION_ROLE_CHANGED" });
    }
    if (tokenUser.sessionId) {
      const session = await getRecord("userSessions", tokenUser.sessionId).catch(() => null);
      const expired = session?.expiresAt && new Date(session.expiresAt).getTime() <= Date.now();
      const inactive = session?.lastSeenAt && (Date.now() - new Date(session.lastSeenAt).getTime()) > 8 * 60 * 60 * 1000;
      const wrongOwner = session && String(session.email || "").toLowerCase() !== email;
      const roleChanged = session && session.role && session.role !== account.role;
      if (!session || session.revoked === true || expired || inactive || wrongOwner || roleChanged) {
        observeAuthFailure(req, "session_invalid");
        return res.status(401).json({ message: "Session expired. Please login again.", code: "SESSION_EXPIRED" });
      }
      updateRecord("userSessions", session.id, {
        lastSeenAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      }).catch(() => {});
    }
    if (!(await firebaseEmailVerified(email))) {
      observeAuthFailure(req, "email_not_verified");
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
      sessionId: tokenUser.sessionId || null,
    };
    if (passwordChangeRequired(account) && !authUrlAllowedDuringPasswordChange(req)) {
      observeAuthFailure(req, "password_change_required");
      return res.status(403).json({
        message: "Password change is required before continuing.",
        code: "PASSWORD_CHANGE_REQUIRED",
        redirectTo: passwordChangePathForRole(account.role),
      });
    }
    if (!(await dealerAccountIsActive(req.user))) {
      observeAuthFailure(req, "dealer_account_inactive");
      return res.status(403).json({ message: "Dealer account is inactive or deleted", code: "DEALER_ACCOUNT_INACTIVE" });
    }
    return next();
  } catch (error) {
    observeAuthFailure(req, "invalid_or_expired_token");
    return res.status(401).json({ message: "Invalid or expired token", code: "INVALID_SESSION" });
  }
}
