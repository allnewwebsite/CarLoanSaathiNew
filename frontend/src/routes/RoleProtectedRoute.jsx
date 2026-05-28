import { Navigate, Outlet } from "react-router-dom";
import { ROLE_ROUTES, ROLES, isKnownRole } from "../auth/roleSystem.js";
import { useAuth } from "../context/AuthContext.jsx";

function loginPathForRole(role) {
  if (role === ROLES.SUPER_ADMIN) return "/super-admin";
  if (role === ROLES.BANK_MANAGER || role === ROLES.LOAN_EXECUTIVE) return "/bank-login";
  return "/dealer-login";
}

export function RoleProtectedRoute({ allowedRoles = [], loginPath }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-slate-50" />;
  if (!user) return <Navigate to={loginPath || "/dealer-login"} replace />;
  if (!isKnownRole(user.role)) return <Navigate to={loginPath || "/dealer-login"} replace />;
  if ([ROLES.FINANCE_DESK, ROLES.GM_SM].includes(user.role) && (user.accountApproved !== true || user.accountActive === false)) {
    return <Navigate to="/dealer-registration/pending" replace />;
  }
  if ([ROLES.BANK_MANAGER, ROLES.LOAN_EXECUTIVE].includes(user.role) && (user.accountApproved !== true || user.accountActive === false)) {
    return <Navigate to="/bank-registration/pending" replace />;
  }
  if ([ROLES.FINANCE_DESK, ROLES.GM_SM, ROLES.LOAN_EXECUTIVE].includes(user.role) && user.firstLoginRequired === true && !["/change-password", "/loan-executive/change-password"].includes(window.location.pathname)) {
    return <Navigate to={user.role === ROLES.LOAN_EXECUTIVE ? "/loan-executive/change-password" : "/change-password"} replace />;
  }
  if ([ROLES.FINANCE_DESK, ROLES.GM_SM, ROLES.LOAN_EXECUTIVE].includes(user.role) && user.passwordExpired === true && !["/change-password", "/loan-executive/change-password"].includes(window.location.pathname)) {
    return <Navigate to={user.role === ROLES.LOAN_EXECUTIVE ? "/loan-executive/change-password" : "/change-password"} replace />;
  }
  if (allowedRoles.length && !allowedRoles.includes(user.role)) {
    return <Navigate to={ROLE_ROUTES[user.role] || loginPathForRole(user.role)} replace />;
  }
  return <Outlet />;
}
